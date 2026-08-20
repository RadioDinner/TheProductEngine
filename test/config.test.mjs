// Money-amount parsing for the admin phone-order forms — a custom charge is
// real dollars leaving a member's card, so the parser must reject anything
// ambiguous and clamp the fat-finger range ($1–$5,000, the same ceiling as
// the admin balance adjustment).
import { adPriceCents, customAmountCents, engineDefaults, isTopUpPreset, site, TOP_UP_PRESETS_CENTS } from "../lib/config.ts";

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

  /* ---- the price ladder (session 016 sheet v2) ---- */
  const sheet = { costTextCents: 2000, photoPricesCents: [3000, 4000, 5000] };
  t.eq("no pictures = the text price", adPriceCents(0, sheet), 2000);
  t.eq("1 picture", adPriceCents(1, sheet), 3000);
  t.eq("2 pictures", adPriceCents(2, sheet), 4000);
  t.eq("3 pictures", adPriceCents(3, sheet), 5000);
  // The combiner caps at three, so this is a belt-and-braces clamp — but a
  // seller must never be charged LESS for more pictures.
  t.eq("beyond the sheet charges the top rung", adPriceCents(9, sheet), 5000);
  t.eq("a negative count reads as text", adPriceCents(-1, sheet), 2000);
  t.eq("no ladder configured falls back to text", adPriceCents(2, { costTextCents: 2000, photoPricesCents: [] }), 2000);
  // Every rung must cost more than the one below it, or a seller could pay
  // less by sending an extra picture.
  const ladder = [engineDefaults.costTextCents, ...engineDefaults.photoPricesCents];
  t.eq("the shipped ladder only climbs", ladder.every((p, i) => i === 0 || p > ladder[i - 1]), true);
  t.eq("costPhotoCents mirrors the one-picture rung", engineDefaults.costPhotoCents, engineDefaults.photoPricesCents[0]);

  // ---- version stamp (feature 40) ----
  // One constant behind the footer and /api/health, so "what's deployed?"
  // can be answered from either end without them disagreeing.
  t.eq("version is three dot-separated numbers", /^\d+\.\d+\.\d+$/.test(site.version), true);
  // The bump rule (new_session_instructions.md §6) moves the first digit ONLY
  // when the user says so — this pins that it hasn't drifted on its own.
  t.eq("major version is still 1", site.version.split(".")[0], "1");
}
