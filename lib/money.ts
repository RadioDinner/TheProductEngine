/**
 * What a member's balance is actually MADE OF — and therefore how much of it
 * you may ever send back to a card (session 019).
 *
 * The user's ask, in their words: "Put something in place to prevent people
 * from depositing 20 and then getting refunded for the free ad credit."
 *
 * The hole: a member adds $20, gets the $40 starter credit on their first
 * post, and their balance reads $60. Refunds are operator-manual, so the only
 * thing standing between the service and handing back $60 for a $20 payment
 * was the operator remembering which dollars were whose. A balance is a single
 * number; it does not know that two thirds of it was a gift.
 *
 * So the balance is split into two buckets, and only one of them is money:
 *
 *   CASH     purchases (Stripe) and payments (a check, cash, a phone order).
 *            Real money the member handed over. Refundable.
 *   GRANTED  the starter credit, admin invite credit, courtesy make-goods.
 *            A marketing cost that never touched their wallet. NEVER
 *            refundable as cash, at any point, for any reason.
 *
 * SPENDING CONSUMES GRANTS FIRST. That is the member-friendly ordering — their
 * own money stays refundable for longer — and it is the one the service
 * publishes. The alternative (cash first) would let a member post one ad and
 * be told their $20 is gone while $40 of free credit sits in the account,
 * which is true arithmetic and an insulting sentence.
 *
 * Pure and dependency-free so the unit suite can pin every case, and so both
 * the admin user page and the income report read the same arithmetic.
 */

/** The ledger kinds this arithmetic understands. A superset of what the
 * database holds today: `payment`, `courtesy` and `payout` arrive with the
 * migration that splits the old catch-all `adjustment`. */
export type MoneyKind =
  | "grant"
  | "purchase"
  | "spend"
  | "refund"
  | "adjustment"
  | "payment"
  | "courtesy"
  | "payout";

export interface MoneyEntry {
  delta: number;
  kind: MoneyKind | string;
}

export interface MoneyPosition {
  /** The plain sum of deltas — what the member sees. */
  balanceCents: number;
  /** Real money in: Stripe purchases plus hand-entered check/cash payments. */
  cashInCents: number;
  /** Credit given away: starter credit, invite credit, courtesy make-goods. */
  grantedCents: number;
  /** Legacy positive `adjustment` rows, from before the kinds were split.
   * COUNTED AS GRANTED above — see the note on conservatism below. */
  unclassifiedCents: number;
  /** Everything ever spent on ads (a positive number). */
  spentCents: number;
  /** Credit handed back to the BALANCE when an ad was declined or pulled. */
  adRefundedCents: number;
  /** Money actually sent back out to a card or by cheque (a positive number). */
  paidOutCents: number;
  /** Of the balance, the part that is the member's own money. THE REFUND CAP. */
  cashRemainingCents: number;
  /** Of the balance, the part that was given away. Never refundable. */
  grantRemainingCents: number;
}

const ZERO: MoneyPosition = {
  balanceCents: 0,
  cashInCents: 0,
  grantedCents: 0,
  unclassifiedCents: 0,
  spentCents: 0,
  adRefundedCents: 0,
  paidOutCents: 0,
  cashRemainingCents: 0,
  grantRemainingCents: 0,
};

/**
 * Split a member's ledger into what they paid and what they were given.
 *
 * Two deliberate conservatisms cover the rows written before the kinds were
 * split, when `adjustment` meant both "a $50 cheque arrived" and "here's $10
 * for the trouble":
 *
 *   a POSITIVE legacy adjustment counts as GRANTED, not cash — so an
 *   unclassified row can never inflate what may be refunded;
 *   a NEGATIVE legacy adjustment counts as money already PAID OUT — so it can
 *   never be double-refunded.
 *
 * Both err the same way: toward refunding less. `unclassifiedCents` is
 * reported separately so the income report can say plainly how much of the
 * history is guesswork rather than quietly folding it into a total.
 */
export function moneyPosition(entries: readonly MoneyEntry[]): MoneyPosition {
  const out: MoneyPosition = { ...ZERO };

  for (const entry of entries) {
    const delta = Math.round(Number(entry.delta));
    if (!Number.isFinite(delta)) continue;
    out.balanceCents += delta;

    switch (entry.kind) {
      case "purchase":
      case "payment":
        // Real money arriving. A negative one is a correction to a payment,
        // so it comes straight back off cash in.
        out.cashInCents += delta;
        break;
      case "grant":
      case "courtesy":
        out.grantedCents += delta;
        break;
      case "spend":
        // Spends are stored negative; a stray positive is not a spend.
        out.spentCents += Math.max(0, -delta);
        break;
      case "refund":
        out.adRefundedCents += Math.max(0, delta);
        break;
      case "payout":
        out.paidOutCents += Math.max(0, -delta);
        break;
      case "adjustment":
      default:
        // The legacy catch-all, and anything a future migration adds that this
        // build has not been taught. Conservative both ways.
        if (delta >= 0) {
          out.grantedCents += delta;
          out.unclassifiedCents += delta;
        } else {
          out.paidOutCents += -delta;
          out.unclassifiedCents += -delta;
        }
        break;
    }
  }

  // Grants are consumed FIRST, so cash survives as long as it honestly can.
  // Ad refunds put credit back, so it is the NET spend that consumed anything.
  const netSpent = Math.max(0, out.spentCents - out.adRefundedCents);
  const grantConsumed = Math.min(netSpent, Math.max(0, out.grantedCents));
  const cashConsumed = netSpent - grantConsumed;

  out.grantRemainingCents = Math.max(0, out.grantedCents - grantConsumed);
  out.cashRemainingCents = Math.max(0, out.cashInCents - cashConsumed - out.paidOutCents);

  // The two buckets must add up to the balance the member sees, or one of the
  // two numbers on the admin page is a lie. They can only disagree when the
  // ledger itself is odd (a negative balance, a hand-edited row), and in that
  // case the CASH side gives way — never refund more than the balance.
  const bucketed = out.grantRemainingCents + out.cashRemainingCents;
  if (bucketed > out.balanceCents) {
    out.cashRemainingCents = Math.max(0, out.cashRemainingCents - (bucketed - out.balanceCents));
    out.grantRemainingCents = Math.max(
      0,
      Math.min(out.grantRemainingCents, out.balanceCents - out.cashRemainingCents),
    );
  }

  return out;
}

/**
 * The most that may be sent back to this member's card, in cents.
 *
 * This is the number the operator must not exceed, and the whole point of the
 * module. It is never more than the balance and never more than the cash they
 * actually paid in, less anything already returned.
 */
export function refundableCents(entries: readonly MoneyEntry[]): number {
  return moneyPosition(entries).cashRemainingCents;
}

/**
 * The card processing fee kept from a voluntary refund of unused balance
 * (user decision, session 019), in cents.
 *
 * Stripe does NOT return the 2.9% + $0.30 it took when the money came in, so a
 * refund costs the service that fee whatever it does. On the smallest top-up
 * preset ($20) the fee is 4.4%; 5% is the smallest round number that covers
 * every preset, which is what makes this cost recovery rather than a penalty.
 *
 * NOT charged when the refund is the service's own fault — a double charge, an
 * outage, an ad pulled by the operator. Those are `whoseFault: "ours"`.
 */
export const REFUND_FEE_PERCENT = 5;

export function refundFeeCents(
  amountCents: number,
  whoseFault: "ours" | "theirs" = "theirs",
): number {
  if (whoseFault === "ours") return 0;
  const amount = Math.max(0, Math.round(amountCents));
  return Math.round((amount * REFUND_FEE_PERCENT) / 100);
}

/** What actually lands back on the card once the fee is kept. */
export function refundNetCents(
  amountCents: number,
  whoseFault: "ours" | "theirs" = "theirs",
): number {
  const amount = Math.max(0, Math.round(amountCents));
  return amount - refundFeeCents(amount, whoseFault);
}

// ---------- the income question ----------

/**
 * The service-wide money picture (the user's session-018 question: "how do I
 * measure ACTUAL income, since fifty people prepaying $50 and never posting is
 * $2,500 collected but nothing earned").
 *
 * The distinction that matters: money in is a LIABILITY until an ad runs.
 * Cash collected is not revenue earned.
 */
export interface IncomeSummary {
  /** Real money taken in: Stripe purchases plus hand-entered payments. */
  cashCollectedCents: number;
  /** EARNED: what members actually spent on ads, less what was given back. */
  revenueEarnedCents: number;
  /** Of that earned revenue, the part paid for with granted credit — i.e.
   * ads that ran but that nobody ever paid cash for. Not income. */
  earnedFromGrantsCents: number;
  /** Earned revenue backed by real money. THIS is the income figure. */
  earnedFromCashCents: number;
  /** Still owed to members as unspent balance, and refundable. */
  unearnedCashCents: number;
  /** Unspent granted credit — a promise, but never a cash liability. */
  unearnedGrantCents: number;
  /** Credit given away, all time. A marketing cost, never revenue. */
  grantedIssuedCents: number;
  /** Money handed back out to cards. */
  paidOutCents: number;
  /** How much of the above rests on unclassified legacy rows. */
  unclassifiedCents: number;
}

/** How the income report answers "is this every row, or only most of them?" */
export interface IncomeCoverage {
  /** Ledger rows read. */
  rows: number;
  /** Members with any ledger history at all. */
  members: number;
  /** True when the read hit its ceiling and the figures are therefore a
   * FLOOR rather than a total. The page must say so. */
  truncated: boolean;
}

/**
 * Roll a set of per-member positions into the service-wide picture.
 *
 * Deliberately built from POSITIONS, not from raw ledger rows: grants-first
 * spending is a per-member rule, so summing the raw kinds service-wide would
 * mis-split earned revenue between cash and grants the moment one member is
 * still on their starter credit while another is spending their own money.
 */
export function incomeSummary(positions: readonly MoneyPosition[]): IncomeSummary {
  const out: IncomeSummary = {
    cashCollectedCents: 0,
    revenueEarnedCents: 0,
    earnedFromGrantsCents: 0,
    earnedFromCashCents: 0,
    unearnedCashCents: 0,
    unearnedGrantCents: 0,
    grantedIssuedCents: 0,
    paidOutCents: 0,
    unclassifiedCents: 0,
  };

  for (const p of positions) {
    const netSpent = Math.max(0, p.spentCents - p.adRefundedCents);
    const fromGrants = Math.min(netSpent, Math.max(0, p.grantedCents));
    out.cashCollectedCents += p.cashInCents;
    out.revenueEarnedCents += netSpent;
    out.earnedFromGrantsCents += fromGrants;
    out.earnedFromCashCents += netSpent - fromGrants;
    out.unearnedCashCents += p.cashRemainingCents;
    out.unearnedGrantCents += p.grantRemainingCents;
    out.grantedIssuedCents += p.grantedCents;
    out.paidOutCents += p.paidOutCents;
    out.unclassifiedCents += p.unclassifiedCents;
  }
  return out;
}
