// What a balance is MADE OF, and therefore what may be refunded (session 019).
//
// The user's ask: "prevent people from depositing 20 and then getting refunded
// for the free ad credit." Every check here exists because getting one of them
// wrong hands somebody else's money away, so the scam case is pinned first and
// the conservatism for legacy rows is pinned explicitly.
import {
  REFUND_FEE_PERCENT,
  incomeSummary,
  moneyPosition,
  refundFeeCents,
  refundNetCents,
  refundableCents,
} from "../lib/money.ts";

export const name = "money";

const e = (kind, delta) => ({ kind, delta });

export function run(t) {
  // ---- THE SCAM the user named ----
  // Add $20, take the $40 starter credit, post nothing. Balance reads $60.
  const scam = [e("purchase", 2000), e("grant", 4000)];
  t.eq("the balance really is $60", moneyPosition(scam).balanceCents, 6000);
  t.eq("but only the $20 they paid is refundable", refundableCents(scam), 2000);
  t.eq("the other $40 is granted", moneyPosition(scam).grantRemainingCents, 4000);
  // ...and after posting one $20 text ad, grants pay for it, cash survives.
  const scamThenAd = [...scam, e("spend", -2000)];
  t.eq("spending eats the GRANT first", moneyPosition(scamThenAd).grantRemainingCents, 2000);
  t.eq("their own $20 is still theirs", refundableCents(scamThenAd), 2000);
  t.eq("balance follows", moneyPosition(scamThenAd).balanceCents, 4000);

  // ---- pure grant: nothing to refund, ever ----
  const giftOnly = [e("grant", 4000)];
  t.eq("a pure gift refunds nothing", refundableCents(giftOnly), 0);
  t.eq("a pure gift still shows a balance", moneyPosition(giftOnly).balanceCents, 4000);
  t.eq("courtesy credit is a gift too", refundableCents([e("courtesy", 1000)]), 0);

  // ---- pure cash ----
  t.eq("cash with nothing spent is all refundable", refundableCents([e("purchase", 5000)]), 5000);
  t.eq("a hand-entered payment is cash", refundableCents([e("payment", 5000)]), 5000);
  const spentSome = [e("purchase", 5000), e("spend", -2000)];
  t.eq("with no grant, spending eats cash", refundableCents(spentSome), 3000);

  // ---- grants run out, then cash pays ----
  const burnedThrough = [e("grant", 4000), e("purchase", 2000), e("spend", -5000)];
  const bt = moneyPosition(burnedThrough);
  t.eq("the grant is gone", bt.grantRemainingCents, 0);
  t.eq("cash covered the rest", bt.cashRemainingCents, 1000);
  t.eq("the buckets add up to the balance", bt.grantRemainingCents + bt.cashRemainingCents, bt.balanceCents);
  t.eq("nothing is left after spending it all",
    refundableCents([e("grant", 4000), e("purchase", 2000), e("spend", -6000)]), 0);

  // ---- an ad refund puts credit BACK, so it never consumed anything ----
  const declined = [e("purchase", 5000), e("spend", -2000), e("refund", 2000)];
  t.eq("a declined ad leaves the cash refundable", refundableCents(declined), 5000);
  t.eq("a declined ad restores the balance", moneyPosition(declined).balanceCents, 5000);
  // The refund follows the same grants-first rule, so a member on starter
  // credit who has an ad declined does not silently convert grant into cash.
  const declinedOnGrant = [e("grant", 4000), e("purchase", 2000), e("spend", -2000), e("refund", 2000)];
  t.eq("a declined ad can't turn a grant into cash", refundableCents(declinedOnGrant), 2000);

  // ---- money already sent back can't be sent twice ----
  const alreadyPaid = [e("purchase", 5000), e("payout", -5000)];
  t.eq("a paid-out balance refunds nothing more", refundableCents(alreadyPaid), 0);
  t.eq("a partial payout leaves the rest",
    refundableCents([e("purchase", 5000), e("payout", -2000)]), 3000);
  t.eq("payouts are counted", moneyPosition(alreadyPaid).paidOutCents, 5000);

  // ---- LEGACY rows: both defaults must err toward refunding LESS ----
  // A positive `adjustment` might have been a cheque or a courtesy. Treating
  // it as cash would let an unclassified row fund a refund.
  const legacyIn = [e("adjustment", 5000)];
  t.eq("a legacy credit is NOT refundable", refundableCents(legacyIn), 0);
  t.eq("a legacy credit counts as granted", moneyPosition(legacyIn).grantRemainingCents, 5000);
  t.eq("and is reported as unclassified", moneyPosition(legacyIn).unclassifiedCents, 5000);
  // A negative one might have been a real payout. Treating it as anything else
  // would let the same money go out twice.
  const legacyOut = [e("purchase", 5000), e("adjustment", -2000)];
  t.eq("a legacy debit reduces what's refundable", refundableCents(legacyOut), 3000);
  t.eq("a legacy debit is unclassified too", moneyPosition(legacyOut).unclassifiedCents, 2000);
  // A kind from a future migration this build hasn't been taught falls the
  // same way rather than being silently treated as cash.
  t.eq("an unknown kind is not cash", refundableCents([e("someday", 5000)]), 0);

  // ---- the arithmetic can never promise more than the balance ----
  t.eq("an empty ledger is all zeroes", moneyPosition([]).balanceCents, 0);
  t.eq("an empty ledger refunds nothing", refundableCents([]), 0);
  t.eq("a negative balance refunds nothing",
    refundableCents([e("purchase", 2000), e("spend", -5000)]), 0);
  const odd = moneyPosition([e("purchase", 2000), e("spend", -5000)]);
  t.eq("a negative balance is reported honestly", odd.balanceCents, -3000);
  t.eq("but the buckets never exceed it", odd.cashRemainingCents + odd.grantRemainingCents <= Math.max(0, odd.balanceCents), true);
  t.eq("junk deltas are skipped", moneyPosition([e("purchase", NaN), e("purchase", 1000)]).cashInCents, 1000);
  // A refund correction on a payment comes straight back off cash.
  t.eq("a negative purchase reduces cash in",
    refundableCents([e("purchase", 5000), e("purchase", -2000)]), 3000);

  // Across a long realistic history the invariant still holds.
  const history = [
    e("grant", 4000), e("purchase", 2000), e("spend", -3000), e("purchase", 4000),
    e("spend", -3000), e("refund", 3000), e("spend", -2000), e("payment", 1000),
    e("courtesy", 500), e("payout", -1000),
  ];
  const h = moneyPosition(history);
  t.eq("a long history still adds up", h.cashRemainingCents + h.grantRemainingCents, h.balanceCents);
  t.eq("a long history never refunds more than was paid",
    h.cashRemainingCents <= h.cashInCents, true);

  // ---- the processing fee the user asked for ----
  t.eq("the fee is 5%", REFUND_FEE_PERCENT, 5);
  t.eq("$20 keeps $1", refundFeeCents(2000), 100);
  t.eq("$100 keeps $5", refundFeeCents(10000), 500);
  t.eq("$20 pays back $19", refundNetCents(2000), 1900);
  // Not charged when it was the service's own mistake.
  t.eq("our fault means no fee", refundFeeCents(2000, "ours"), 0);
  t.eq("our fault pays back in full", refundNetCents(2000, "ours"), 2000);
  t.eq("nothing refunds to nothing", refundFeeCents(0), 0);
  t.eq("a negative amount can't mint a fee", refundFeeCents(-5000), 0);
  // The whole reason 5% was chosen: it has to cover the WORST preset, which is
  // the smallest one ($20 → 2.9% + $0.30 = $0.88 = 4.4%).
  t.eq("5% covers the fee on the smallest preset", refundFeeCents(2000) >= 88, true);
  t.eq("5% covers the fee on the largest preset", refundFeeCents(10000) >= 320, true);

  // ---- the income question: collected is not earned ----
  // Fifty people prepay $50 and never post: $2,500 in, nothing earned.
  const prepaid = Array.from({ length: 50 }, () => moneyPosition([e("purchase", 5000)]));
  const idle = incomeSummary(prepaid);
  t.eq("cash collected is counted", idle.cashCollectedCents, 250000);
  t.eq("but nothing is earned", idle.revenueEarnedCents, 0);
  t.eq("and it is ALL still owed", idle.unearnedCashCents, 250000);

  // One of them posts $30 of ads: that much becomes earned, the rest still owed.
  const oneActive = [
    ...Array.from({ length: 49 }, () => moneyPosition([e("purchase", 5000)])),
    moneyPosition([e("purchase", 5000), e("spend", -3000)]),
  ];
  const busy = incomeSummary(oneActive);
  t.eq("spending is earned revenue", busy.revenueEarnedCents, 3000);
  t.eq("earned from real money", busy.earnedFromCashCents, 3000);
  t.eq("nothing earned came from grants", busy.earnedFromGrantsCents, 0);
  t.eq("the rest is still owed", busy.unearnedCashCents, 247000);

  // An ad paid for entirely with starter credit is revenue that earned NO cash.
  const onGrant = incomeSummary([moneyPosition([e("grant", 4000), e("spend", -2000)])]);
  t.eq("a granted ad still counts as revenue earned", onGrant.revenueEarnedCents, 2000);
  t.eq("but none of it is cash", onGrant.earnedFromCashCents, 0);
  t.eq("it is earned from grants", onGrant.earnedFromGrantsCents, 2000);
  t.eq("no cash was collected", onGrant.cashCollectedCents, 0);
  t.eq("the giveaway is tracked", onGrant.grantedIssuedCents, 4000);
  t.eq("and nothing is refundable", onGrant.unearnedCashCents, 0);

  t.eq("an empty service summarises to zero", incomeSummary([]).cashCollectedCents, 0);
  t.eq("unclassified rows are surfaced, not hidden",
    incomeSummary([moneyPosition([e("adjustment", 5000)])]).unclassifiedCents, 5000);
}
