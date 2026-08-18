// Web ad posting (FEATURES item 9) — the pricing preview shown BEFORE posting
// and the confirmation charge note, in DOLLARS (session-016 pricing: all
// values are cents). The note strings must match the SMS lane (lib/engine.ts)
// byte for byte: refunds and admin views key off them.
import { chargeNoteLine, postingPreview } from "../lib/post-ad.ts";

export const name = "post-ad";

const PRICES = [4500, 6000, 15000]; // text, picture, starter credit

export function run(t) {
  // Brand-new member: the first post mints the $150 starter credit, so the
  // preview must say the money covers it even with a zero balance.
  t.eq(
    "first post — starter credit covers it",
    postingPreview({ starterGranted: false, balanceCents: 0, autoTopUp: false }, ...PRICES),
    {
      balanceAtPostCents: 15000,
      starterGrantApplies: true,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // Starter already granted: only the real balance counts.
  t.eq(
    "granted — balance covers both",
    postingPreview({ starterGranted: true, balanceCents: 6000, autoTopUp: false }, ...PRICES),
    {
      balanceAtPostCents: 6000,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // $45.01 short of the picture price: text yes, picture no.
  t.eq(
    "text only affordable",
    postingPreview({ starterGranted: true, balanceCents: 5999, autoTopUp: false }, ...PRICES),
    {
      balanceAtPostCents: 5999,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: false,
    },
  );

  // Broke: neither.
  t.eq(
    "broke — neither affordable",
    postingPreview({ starterGranted: true, balanceCents: 0, autoTopUp: false }, ...PRICES),
    {
      balanceAtPostCents: 0,
      starterGrantApplies: false,
      canAffordText: false,
      canAffordPicture: false,
    },
  );

  // Automatic top-up: a saved card with the toggle on affords everything —
  // the shortfall goes on the card at posting time.
  t.eq(
    "auto top-up affords everything",
    postingPreview({ starterGranted: true, balanceCents: 0, autoTopUp: true }, ...PRICES),
    {
      balanceAtPostCents: 0,
      starterGrantApplies: false,
      canAffordText: true,
      canAffordPicture: true,
    },
  );

  // Defensive: negative/garbage inputs never mint phantom money.
  t.eq(
    "negative balance clamps to zero",
    postingPreview({ starterGranted: true, balanceCents: -200, autoTopUp: false }, ...PRICES)
      .balanceAtPostCents,
    0,
  );
  t.eq(
    "starter credit of zero never applies",
    postingPreview({ starterGranted: false, balanceCents: 0, autoTopUp: false }, 4500, 6000, 0)
      .starterGrantApplies,
    false,
  );

  // Charge notes — EXACT SMS-lane wording (lib/engine.ts handleAdSubmission).
  t.eq(
    "dollar note",
    chargeNoteLine({ costCents: 4500, leftCents: 10500, toppedUpCents: 0 }),
    "$45 — $105 of ad credit left.",
  );
  t.eq(
    "dollar note with cents",
    chargeNoteLine({ costCents: 4500, leftCents: 1050, toppedUpCents: 0 }),
    "$45 — $10.50 of ad credit left.",
  );
  t.eq(
    "welcome-credit note",
    chargeNoteLine({ costCents: 6000, leftCents: 9000, toppedUpCents: 0, welcomeLabel: "$150" }),
    "$60 of your $150 welcome credit — $90 left.",
  );
  t.eq(
    "top-up note",
    chargeNoteLine({ costCents: 4500, leftCents: 0, toppedUpCents: 3300 }),
    "$45 — $0 of ad credit left. $33 was charged to your card to cover it.",
  );
}
