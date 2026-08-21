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

  // The payment sentence on the web confirmation. Since session 021 an ad is
  // collected for when it RUNS, so none of these may claim a charge has
  // happened — that is the promise the whole change exists to keep.
  t.eq(
    "covered by credit — says nothing is charged yet",
    chargeNoteLine({ costCents: 4500, leftCents: 10500, shortCents: 0, hasCard: false }),
    "It costs $45 and nothing is charged until your ad goes out — $105 of ad credit left after it does.",
  );
  t.eq(
    "cents render as cents",
    chargeNoteLine({ costCents: 4500, leftCents: 1050, shortCents: 0, hasCard: false }),
    "It costs $45 and nothing is charged until your ad goes out — $10.50 of ad credit left after it does.",
  );
  t.eq(
    "welcome credit is named",
    chargeNoteLine({
      costCents: 6000,
      leftCents: 9000,
      shortCents: 0,
      hasCard: false,
      welcomeLabel: "$150",
    }),
    "It costs $60 of your $150 welcome credit and nothing is charged until your ad goes out — $90 of ad credit left after it does.",
  );
  // THE SENTENCE THE USER ASKED FOR, on the web lane.
  t.eq(
    "card on file — the card waits for the run",
    chargeNoteLine({ costCents: 4500, leftCents: 0, shortCents: 3300, hasCard: true }),
    "It costs $45 and your card won't be charged until your ad runs.",
  );
  t.eq(
    "short with no card — asks for money, still charges nothing",
    chargeNoteLine({ costCents: 4500, leftCents: 0, shortCents: 3300, hasCard: false }),
    "It costs $45 and you're $33 short, so add money before it can go out — nothing is charged until it does.",
  );
  // No note may ever say the money has already moved.
  for (const note of [
    chargeNoteLine({ costCents: 4500, leftCents: 10500, shortCents: 0, hasCard: false }),
    chargeNoteLine({ costCents: 4500, leftCents: 0, shortCents: 3300, hasCard: true }),
    chargeNoteLine({ costCents: 4500, leftCents: 0, shortCents: 3300, hasCard: false }),
  ]) {
    t.eq(`no note claims a past charge: ${note.slice(0, 24)}…`, /was charged/.test(note), false);
  }
}
