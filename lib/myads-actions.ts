"use server";

/**
 * Member ad management (FEATURES item 16) — the "My ads" page's actions.
 * Every action re-reads the ad AT THE STORE and checks ownership there;
 * nothing about the ad is ever trusted from the form. Semantics deliberately
 * mirror the SMS lane (lib/engine.ts handleOwnerCommand) so SOLD and BUMP
 * behave identically whether texted or clicked; delete adds the user's
 * refund matrix (lib/myads.ts) on top of the admin soft-delete machinery.
 *
 * Outcomes are signaled repo-style: redirect() with query params (redirect
 * throws — it never sits inside a try/catch here).
 *
 * NOTE: this file is intentionally separate from lib/account-actions.ts.
 */

import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import {
  addPhotoSubmission,
  adEverBroadcast,
  countAdPhotos,
  deleteAdRecord,
  getAdRecord,
  getQueuedBumps,
  listPhotoSubmissions,
  logMessage,
  markAdSold,
  queueBump,
  reviveAd,
  type StoredAd,
} from "@/lib/engine-store";
import {
  addLedgerEntry,
  ensureAccount,
  getLedger,
  grantFreeAd,
  hasLedgerRef,
  recordSale,
  setSmsContext,
  spendCredits,
} from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { deriveTitle } from "@/lib/ads";
import { gsmSanitize } from "@/lib/sms-segments";
import { dispatchSms } from "@/lib/outbound";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { storeImageBytes } from "@/lib/photos";
import { CONTENT_TYPE_BY_EXT, sniffImage } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";
import { MAX_PHOTOS_PER_AD } from "@/lib/email-photos";
import {
  deleteBumpRefundNote,
  deleteBumpRefundRef,
  deleteRefundDecision,
  deleteRefundRef,
  findAdCharge,
  findUnrefundedBumpCharge,
  hasBenignRejectRefund,
  isPicReplaceSubmission,
  picReplaceFrom,
} from "@/lib/myads";

const BACK = "/account/ads";
const HOUR_MS = 60 * 60 * 1000;
/** Rating window after a confirmed sale — same 7 days as the SMS flow. */
const RATE_CONTEXT_MS = 7 * 24 * HOUR_MS;
/** Per-picture byte ceiling — the same 8 MB every other ingest path enforces. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Session + ownership guard for every action: the ad is read from the store
 * and must belong to the signed-in phone. requirePhone-style redirect when
 * signed out.
 */
async function requireMyAd(formData: FormData): Promise<{ phone: string; ad: StoredAd }> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fads");
  const id = Number(formData.get("id"));
  const ad = Number.isInteger(id) && id > 0 ? await getAdRecord(id) : null;
  if (!ad || ad.ownerPhone !== session.phone) redirect(`${BACK}?error=notyours`);
  return { phone: session.phone, ad };
}

/**
 * Mark one of my ads sold — exact SOLD semantics (lib/engine.ts): only a
 * live (approved/expired) listing can be sold; the store's own status guard
 * is the authority under races, so a double-submit is a harmless no-op.
 * The optional buyer's phone (recorded decision (b)) feeds the item-2
 * sale/ratings flow exactly like the SMS SOLD → buyer-number conversation.
 */
export async function markMineSold(formData: FormData): Promise<void> {
  const { phone, ad } = await requireMyAd(formData);
  if (ad.status === "deleted") redirect(`${BACK}?error=gone&id=${ad.id}`);
  if (ad.status === "sold") redirect(`${BACK}?sold=already&id=${ad.id}`);
  if (ad.status === "rejected") redirect(`${BACK}?error=rejected&id=${ad.id}`);
  // Blocking `pending` closes a moderation bypass: SOLD on an unreviewed ad
  // would publish it to the site as "sold" (same rule as the SMS lane).
  if (ad.status === "pending") redirect(`${BACK}?sold=pending&id=${ad.id}`);

  // Validate the buyer's number BEFORE marking sold, so a typo can simply be
  // fixed and resubmitted (nothing has changed yet).
  const rawBuyer = String(formData.get("buyer") ?? "").trim();
  let buyer: string | null = null;
  if (rawBuyer) {
    buyer = normalizePhone(rawBuyer);
    if (!buyer) redirect(`${BACK}?error=badbuyer&id=${ad.id}`);
    if (buyer === phone) redirect(`${BACK}?error=selfbuyer&id=${ad.id}`);
  }

  await markAdSold(ad.id);

  if (!buyer) redirect(`${BACK}?sold=done&id=${ad.id}`);

  // Record the sale exactly like the SMS SOLD → buyer-phone flow
  // (lib/engine.ts answerBuyerPhone): both parties get accounts, the sale is
  // confirmed, both sides become ratable, and the buyer gets the same SMS
  // invitation — reply-class, so pause/blocklist/caps all apply.
  await ensureAccount(phone);
  await ensureAccount(buyer);
  const recorded = await recordSale(ad.id, phone, buyer);
  if (recorded === "unsupported") redirect(`${BACK}?sold=done&id=${ad.id}&rate=off`);
  const rateExpiry = new Date(Date.now() + RATE_CONTEXT_MS).toISOString();
  await setSmsContext(phone, {
    kind: "rate",
    adId: ad.id,
    otherPhone: buyer,
    ratedRole: "buyer",
    expiresAt: rateExpiry,
  });
  await setSmsContext(buyer, {
    kind: "rate",
    adId: ad.id,
    otherPhone: phone,
    ratedRole: "seller",
    expiresAt: rateExpiry,
  });
  // gsmSanitize at composition (dispatchSms re-sanitizes at the choke point;
  // it's idempotent) so the logged body matches the wire body byte for byte —
  // deriveTitle can inject a U+2026 ellipsis that would flip this to UCS-2.
  const invite = gsmSanitize(
    `The seller of ad #${ad.id} (${deriveTitle(ad.body)}) marked it sold to you. Want to rate the seller? Reply RATE 1-5 (5 = best), or SKIP.`,
  );
  const { sent } = await dispatchSms(buyer, invite, { cls: "reply" });
  if (sent) {
    await logMessage({ direction: "outbound", channel: "sms", address: buyer, body: invite });
  }
  redirect(`${BACK}?sold=done&id=${ad.id}&buyer=recorded`);
}

/**
 * Bump one of my ads — exact SMS BUMP semantics (lib/engine.ts): bumpCost
 * charged when > 0 (refunded if no bump was actually queued), one queued bump
 * per ad, and an expired ad is relisted first.
 */
export async function bumpMine(formData: FormData): Promise<void> {
  const { phone, ad } = await requireMyAd(formData);
  if (ad.status === "deleted") redirect(`${BACK}?error=gone&id=${ad.id}`);
  if (ad.status === "sold") redirect(`${BACK}?bump=sold&id=${ad.id}`);
  if (ad.status === "rejected") redirect(`${BACK}?error=rejected&id=${ad.id}`);
  if (ad.status === "pending") redirect(`${BACK}?bump=pending&id=${ad.id}`);

  const settings = await getEngineSettings();
  // Charge the admin-set bump cost before re-broadcasting — same order and
  // same ledger note as the SMS lane.
  if (settings.bumpCost > 0) {
    const paid = await spendCredits(phone, settings.bumpCost, `Bump — ad #${ad.id}`);
    if (!paid) redirect(`${BACK}?bump=nofunds&cost=${settings.bumpCost}&id=${ad.id}`);
  }
  const refundBump = async () => {
    if (settings.bumpCost > 0) {
      await addLedgerEntry(phone, {
        delta: settings.bumpCost,
        kind: "refund",
        note: `Bump not applied — ad #${ad.id}`,
      });
    }
  };

  if (ad.status === "expired") {
    await reviveAd(ad.id, settings.expiryDays);
    // Refund if a bump was already queued (starved past the old TTL) so this
    // bump doesn't charge twice for a broadcast that's already pending.
    const revivedQueued = await queueBump(ad.id);
    if (!revivedQueued) await refundBump();
    redirect(`${BACK}?bump=relisted&id=${ad.id}`);
  }
  const queued = await queueBump(ad.id);
  if (!queued) {
    await refundBump();
    redirect(`${BACK}?bump=already&id=${ad.id}`);
  }
  redirect(`${BACK}?bump=queued&id=${ad.id}`);
}

/**
 * Submit a REPLACEMENT for the paid position-0 picture (the one that rides
 * digest/PIC). It NEVER swaps in directly (user-recorded decision (a)): the
 * upload is byte-sniffed, re-hosted, and parked in ad_photo_submissions with
 * the replace marker — the admin resolve path swaps position 0 on approval.
 */
export async function replaceMyPic(formData: FormData): Promise<void> {
  const { phone, ad } = await requireMyAd(formData);
  // Approved ads only: a pending ad's picture is already in front of the
  // admin with the ad itself, and closed/removed ads don't need a new one.
  if (ad.status !== "approved") redirect(`${BACK}?pic=notlive&id=${ad.id}`);
  // No position-0 picture means TEXT price was paid — a "replacement" would
  // be a free upgrade to a picture ad, so there's nothing to replace.
  if (!ad.photo) redirect(`${BACK}?pic=nopic&id=${ad.id}`);

  // One queued replacement at a time — a second upload before review would
  // just leave an orphaned storage object and a confusing double review.
  const pendingReplace = (await listPhotoSubmissions()).some(
    (s) => s.adId === ad.id && isPicReplaceSubmission(s.fromEmail),
  );
  if (pendingReplace) redirect(`${BACK}?pic=waiting&id=${ad.id}`);

  const upload = formData.get("photo");
  if (!(upload instanceof File) || upload.size === 0 || upload.size > MAX_UPLOAD_BYTES) {
    redirect(`${BACK}?pic=badphoto&id=${ad.id}`);
  }
  // Position 0 rides the digest and PIC MMS replies, so ONLY a re-hosted
  // image is acceptable — same rule as the paid listing picture at post time.
  // Dev has no bucket: degrade to a refusal exactly like item 9's listing
  // picture (a data: URI must never land at position 0 — next/image and the
  // MMS sender both choke on it).
  if (!supabaseConfigured) redirect(`${BACK}?pic=nostore&id=${ad.id}`);
  const stored = await storeImageBytes(Buffer.from(await upload.arrayBuffer()));
  if (!stored.ok) redirect(`${BACK}?pic=badphoto&id=${ad.id}`);

  const outcome = await addPhotoSubmission(ad.id, stored.url, picReplaceFrom(formatPhone(phone)));
  if (outcome === "unsupported") redirect(`${BACK}?pic=unsupported&id=${ad.id}`);
  redirect(`${BACK}?pic=submitted&id=${ad.id}`);
}

/**
 * Store one web-only extra picture's bytes. Prod re-hosts via storeImageBytes
 * (byte-sniffed, our bucket); dev has no bucket, so — exactly like the item-9
 * and emailed-in extras paths — the sniff-verified image is inlined as a data
 * URI so the review/gallery flow still works in walks. Null = unusable bytes.
 */
async function storeExtraBytes(bytes: Buffer): Promise<string | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
  if (supabaseConfigured) {
    const stored = await storeImageBytes(bytes);
    return stored.ok ? stored.url : null;
  }
  const ext = sniffImage(bytes);
  return ext ? `data:${CONTENT_TYPE_BY_EXT[ext]};base64,${bytes.toString("base64")}` : null;
}

/**
 * Add web-only extra pictures to one of my ads — the item-1/9 gallery path:
 * each goes through ad_photo_submissions PENDING admin review, capped at 8
 * pictures per ad total (live + pending).
 */
export async function addMyExtras(formData: FormData): Promise<void> {
  const { phone, ad } = await requireMyAd(formData);
  // Live-ish ads only — the same rule as the emailed-in extras route.
  if (ad.status !== "approved" && ad.status !== "pending") {
    redirect(`${BACK}?extras=notlive&id=${ad.id}`);
  }
  const files = formData
    .getAll("extras")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) redirect(`${BACK}?extras=none&id=${ad.id}`);
  const room = Math.max(0, MAX_PHOTOS_PER_AD - (await countAdPhotos(ad.id)));
  if (room === 0) redirect(`${BACK}?extras=noroom&id=${ad.id}`);

  let saved = 0;
  let skipped = Math.max(0, files.length - room);
  for (const file of files.slice(0, room)) {
    const url = await storeExtraBytes(Buffer.from(await file.arrayBuffer()));
    if (!url) {
      skipped++;
      continue;
    }
    const outcome = await addPhotoSubmission(ad.id, url, `web upload — ${formatPhone(phone)}`);
    if (outcome === "unsupported") redirect(`${BACK}?extras=unsupported&id=${ad.id}`);
    saved++;
  }
  redirect(`${BACK}?extras=${saved}&extraskip=${skipped}&id=${ad.id}`);
}

/**
 * An ad that reads 'deleted' on the member's delete path may be (a) a benign
 * retry after a completed delete+refund, (b) a member delete that crashed
 * AFTER the status flip but BEFORE its refund insert, or (c) an admin delete —
 * which deliberately never auto-refunds (the manual remedy is Grant credits).
 * (b) and (c) are indistinguishable from the ad row alone, so NEVER auto-
 * refund here: when the charge looks recoverable (never broadcast, no
 * compensation on record) leave a loud operator signal instead.
 */
async function warnIfRefundMayBeDue(phone: string, adId: number): Promise<void> {
  try {
    if (await adEverBroadcast(adId)) return; // ran — no refund was due
    if (await hasLedgerRef(deleteRefundRef(adId))) return; // already refunded
    const ledger = await getLedger(phone);
    if (hasBenignRejectRefund(ledger, adId)) return; // refunded at rejection
    const charge = findAdCharge(ledger, adId);
    if (!charge) return; // nothing was ever charged
    console.warn(
      `[myads] ad #${adId} (${phone}) is already deleted but its never-run charge ` +
        `(${JSON.stringify(charge.note)}) has no refund on record. If a member delete ` +
        `died mid-flight this refund is DUE (ledger ref ${deleteRefundRef(adId)} is ` +
        `unused — settle it with Grant credits); an admin no-refund delete looks ` +
        `identical, which is why this is a signal, not an auto-refund.`,
    );
  } catch (e) {
    console.warn(`[myads] due-refund check for ad #${adId} failed:`, e);
  }
}

/**
 * Delete one of my ads (two-step: the page's ?delete=<id> confirm box POSTs
 * here). Soft-delete exactly like the admin path — status 'deleted', photos
 * removed from storage, queued bumps dropped — with THE REFUND MATRIX (user
 * decision) on top: pending → refund; approved and never in any digest →
 * refund; ever broadcast → no refund. Refund mechanics mirror benign
 * rejection (free-pass-paid ads get the pass back, credit-paid the credits),
 * idempotent three ways: the status flip is a COMPARE-AND-SWAP on the exact
 * status the refund decision was computed from (a lost race re-reads and
 * re-decides, so an admin benign-reject landing mid-flight can never make
 * both paths pay), the deterministic ledger ref can't insert twice, and an
 * earlier benign-rejection refund blocks a second payout for good. A dropped
 * QUEUED bump that was CHARGED is refunded on top, independent of the ad
 * matrix — that re-broadcast will now never run.
 */
export async function deleteMine(formData: FormData): Promise<void> {
  const { phone, ad } = await requireMyAd(formData);
  if (ad.status === "deleted") {
    // Serial retry of a crashed/raced delete — signal, never auto-refund.
    await warnIfRefundMayBeDue(phone, ad.id);
    redirect(`${BACK}?error=gone&id=${ad.id}`);
  }

  // Capture BEFORE the delete drops it: a still-queued bump that was charged
  // gets its money back below whatever the ad-charge decision says.
  const hadQueuedBump = (await getQueuedBumps()).some((b) => b.adId === ad.id);

  let current: StoredAd = ad;
  let decision = deleteRefundDecision(current.status, await adEverBroadcast(current.id));
  let outcome: "deleted" | "noop" | "unsupported" = "noop";
  for (let attempt = 0; attempt < 3; attempt++) {
    // CAS: only the observed status may transition. "noop" = the ad moved on
    // (admin approve/reject/delete won the race) — re-read, re-decide, retry.
    outcome = await deleteAdRecord(ad.id, current.status);
    if (outcome !== "noop") break;
    const fresh = await getAdRecord(ad.id);
    if (!fresh || fresh.status === "deleted") {
      await warnIfRefundMayBeDue(phone, ad.id);
      redirect(`${BACK}?error=gone&id=${ad.id}`);
      return; // unreachable (redirect throws) — keeps the flow explicit
    }
    current = fresh;
    decision = deleteRefundDecision(current.status, await adEverBroadcast(current.id));
  }
  if (outcome === "unsupported") redirect(`${BACK}?error=unsupported&id=${ad.id}`);
  if (outcome !== "deleted") redirect(`${BACK}?error=gone&id=${ad.id}`);

  const ledger = decision.refund || hadQueuedBump ? await getLedger(phone) : [];
  let refundParam = "no";
  if (decision.refund) {
    const ref = deleteRefundRef(ad.id);
    if ((await hasLedgerRef(ref)) || hasBenignRejectRefund(ledger, ad.id)) {
      refundParam = "none"; // refunded once already — never twice
    } else {
      const charge = findAdCharge(ledger, ad.id);
      if (charge && charge.delta < 0) {
        await addLedgerEntry(phone, {
          delta: -charge.delta,
          kind: "refund",
          note: `Refund — ad #${ad.id} deleted before it ran`,
          ref,
        });
        refundParam = `credits&amount=${-charge.delta}`;
      } else if (charge) {
        // A delta-0 spend = the ad was covered by a free ad pass.
        await grantFreeAd(phone);
        await addLedgerEntry(phone, {
          delta: 0,
          kind: "refund",
          note: `Free ad returned — ad #${ad.id} deleted before it ran`,
          ref,
        });
        refundParam = "pass";
      } else {
        refundParam = "none"; // no charge on record — nothing to give back
      }
    }
  }

  // The dropped queued bump: if a `Bump — ad #N` spend has no compensation on
  // record (queue-failure refund or an earlier run of this one), give the
  // RECORDED amount back — idempotent via the deterministic ref.
  let bumpParam = "";
  if (hadQueuedBump && !(await hasLedgerRef(deleteBumpRefundRef(ad.id)))) {
    const bumpCharge = findUnrefundedBumpCharge(ledger, ad.id);
    if (bumpCharge) {
      await addLedgerEntry(phone, {
        delta: -bumpCharge.delta,
        kind: "refund",
        note: deleteBumpRefundNote(ad.id),
        ref: deleteBumpRefundRef(ad.id),
      });
      bumpParam = `&bumprefund=${-bumpCharge.delta}`;
    }
  }
  redirect(`${BACK}?deleted=${ad.id}&refund=${refundParam}&why=${decision.reason}${bumpParam}`);
}
