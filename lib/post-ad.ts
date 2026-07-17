/**
 * Web ad posting (FEATURES item 9) — the pure pricing-preview half, so the
 * unit suite can pin it. Deliberately dependency-free (like lib/ad-display.ts
 * and lib/pic-quota.ts): the server action and page do the I/O and pass the
 * live numbers in.
 *
 * The web lane charges EXACTLY like texting AD NEW in: a free ad pass covers
 * either kind of ad; otherwise credits at the live text/picture price. The
 * one-time starter grant (first real post) is previewed here so the form can
 * say "your first ad is free" BEFORE the member commits.
 */

export interface PostingFunds {
  /** Free-ad passes held right now (before any starter grant). */
  freeAds: number;
  /** Whether the one-time starter grant already fired for this member. */
  starterGranted: boolean;
  /** Current credit balance. */
  balance: number;
}

export interface PostingPreview {
  /** Passes the member will hold at posting time (starter grant included). */
  freeAdsAtPost: number;
  /** True when a free pass (either ad kind) will cover this post. */
  usesFreePass: boolean;
  /** True when it's the first-post starter grant that supplies the pass. */
  starterGrantApplies: boolean;
  canAffordText: boolean;
  canAffordPicture: boolean;
}

/** What posting will use, given the member's funds and the live prices. */
export function postingPreview(
  funds: PostingFunds,
  costText: number,
  costPhoto: number,
  starterFreeAds: number,
): PostingPreview {
  const granted = funds.starterGranted ? 0 : Math.max(0, starterFreeAds);
  const freeAdsAtPost = Math.max(0, funds.freeAds) + granted;
  const usesFreePass = freeAdsAtPost > 0;
  return {
    freeAdsAtPost,
    usesFreePass,
    starterGrantApplies: !funds.starterGranted && granted > 0,
    canAffordText: usesFreePass || funds.balance >= costText,
    canAffordPicture: usesFreePass || funds.balance >= costPhoto,
  };
}

export type ChargeOutcome =
  | { kind: "free"; left: number }
  | { kind: "credits"; cost: number; left: number };

/**
 * The parenthesized charge note on the confirmation — EXACTLY the SMS lane's
 * wording (lib/engine.ts handleAdSubmission), so web and text posts read the
 * same everywhere.
 */
export function chargeNoteLine(charge: ChargeOutcome): string {
  if (charge.kind === "free") return `Used 1 free ad — ${charge.left} left.`;
  return `${charge.cost} credit${charge.cost === 1 ? "" : "s"} — ${charge.left} left.`;
}
