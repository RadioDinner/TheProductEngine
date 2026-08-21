/**
 * WHEN AN AD IS PAID FOR (session 023, user decision).
 *
 * The rule the whole file exists to serve, in the user's words: *"when people
 * create an ad, and have a card on file, I want the confirmation message to
 * include that the card won't be charged until the ad is run. Make the system
 * honor the truth of this message."*
 *
 * So the money moves when the ad RUNS — the moment it goes out to subscribers
 * — and not a minute earlier. Posting an ad quotes a price and writes it down;
 * the batch that carries the ad is what collects it.
 *
 * ### What that changes, and why it is the right way round
 *
 * Before this, an ad was charged the instant it was texted in, which meant the
 * service took money for ads it had not yet run and sometimes never would: an
 * ad turned down at review was charged and then refunded, a round trip through
 * a member's balance for a service that never happened. The refund matrix
 * already knew the distinction — `deleteRefundDecision` in lib/myads.ts has
 * said "ran" versus "never-ran" since session 009 — so charging at the run is
 * the arithmetic the rest of the system was already written against. Rejecting
 * an ad now returns nothing because nothing was taken.
 *
 * ### Reservations: why posting still checks the balance
 *
 * Not charging is not the same as not counting. A quoted-but-uncollected price
 * stays RESERVED against the member's balance (`ads.owed_cents`), so $40 of
 * credit still buys exactly two $20 ads however many are in flight. Without
 * that, a member with $20 could put five ads into the review queue, have every
 * one of them approved by hand, and then discover four of them at the till.
 * The operator's time is the scarce thing here, and the reservation is what
 * protects it.
 *
 * ### An unfunded ad is REVIEWED, not refused
 *
 * User decision, same session: *"I approved the ad, but it wasn't paid, I want
 * the status to go to 'approved, pending payment' but I want the message that
 * the seller gets, to remind them to pay up."* So a member who cannot cover an
 * ad still gets it read, and still gets a yes or a no. An approved-but-unfunded
 * ad holds its place in the queue and goes out on the next batch after the
 * money lands — nobody has to approve it twice.
 *
 * The one guard on that is `maxAwaitingPayment`: past a few ads waiting on
 * money from the same number, further posts are HELD out of the queue instead
 * (the session-020 `unpaid` path, unchanged). Reviewing is work, and a number
 * with no money and no card should not be able to fill a morning with it.
 *
 * Pure by design — no clock, no database — so every boundary below is pinned
 * by test/ad-funding.test.mjs.
 */

/** How an ad's price stands against what the member can actually pay. */
export type FundingState =
  /** Their ad credit covers it. Nothing to do but run the ad. */
  | "covered"
  /** Credit is short, but a card is on file to make up the difference. */
  | "card"
  /** Credit is short and there is no card — the ad waits for money. */
  | "owing";

export interface FundingInputs {
  /** What the ad was quoted, in cents. */
  costCents: number;
  /** Their ad credit, in cents. */
  balanceCents: number;
  /** Cents already promised to ads that haven't run yet. */
  reservedCents: number;
  /** A card we could charge when the ad runs. */
  hasCard: boolean;
}

/** Credit not already promised to an ad that hasn't run. Never negative: a
 * balance that has somehow gone under its reservations (a refund clawed back,
 * a hand-entered payout) reads as nothing spare rather than as a debt. */
export function availableCents(balanceCents: number, reservedCents: number): number {
  return Math.max(0, Math.round(balanceCents) - Math.max(0, Math.round(reservedCents)));
}

/** How much more is needed. Zero once the credit covers it. */
export function shortfallCents(costCents: number, availableCents: number): number {
  return Math.max(0, Math.round(costCents) - Math.max(0, Math.round(availableCents)));
}

export function fundingState(inputs: FundingInputs): FundingState {
  const spare = availableCents(inputs.balanceCents, inputs.reservedCents);
  if (spare >= Math.round(inputs.costCents)) return "covered";
  return inputs.hasCard ? "card" : "owing";
}

export interface PostDecision {
  /** Into the review queue (true) or held out of it (false). */
  accept: boolean;
  state: FundingState;
  /** What is still needed, in cents. 0 when covered. */
  shortfallCents: number;
  /** Spare credit at the moment of posting, in cents. */
  availableCents: number;
}

/**
 * What to do with an ad that has just been texted or posted in.
 *
 * `awaitingPayment` counts the member's ads that are already through the door
 * and waiting on money. Once that reaches `maxAwaitingPayment` the answer is
 * `accept: false` and the caller holds the ad instead — see the file header.
 * A `maxAwaitingPayment` of 0 turns the guard off entirely (every ad is
 * reviewed, however many are waiting), which is a legitimate setting for an
 * operator who would rather see everything.
 */
export function postDecision(
  inputs: FundingInputs & { awaitingPayment: number; maxAwaitingPayment: number },
): PostDecision {
  const spare = availableCents(inputs.balanceCents, inputs.reservedCents);
  const state = fundingState(inputs);
  const shortfall = shortfallCents(inputs.costCents, spare);
  const cap = Math.max(0, Math.floor(inputs.maxAwaitingPayment || 0));
  // Only an ad that CANNOT be paid for counts against the guard, and only an
  // unpayable ad can be turned away by it. A member with money in hand may
  // post as many as they like — they are paying for each one.
  const accept = state !== "owing" || cap === 0 || inputs.awaitingPayment < cap;
  return { accept, state, shortfallCents: shortfall, availableCents: spare };
}

/**
 * How many of a member's waiting ads their money doesn't currently reach.
 *
 * `owed` is every ad they have quoted and not yet run, oldest first — the same
 * order the batches will collect in — so the count is the tail their balance
 * runs out before. A card on file makes the answer zero: they can pay for all
 * of them, they simply haven't yet.
 *
 * This is what the posting guard counts (see postDecision). Counting ads
 * rather than dollars is deliberate: the thing being rationed is the
 * operator's review time, and an ad is an ad whatever it costs.
 */
export function unfundedAdCount(
  owed: number[],
  balanceCents: number,
  hasCard: boolean,
): number {
  if (hasCard) return 0;
  let remaining = Math.max(0, Math.round(balanceCents));
  let unfunded = 0;
  for (const cents of owed) {
    const cost = Math.max(0, Math.round(cents));
    if (remaining >= cost) remaining -= cost;
    else unfunded += 1;
  }
  return unfunded;
}

/**
 * What is left for ONE ad once the ads ahead of it have taken their share.
 *
 * `owed` is the member's unrun ads oldest-first, which is the order the batches
 * collect in — so an ad's real purse is the balance minus everything queued in
 * front of it, not the whole balance.
 *
 * Getting this wrong produces exactly the confusion the approval message
 * exists to prevent: a member with $20 and two $20 ads is told the first one
 * goes out (true) and the second one goes out (false), and then gets a "we
 * couldn't collect" text about the second an hour later. Measured this way,
 * the second is correctly told at approval time that it is waiting for money.
 */
export function purseForAd(
  owed: { id: number; owedCents: number }[],
  adId: number,
  balanceCents: number,
): number {
  let ahead = 0;
  for (const ad of owed) {
    if (ad.id === adId) break;
    ahead += Math.max(0, Math.round(ad.owedCents));
  }
  return Math.max(0, Math.round(balanceCents) - ahead);
}

export interface RunChargePlan {
  /** Cents to take from the ad credit balance. */
  fromCreditCents: number;
  /** Cents to raise from the saved card first. 0 = no card needed. */
  fromCardCents: number;
  /** Nothing can pay for this right now. */
  blocked: boolean;
}

/**
 * How to collect for an ad that is about to go out.
 *
 * Credit first, card for the rest — the same order the service has always used
 * and the one members expect: money already on the account is spent before a
 * card is touched. `reservedCents` deliberately does NOT apply here. A
 * reservation exists to stop a member over-committing at posting time; at the
 * till the ad in hand is the one being paid for, and netting it against its own
 * reservation would make every ad unpayable.
 */
export function runChargePlan(args: {
  owedCents: number;
  balanceCents: number;
  hasCard: boolean;
}): RunChargePlan {
  const owed = Math.max(0, Math.round(args.owedCents));
  const balance = Math.max(0, Math.round(args.balanceCents));
  if (owed === 0) return { fromCreditCents: 0, fromCardCents: 0, blocked: false };
  if (balance >= owed) return { fromCreditCents: owed, fromCardCents: 0, blocked: false };
  if (!args.hasCard) return { fromCreditCents: 0, fromCardCents: 0, blocked: true };
  return { fromCreditCents: owed, fromCardCents: owed - balance, blocked: false };
}

/**
 * What to call an ad's state on an admin screen.
 *
 * "Approved — waiting for payment" is the user's own phrasing for the case
 * they hit (session 023). The distinction it draws is the one an operator
 * actually needs: an approved ad that is merely queued will go out on its own,
 * and an approved ad that is short will not, however long they wait.
 */
export function fundingLabel(args: {
  status: string;
  owedCents: number;
  everRan: boolean;
  fundable: boolean;
}): string {
  if (args.everRan || args.owedCents <= 0) return "";
  if (args.status === "unpaid") return "Held — waiting for payment";
  if (args.fundable) return args.status === "approved" ? "Approved — pays when it runs" : "Pays when it runs";
  return args.status === "approved" ? "Approved — waiting for payment" : "Waiting for payment";
}
