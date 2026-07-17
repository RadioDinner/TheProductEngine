// Member ad management (FEATURES item 16) — the delete refund matrix (a user
// decision, recorded verbatim) and the ledger/marker matchers the actions and
// pages share. The matrix: pending → refund; approved and never in any digest
// → refund; ever broadcast → NO refund; rejected/sold/expired/deleted → no.
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
  PIC_REPLACE_MARKER,
} from "../lib/myads.ts";

export const name = "myads";

export function run(t) {
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

  // ---- finding the original charge (the ledger-note API) ----
  const ledger = [
    { kind: "grant", delta: 3, note: "Welcome — 3 free ads, picture or plain" },
    { kind: "spend", delta: 0, note: "Free ad used — ad #12 (text)" },
    { kind: "spend", delta: -5, note: "Ad #125 (picture)" },
    { kind: "spend", delta: -1, note: "Ad #1042 (text)" },
    { kind: "refund", delta: 1, note: "Bump not applied — ad #1042" },
  ];
  t.eq("finds a credit charge", findAdCharge(ledger, 1042)?.delta, -1);
  t.eq("finds a free-pass charge (delta 0)", findAdCharge(ledger, 12)?.delta, 0);
  t.eq("ad #12 does not match ad #125", findAdCharge(ledger, 12)?.note, "Free ad used — ad #12 (text)");
  t.eq("#125 finds its own charge", findAdCharge(ledger, 125)?.delta, -5);
  t.eq("no charge → undefined", findAdCharge(ledger, 999), undefined);

  // ---- the never-refund-twice guard ----
  const refunded = [
    ...ledger,
    { kind: "refund", delta: 1, note: "Refund — ad #1042 not accepted" },
  ];
  t.eq("benign-reject refund blocks a second refund", hasBenignRejectRefund(refunded, 1042), true);
  t.eq("free-pass benign refund also blocks", hasBenignRejectRefund(
    [{ kind: "refund", delta: 0, note: "Free ad returned — ad #7 not accepted" }],
    7,
  ), true);
  t.eq("a bump refund does NOT block the delete refund", hasBenignRejectRefund(ledger, 1042), false);
  t.eq("#104 does not match #1042's refund", hasBenignRejectRefund(refunded, 104), false);
  t.eq("clean ledger → no block", hasBenignRejectRefund(ledger, 12), false);

  // ---- the dropped-queued-bump refund (delete gives a paid bump back) ----
  t.eq("bump refund ref shape", deleteBumpRefundRef(1042), "member-delete-bump-refund-ad-1042");
  t.eq(
    "bump refund note shape",
    deleteBumpRefundNote(1042),
    "Bump refunded — ad #1042 deleted before it ran",
  );
  t.eq(
    "bump refund note never reads as a benign-reject refund",
    hasBenignRejectRefund([{ kind: "refund", delta: 1, note: deleteBumpRefundNote(1042) }], 1042),
    false,
  );
  // Ledgers are newest-first (getLedger in both stores).
  const bumpLedger = [
    { kind: "spend", delta: -2, note: "Bump — ad #1042" },
    { kind: "refund", delta: 1, note: "Bump not applied — ad #1042" },
    { kind: "spend", delta: -1, note: "Bump — ad #1042" },
    { kind: "spend", delta: -1, note: "Ad #1042 (text)" },
  ];
  t.eq(
    "finds the newest uncompensated bump spend (recorded amount, not settings)",
    findUnrefundedBumpCharge(bumpLedger, 1042)?.delta,
    -2,
  );
  t.eq(
    "a fully compensated history finds nothing",
    findUnrefundedBumpCharge(
      [
        { kind: "spend", delta: -2, note: "Bump — ad #1042" },
        { kind: "refund", delta: 2, note: deleteBumpRefundNote(1042) },
      ],
      1042,
    ),
    undefined,
  );
  t.eq(
    "queue-failure refund also compensates",
    findUnrefundedBumpCharge(
      [
        { kind: "refund", delta: 1, note: "Bump not applied — ad #1042" },
        { kind: "spend", delta: -1, note: "Bump — ad #1042" },
      ],
      1042,
    ),
    undefined,
  );
  t.eq(
    "free bumps (no spend) refund nothing",
    findUnrefundedBumpCharge([{ kind: "spend", delta: -1, note: "Ad #1042 (text)" }], 1042),
    undefined,
  );
  t.eq(
    "#104's bump spend does not match #1042",
    findUnrefundedBumpCharge([{ kind: "spend", delta: -1, note: "Bump — ad #104" }], 1042),
    undefined,
  );
  t.eq(
    "the ad submission charge is never mistaken for a bump",
    findUnrefundedBumpCharge([{ kind: "spend", delta: -5, note: "Ad #1042 (picture)" }], 1042),
    undefined,
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
