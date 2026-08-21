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
  /** Ad credit left once this ad has run and been collected for. */
  leftCents: number;
  /** Cents the member is short of the price (0 = their credit covers it). */
  shortCents: number;
  /** A card is on file, so the shortfall is charged when the ad runs. */
  hasCard: boolean;
  /** Set ("$150") when the one-time starter credit covers this post. */
  welcomeLabel?: string;
};

/** Format cents — duplicated from lib/config formatPrice so this module
 * stays import-free for the unit runner; test/post-ad cross-checks them. */
function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The payment sentence on the web confirmation — the same three cases the SMS
 * lane words from /admin/replies (ad.money.covered / .card / .owing), so web
 * and text posts say the same thing.
 *
 * ⚠️ It no longer describes a charge, because since session 021 there isn't
 * one yet: an ad is quoted a price at posting and collected for by the batch
 * that carries it out to subscribers. This is the WEB half of the user's
 * "the card won't be charged until the ad is run", and a note here still
 * saying "$20 — $130 of ad credit left" would be the one screen that
 * contradicted it.
 */
export function chargeNoteLine(charge: ChargeOutcome): string {
  const price = charge.welcomeLabel
    ? `${dollars(charge.costCents)} of your ${charge.welcomeLabel} welcome credit`
    : dollars(charge.costCents);
  if (charge.shortCents > 0 && charge.hasCard) {
    return `It costs ${price} and your card won't be charged until your ad runs.`;
  }
  if (charge.shortCents > 0) {
    return `It costs ${price} and you're ${dollars(charge.shortCents)} short, so add money before it can go out — nothing is charged until it does.`;
  }
  return `It costs ${price} and nothing is charged until your ad goes out — ${dollars(charge.leftCents)} of ad credit left after it does.`;
}
