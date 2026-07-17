// Web ad posting (FEATURES item 9) — the pricing preview shown BEFORE posting
// and the confirmation charge note. The note strings must match the SMS lane
// (lib/engine.ts) byte for byte: refunds and admin views key off them.
import { chargeNoteLine, postingPreview } from "../lib/post-ad.ts";

export const name = "post-ad";

export function run(t) {
  // Brand-new member: the first post mints the starter passes, so the preview
  // must say a pass covers it even with a zero balance.
  t.eq(
    "first post — starter grant covers it",
    postingPreview({ freeAds: 0, starterGranted: false, balance: 0 }, 1, 5, 3),
    {
      freeAdsAtPost: 3,
      usesFreePass: true,
      starterGrantApplies: true,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // Starter already granted, passes remain: a pass covers it, no starter note.
  t.eq(
    "passes left — free pass, no starter note",
    postingPreview({ freeAds: 2, starterGranted: true, balance: 0 }, 1, 5, 3),
    {
      freeAdsAtPost: 2,
      usesFreePass: true,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // Passes spent: credits are the lane; balance 5 covers both kinds at 1/5.
  t.eq(
    "no passes, balance covers both",
    postingPreview({ freeAds: 0, starterGranted: true, balance: 5 }, 1, 5, 3),
    {
      freeAdsAtPost: 0,
      usesFreePass: false,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // Balance 4: text yes, picture no.
  t.eq(
    "no passes, text only affordable",
    postingPreview({ freeAds: 0, starterGranted: true, balance: 4 }, 1, 5, 3),
    {
      freeAdsAtPost: 0,
      usesFreePass: false,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: false,
    },
  );

  // Broke: neither.
  t.eq(
    "no passes, no credits",
    postingPreview({ freeAds: 0, starterGranted: true, balance: 0 }, 1, 5, 3),
    {
      freeAdsAtPost: 0,
      usesFreePass: false,
      starterGrantApplies: false,
      canAffordText: false,
      canAffordPicture: false,
    },
  );

  // Defensive: negative/garbage inputs never produce a phantom pass.
  t.eq(
    "negative freeAds clamps to zero",
    postingPreview({ freeAds: -2, starterGranted: true, balance: 1 }, 1, 5, 3).freeAdsAtPost,
    0,
  );
  t.eq(
    "starter grant of zero never applies",
    postingPreview({ freeAds: 0, starterGranted: false, balance: 0 }, 1, 5, 0)
      .starterGrantApplies,
    false,
  );

  // Charge notes — EXACT SMS-lane wording (lib/engine.ts:213,215).
  t.eq("free-pass note", chargeNoteLine({ kind: "free", left: 2 }), "Used 1 free ad — 2 left.");
  t.eq("free-pass note, none left", chargeNoteLine({ kind: "free", left: 0 }), "Used 1 free ad — 0 left.");
  t.eq(
    "credits note, singular",
    chargeNoteLine({ kind: "credits", cost: 1, left: 0 }),
    "1 credit — 0 left.",
  );
  t.eq(
    "credits note, plural",
    chargeNoteLine({ kind: "credits", cost: 5, left: 3 }),
    "5 credits — 3 left.",
  );
}
