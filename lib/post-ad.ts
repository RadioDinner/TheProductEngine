/**
 * Web ad posting (FEATURES item 9) — the pure pricing-preview half, so the
 * unit suite can pin it. Deliberately dependency-free (like lib/ad-display.ts
 * and lib/pic-quota.ts): the server action and page do the I/O and pass the
 * live numbers in.
 *
 * The web lane charges EXACTLY like texting AD NEW in: dollars off the
 * member's ad-credit balance at the live text/picture price (all values in
 * CENTS — dollar pricing, session 016). The one-time starter credit (first
 * real post) is previewed here so the form can say "your first post comes
 * with $150" BEFORE the member commits.
 */

export interface PostingFunds {
  /** Whether the one-time starter credit already fired for this member. */
  starterGranted: boolean;
  /** Current ad-credit balance in cents. */
  balanceCents: number;
  /** A saved card + the auto-top-up toggle on: shortfalls get covered. */
  autoTopUp: boolean;
}

export interface PostingPreview {
  /** Balance the member will have at posting time (starter credit included). */
  balanceAtPostCents: number;
  /** True when it's the first-post starter credit that supplies the money. */
  starterGrantApplies: boolean;
  canAffordText: boolean;
  canAffordPicture: boolean;
}

/** What posting will use, given the member's funds and the live prices. */
export function postingPreview(
  funds: PostingFunds,
  costTextCents: number,
  costPhotoCents: number,
  starterCreditCents: number,
): PostingPreview {
  const granted = funds.starterGranted ? 0 : Math.max(0, starterCreditCents);
  const balanceAtPostCents = Math.max(0, funds.balanceCents) + granted;
  return {
    balanceAtPostCents,
    starterGrantApplies: granted > 0,
    canAffordText: funds.autoTopUp || balanceAtPostCents >= costTextCents,
    canAffordPicture: funds.autoTopUp || balanceAtPostCents >= costPhotoCents,
  };
}

export type ChargeOutcome = {
  costCents: number;
  leftCents: number;
  /** Cents the saved card covered (0 = balance covered it all). */
  toppedUpCents: number;
  /** Set ("$150") when the one-time starter credit paid for this post. */
  welcomeLabel?: string;
};

/** Format cents — duplicated from lib/config formatPrice so this module
 * stays import-free for the unit runner; test/post-ad cross-checks them. */
function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The parenthesized charge note on the confirmation — EXACTLY the SMS lane's
 * wording (lib/engine.ts handleAdSubmission), so web and text posts read the
 * same everywhere.
 */
export function chargeNoteLine(charge: ChargeOutcome): string {
  let note = charge.welcomeLabel
    ? `${dollars(charge.costCents)} of your ${charge.welcomeLabel} welcome credit — ${dollars(charge.leftCents)} left.`
    : `${dollars(charge.costCents)} — ${dollars(charge.leftCents)} of ad credit left.`;
  if (charge.toppedUpCents > 0) {
    note += ` ${dollars(charge.toppedUpCents)} was charged to your card to cover it.`;
  }
  return note;
}
