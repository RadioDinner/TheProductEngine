// Money-amount parsing for the admin phone-order forms — a custom charge is
// real dollars leaving a member's card, so the parser must reject anything
// ambiguous and clamp the fat-finger range ($1–$5,000, the same ceiling as
// the admin balance adjustment).
import { customAmountCents, isTopUpPreset, TOP_UP_PRESETS_CENTS } from "../lib/config.ts";

export const name = "config";

export function run(t) {
  // Custom amounts: dollars in, cents out.
  t.eq("whole dollars", customAmountCents("45"), 4500);
  t.eq("decimals", customAmountCents("12.50"), 1250);
  t.eq("leading $", customAmountCents("$60"), 6000);
  t.eq("$ + decimals", customAmountCents("$99.99"), 9999);
  t.eq("whitespace tolerated", customAmountCents("  75  "), 7500);
  t.eq("floor: exactly $1", customAmountCents("1"), 100);
  t.eq("ceiling: exactly $5,000", customAmountCents("5000"), 500_000);
  t.eq("sub-cent input rounds", customAmountCents("10.999"), 1100);
  // Rejections — null means the form bounces with the range message.
  t.eq("under $1", customAmountCents("0.99"), null);
  t.eq("zero", customAmountCents("0"), null);
  t.eq("negative (a charge is never a refund)", customAmountCents("-45"), null);
  t.eq("over $5,000", customAmountCents("5000.01"), null);
  t.eq("empty", customAmountCents(""), null);
  t.eq("words", customAmountCents("forty five"), null);
  t.eq("thousands comma (ambiguous)", customAmountCents("1,000"), null);
  t.eq("two decimal points", customAmountCents("4.5.0"), null);

  // Presets stay presets — the member-facing lanes depend on this gate.
  for (const preset of TOP_UP_PRESETS_CENTS) {
    t.eq(`preset ${preset} accepted`, isTopUpPreset(preset), true);
  }
  t.eq("non-preset rejected by the preset gate", isTopUpPreset(4600), false);
}
