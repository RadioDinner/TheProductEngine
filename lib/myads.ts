/**
 * Member ad management (FEATURES item 16) — the pure decision logic, kept
 * dependency-free (like lib/post-ad.ts and lib/pic-quota.ts) so the unit
 * suite can pin it. The server actions in lib/myads-actions.ts do the I/O.
 *
 * THE DELETE REFUND MATRIX (user decision, session 009, exact):
 *   pending (not yet approved)              → refund
 *   approved, never sent in ANY digest      → refund
 *   ever sent in a digest                   → NO refund ("game over")
 *   violation-rejected                      → was never refundable — no refund
 * Benign-rejected ads already got their refund AT rejection time, so a later
 * delete refunds nothing either. Sold and ended ads are closed business:
 * deleting just takes them off the website, no refund.
 */

/** Mirrors StoredAdStatus (lib/engine-store.ts) without importing it — this
 * module stays dependency-free for the test runner. */
export type MemberAdStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sold"
  | "expired"
  | "deleted";

export type DeleteRefundReason =
  /** Waiting for review — nothing was ever delivered. */
  | "pending"
  /** Approved but never rode any digest — the paid service never happened. */
  | "never-ran"
  /** Rode at least one digest — the service was delivered, game over. */
  | "ran"
  /** Rejected: benign was refunded at rejection, violation never refunds. */
  | "rejected"
  /** Sold or ended — closed business, nothing to give back. */
  | "closed"
  /** Already deleted — nothing happens at all. */
  | "gone";

export interface DeleteRefundDecision {
  refund: boolean;
  reason: DeleteRefundReason;
}

/** The refund matrix, as a pure function of the ad's state at delete time. */
export function deleteRefundDecision(
  status: MemberAdStatus,
  everBroadcast: boolean,
): DeleteRefundDecision {
  if (status === "deleted") return { refund: false, reason: "gone" };
  if (status === "rejected") return { refund: false, reason: "rejected" };
  if (everBroadcast) return { refund: false, reason: "ran" };
  if (status === "pending") return { refund: true, reason: "pending" };
  if (status === "approved") return { refund: true, reason: "never-ran" };
  return { refund: false, reason: "closed" }; // sold / expired
}

/**
 * Deterministic ledger ref for the member-delete refund of one ad. Prod's
 * unique index on credit_ledger.ref (migration 9997) makes a concurrent
 * double-submit insert exactly once; dev checks hasLedgerRef first.
 */
export function deleteRefundRef(adId: number): string {
  return `member-delete-refund-ad-${adId}`;
}

/** The minimal ledger-entry shape the matchers below need. */
export interface LedgerLike {
  kind: string;
  delta: number;
  note: string;
}

/**
 * Find the original submission charge for an ad — EXACTLY how the benign-
 * rejection refund (lib/moderation.ts) and the admin delete view find it:
 * a spend entry whose note carries the delimited `Ad #<id> (kind)` token
 * (`Ad #1042 (text)` / `Free ad used — ad #1042 (picture)`). The trailing
 * ` (` keeps #12 from matching #125.
 */
export function findAdCharge<T extends LedgerLike>(ledger: T[], adId: number): T | undefined {
  return ledger.find(
    (entry) =>
      entry.kind === "spend" &&
      (entry.note.includes(`Ad #${adId} (`) || entry.note.includes(`ad #${adId} (`)),
  );
}

/**
 * True when this ad's charge was ALREADY returned by a benign rejection
 * (lib/moderation.ts notes: "Refund — ad #N not accepted" / "Free ad returned
 * — ad #N not accepted"). A delete must never refund a second time. The
 * ` not accepted` tail keeps #12 from matching #125 and keeps unrelated
 * refunds (e.g. "Bump not applied — ad #N") from counting.
 */
export function hasBenignRejectRefund(ledger: LedgerLike[], adId: number): boolean {
  return ledger.some(
    (entry) => entry.kind === "refund" && entry.note.includes(`ad #${adId} not accepted`),
  );
}

// ---------- replacement listing picture (position 0) ----------

/**
 * Marker prefix stored in ad_photo_submissions.from_email (free text by
 * design — migration 9985) that tags a submission as a REPLACEMENT for the
 * paid position-0 picture: on admin approval it swaps in instead of joining
 * the website gallery. Item-9 web extras use "web upload — (330) …" with no
 * bracket prefix, so the two never collide.
 */
export const PIC_REPLACE_MARKER = "[replace-pic]";

/** The from_email value for a member's replacement-picture submission. */
export function picReplaceFrom(formattedPhone: string): string {
  return `${PIC_REPLACE_MARKER} web upload — ${formattedPhone}`;
}

/** Does this submission replace position 0 (vs. joining the gallery)? */
export function isPicReplaceSubmission(fromEmail: string): boolean {
  return fromEmail.startsWith(PIC_REPLACE_MARKER);
}
