// Member ad management (FEATURES item 16) — the delete refund matrix (a user
// decision, recorded verbatim) and the ledger/marker matchers the actions and
// pages share. The matrix: pending → refund; approved and never in any digest
// → refund; ever broadcast → NO refund; rejected/sold/expired/deleted → no.
import {
  deleteRefundDecision,
  deleteRefundRef,
  adRefundableTotal,
  findAdCharge,
  hasBenignRejectRefund,
  isPicReplaceSubmission,
  legacyPassRefundCents,
  picReplaceFrom,
  PIC_REPLACE_MARKER,
} from "../lib/myads.ts";

export const name = "myads";

export function run(t) {
  /* ---- a HELD (unpaid) ad refunds nothing, because nothing was charged ----
   * Migration 9953: an unfunded ad is written down rather than refused. It has
   * never taken the member's money, so deleting it gives none back — and it
   * must never be mistaken for a paid "pending" ad, which does refund. */
  const held = deleteRefundDecision("unpaid", false);
  t.eq("deleting a held ad refunds nothing", held.refund, false);
  t.eq("...and reads as still-waiting, not as closed business", held.reason, "pending");
  t.eq("a PAID pending ad still refunds", deleteRefundDecision("pending", false).refund, true);

  // ---- the refund matrix, exactly as the user decided it ----
  t.eq(
    "pending → refund",
    deleteRefundDecision("pending", false),
    { refund: true, reason: "pending" },
  );
  t.eq(
    "approved, never broadcast → refund",
    deleteRefundDecision("approved", false),
    { refund: true, reason: "never-ran" },
  );
  t.eq(
    "approved, ever broadcast → NO refund (game over)",
    deleteRefundDecision("approved", true),
    { refund: false, reason: "ran" },
  );
  t.eq(
    "rejected (violation or benign) never refunds on delete",
    deleteRefundDecision("rejected", false),
    { refund: false, reason: "rejected" },
  );
  // Even a weird rejected-and-broadcast record refuses: rejected wins.
  t.eq(
    "rejected beats broadcast",
    deleteRefundDecision("rejected", true),
    { refund: false, reason: "rejected" },
  );
  t.eq(
    "sold → closed business, no refund",
    deleteRefundDecision("sold", false),
    { refund: false, reason: "closed" },
  );
  t.eq(
    "sold after broadcast → ran",
    deleteRefundDecision("sold", true),
    { refund: false, reason: "ran" },
  );
  t.eq(
    "expired, never broadcast → closed, no refund",
    deleteRefundDecision("expired", false),
    { refund: false, reason: "closed" },
  );
  t.eq(
    "expired after broadcast → ran",
    deleteRefundDecision("expired", true),
    { refund: false, reason: "ran" },
  );
  t.eq(
    "already deleted → nothing",
    deleteRefundDecision("deleted", false),
    { refund: false, reason: "gone" },
  );

  // ---- the deterministic idempotency ref ----
  t.eq("refund ref shape", deleteRefundRef(1042), "member-delete-refund-ad-1042");

  // ---- finding the original charge (the ledger-note API; deltas in CENTS) ----
  const ledger = [
    { kind: "grant", delta: 15000, note: "Welcome credit — $150 to spend on ads" },
    { kind: "spend", delta: 0, note: "Free ad used — ad #12 (text)" }, // legacy pass ad
    { kind: "spend", delta: -6000, note: "Ad #125 (picture)" },
    { kind: "spend", delta: -4500, note: "Ad #1042 (text)" },
  ];
  t.eq("finds a dollar charge", findAdCharge(ledger, 1042)?.delta, -4500);
  t.eq("finds a legacy free-pass charge (delta 0)", findAdCharge(ledger, 12)?.delta, 0);
  t.eq("ad #12 does not match ad #125", findAdCharge(ledger, 12)?.note, "Free ad used — ad #12 (text)");
  t.eq("#125 finds its own charge", findAdCharge(ledger, 125)?.delta, -6000);
  t.eq("no charge → undefined", findAdCharge(ledger, 999), undefined);

  // ---- the refundable total (base + picture upgrade + web add-on) ----
  t.eq("total for a plain dollar charge", adRefundableTotal(ledger, 1042), 4500);
  t.eq("total for a legacy pass-paid ad is 0", adRefundableTotal(ledger, 12), 0);
  t.eq("total for no charge is 0", adRefundableTotal(ledger, 999), 0);
  const upgraded = [
    ...ledger,
    { kind: "spend", delta: -1500, note: "Ad #1042 (picture upgrade)" },
  ];
  t.eq("upgrade joins the refund total", adRefundableTotal(upgraded, 1042), 6000);
  t.eq("#104 does not absorb #1042's upgrade", adRefundableTotal(upgraded, 104), 0);
  const upgradeReturned = [
    ...upgraded,
    { kind: "refund", delta: 1500, note: "Refund — ad #1042 (picture upgrade) didn't attach" },
  ];
  t.eq("a failed-attach refund nets out of the total", adRefundableTotal(upgradeReturned, 1042), 4500);
  const withAddon = [
    ...ledger,
    { kind: "spend", delta: -1500, note: "Ad #1042 (website listing)" },
  ];
  t.eq("the website add-on joins the refund total", adRefundableTotal(withAddon, 1042), 6000);

  // ---- the never-refund-twice guard ----
  const refunded = [
    ...ledger,
    { kind: "refund", delta: 4500, note: "Refund — ad #1042 not accepted" },
  ];
  t.eq("benign-reject refund blocks a second refund", hasBenignRejectRefund(refunded, 1042), true);
  t.eq("legacy free-pass benign refund also blocks", hasBenignRejectRefund(
    [{ kind: "refund", delta: 0, note: "Free ad returned — ad #7 not accepted" }],
    7,
  ), true);
  t.eq("#104 does not match #1042's refund", hasBenignRejectRefund(refunded, 104), false);
  t.eq("clean ledger → no block", hasBenignRejectRefund(ledger, 12), false);

  // ---- the legacy free-pass dollar refund (session 016: passes are gone;
  // a delta-0 pass ad refunds the CURRENT price of its kind) ----
  t.eq(
    "legacy picture-pass ad refunds the picture price",
    legacyPassRefundCents("Free ad used — ad #12 (picture)", 4500, 6000),
    6000,
  );
  t.eq(
    "legacy text-pass ad refunds the text price",
    legacyPassRefundCents("Free ad used — ad #12 (text)", 4500, 6000),
    4500,
  );
  t.eq(
    "unparseable note falls back to the text price",
    legacyPassRefundCents("Free ad used — ad #12", 4500, 6000),
    4500,
  );

  // ---- the replacement-picture marker ----
  const from = picReplaceFrom("(330) 555-0142");
  t.eq("replace marker prefixes the from field", from.startsWith(PIC_REPLACE_MARKER), true);
  t.eq("replace submission detected", isPicReplaceSubmission(from), true);
  t.eq(
    "item-9 web extras marker is NOT a replacement",
    isPicReplaceSubmission("web upload — (330) 555-0142"),
    false,
  );
  t.eq("emailed-in extras are NOT replacements", isPicReplaceSubmission("neighbor@example.com"), false);
}
