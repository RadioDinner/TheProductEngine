// When an ad is paid for (session 021). The user's sentence is the spec:
// "when people create an ad, and have a card on file, I want the confirmation
// message to include that the card won't be charged until the ad is run. Make
// the system honor the truth of this message."
//
// So the money moves at the RUN. These are the boundaries that decide what a
// seller is told at posting time and what the batch collects at the till.
import {
  availableCents,
  fundingLabel,
  fundingState,
  postDecision,
  purseForAd,
  runChargePlan,
  shortfallCents,
  unfundedAdCount,
} from "../lib/ad-funding.ts";

export const name = "ad-funding";

export function run(t) {
  /* ---------------- available credit ---------------- */

  t.eq("nothing reserved — the whole balance is spare", availableCents(4000, 0), 4000);
  t.eq("one $20 ad in flight halves it", availableCents(4000, 2000), 2000);
  t.eq("fully committed", availableCents(4000, 4000), 0);
  // A balance under its own reservations (a payout, a clawed-back refund) is
  // "nothing spare", never a debt: the service has no debt system by decision.
  t.eq("over-committed reads as nothing spare, not a negative", availableCents(1000, 4000), 0);
  t.eq("a negative reservation can't mint money", availableCents(1000, -5000), 1000);

  t.eq("no shortfall when covered", shortfallCents(2000, 4000), 0);
  t.eq("shortfall is the gap", shortfallCents(5000, 2000), 3000);
  t.eq("exactly covered is not short", shortfallCents(2000, 2000), 0);

  /* ---------------- which of the three sentences a seller gets ---------------- */

  const covered = { costCents: 2000, balanceCents: 4000, reservedCents: 0, hasCard: false };
  t.eq("credit covers it", fundingState(covered), "covered");
  t.eq(
    "credit covers it exactly",
    fundingState({ ...covered, balanceCents: 2000 }),
    "covered",
  );
  // THE CASE THE USER ASKED ABOUT.
  t.eq(
    "short with a card on file — the card waits for the run",
    fundingState({ ...covered, balanceCents: 0, hasCard: true }),
    "card",
  );
  t.eq(
    "short with no card — the ad waits for money",
    fundingState({ ...covered, balanceCents: 0 }),
    "owing",
  );
  // Reservations are what stop a member's second ad reading as funded by money
  // their first ad has already spoken for.
  t.eq(
    "a reservation makes the second ad short",
    fundingState({ costCents: 2000, balanceCents: 4000, reservedCents: 3000, hasCard: false }),
    "owing",
  );
  t.eq(
    "$40 still buys exactly two $20 ads",
    fundingState({ costCents: 2000, balanceCents: 4000, reservedCents: 2000, hasCard: false }),
    "covered",
  );

  /* ---------------- posting: reviewed, or held out of the queue ---------------- */

  const post = (over) =>
    postDecision({
      costCents: 2000,
      balanceCents: 0,
      reservedCents: 0,
      hasCard: false,
      awaitingPayment: 0,
      maxAwaitingPayment: 3,
      ...over,
    });

  t.eq("an unfunded first ad is still REVIEWED", post({}).accept, true);
  t.eq("and it says so", post({}).state, "owing");
  t.eq("with the shortfall named", post({}).shortfallCents, 2000);
  t.eq("a second and third too", post({ awaitingPayment: 2 }).accept, true);
  t.eq("the fourth is held out of the queue", post({ awaitingPayment: 3 }).accept, false);
  t.eq("and beyond", post({ awaitingPayment: 9 }).accept, false);
  // The guard is about REVIEW TIME, not about poverty: money in hand means no
  // limit, because every one of those ads pays for itself as it runs.
  t.eq(
    "a paying member is never capped",
    post({ balanceCents: 100000, awaitingPayment: 9 }).accept,
    true,
  );
  t.eq(
    "nor is a member with a card on file",
    post({ hasCard: true, awaitingPayment: 9 }).accept,
    true,
  );
  t.eq("a cap of 0 turns the guard off entirely", post({ maxAwaitingPayment: 0, awaitingPayment: 99 }).accept, true);
  t.eq(
    "spare credit is reported for the reply",
    post({ balanceCents: 5000, reservedCents: 1000 }).availableCents,
    4000,
  );

  /* ---------------- how many of a member's ads are unfunded ---------------- */

  t.eq("no ads, nothing unfunded", unfundedAdCount([], 0, false), 0);
  t.eq("one ad, no money", unfundedAdCount([2000], 0, false), 1);
  t.eq("one ad, covered", unfundedAdCount([2000], 2000, false), 0);
  // Oldest first, which is the order the batches collect in: $40 covers the
  // first two of three $20 ads, so exactly one is unfunded.
  t.eq("the tail the balance doesn't reach", unfundedAdCount([2000, 2000, 2000], 4000, false), 1);
  t.eq("all three when there is nothing", unfundedAdCount([2000, 2000, 2000], 0, false), 3);
  // A cheap ad behind an expensive one still gets paid for if the money is
  // there — the walk doesn't stop at the first ad it can't cover.
  t.eq("a cheap ad behind an expensive one", unfundedAdCount([9000, 1000], 1000, false), 1);
  t.eq("a card on file means none of them are waiting", unfundedAdCount([2000, 2000], 0, true), 0);

  /* ---------------- what is left for ONE ad ---------------- */

  // Batches collect oldest-first, so an ad's real purse is the balance minus
  // everything queued ahead of it. Measuring against the whole balance is the
  // bug that told a member BOTH their $20 ads were on their way.
  const queue = [
    { id: 1, owedCents: 2000 },
    { id: 2, owedCents: 2000 },
    { id: 3, owedCents: 2000 },
  ];
  t.eq("the first ad has the whole balance", purseForAd(queue, 1, 4000), 4000);
  t.eq("the second has what the first leaves", purseForAd(queue, 2, 4000), 2000);
  t.eq("the third has nothing", purseForAd(queue, 3, 4000), 0);
  t.eq("never negative", purseForAd(queue, 3, 1000), 0);
  t.eq("an ad not in the queue sees the balance", purseForAd(queue, 99, 4000), 0);
  t.eq("an empty queue is the whole balance", purseForAd([], 1, 4000), 4000);
  // The exact case from the bug report: $20, two $20 ads.
  const two = [
    { id: 1, owedCents: 2000 },
    { id: 2, owedCents: 2000 },
  ];
  t.eq("first of two on $20 is covered", shortfallCents(2000, purseForAd(two, 1, 2000)), 0);
  t.eq("second of two on $20 is NOT", shortfallCents(2000, purseForAd(two, 2, 2000)), 2000);

  /* ---------------- collecting, at the run ---------------- */

  t.eq(
    "nothing owing is a no-op",
    runChargePlan({ owedCents: 0, balanceCents: 0, hasCard: false }),
    { fromCreditCents: 0, fromCardCents: 0, blocked: false },
  );
  t.eq(
    "credit pays it",
    runChargePlan({ owedCents: 2000, balanceCents: 5000, hasCard: false }),
    { fromCreditCents: 2000, fromCardCents: 0, blocked: false },
  );
  t.eq(
    "credit pays it exactly",
    runChargePlan({ owedCents: 2000, balanceCents: 2000, hasCard: true }),
    { fromCreditCents: 2000, fromCardCents: 0, blocked: false },
  );
  // Credit first, card for the rest — the order members expect, and the reason
  // a card holder with $5 on account is charged $15, not $20.
  t.eq(
    "the card covers only the gap",
    runChargePlan({ owedCents: 2000, balanceCents: 500, hasCard: true }),
    { fromCreditCents: 2000, fromCardCents: 1500, blocked: false },
  );
  t.eq(
    "no credit and no card blocks the run",
    runChargePlan({ owedCents: 2000, balanceCents: 500, hasCard: false }),
    { fromCreditCents: 0, fromCardCents: 0, blocked: true },
  );

  /* ---------------- what the operator sees ---------------- */

  // The user's own words for the state they hit.
  t.eq(
    "approved and unfunded",
    fundingLabel({ status: "approved", owedCents: 2000, everRan: false, fundable: false }),
    "Approved — waiting for payment",
  );
  t.eq(
    "approved and funded",
    fundingLabel({ status: "approved", owedCents: 2000, everRan: false, fundable: true }),
    "Approved — pays when it runs",
  );
  t.eq(
    "waiting for review and unfunded",
    fundingLabel({ status: "pending", owedCents: 2000, everRan: false, fundable: false }),
    "Waiting for payment",
  );
  t.eq(
    "held out of the queue",
    fundingLabel({ status: "unpaid", owedCents: 2000, everRan: false, fundable: false }),
    "Held — waiting for payment",
  );
  // Once it has run there is nothing to say: the money moved with it.
  t.eq(
    "an ad that ran is settled",
    fundingLabel({ status: "approved", owedCents: 2000, everRan: true, fundable: false }),
    "",
  );
  t.eq(
    "so is one with nothing owing (posted before this change)",
    fundingLabel({ status: "approved", owedCents: 0, everRan: false, fundable: false }),
    "",
  );
}
