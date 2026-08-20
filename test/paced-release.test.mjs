// Paced release. The stamping itself is one atomic SQL statement; these are
// the decisions around it, and every setting here arrives from an admin form
// where it can be typed wrong. The dangerous typo is a max below the min —
// read naively that is a NEGATIVE gap, which schedules ads into the past and
// dumps the whole backlog at once, the exact thing the feature prevents.
import {
  describeSpread,
  estimatedSpreadMinutes,
  safeGapRange,
  shouldPace,
} from "../lib/paced-release.ts";

export const name = "paced-release";

const S = (over, min = 12, max = 18) => ({
  pacedReleaseOver: over,
  pacedGapMinMinutes: min,
  pacedGapMaxMinutes: max,
});

export function run(t) {
  // ---- the threshold ----
  // Strictly greater-than: "spread when more than 4 wait" must mean five, or
  // the setting reads as a lie to whoever typed it.
  t.eq("four waiting does NOT pace", shouldPace(4, S(4)), false);
  t.eq("five waiting paces", shouldPace(5, S(4)), true);
  t.eq("nothing waiting does not pace", shouldPace(0, S(4)), false);
  t.eq("one waiting does not pace", shouldPace(1, S(4)), false);
  // 0 turns it off — a backlog of a thousand still goes at once, which is the
  // pre-feature behaviour and has to stay reachable.
  t.eq("threshold 0 turns pacing off", shouldPace(1000, S(0)), false);
  t.eq("a negative threshold also turns it off", shouldPace(1000, S(-3)), false);
  // A threshold of 1 paces everything past a single ad.
  t.eq("threshold 1 paces two", shouldPace(2, S(1)), true);

  // ---- the gap range ----
  t.eq("a sane range passes through", JSON.stringify(safeGapRange(S(4, 12, 18))), '{"min":12,"max":18}');
  // THE typo that matters: 18 then 12. The admin meant a 12-18 spread; a
  // negative gap would release the backlog instantly.
  const flipped = safeGapRange(S(4, 18, 12));
  t.eq("a reversed range never yields a negative gap", flipped.max >= flipped.min, true);
  t.eq("…and keeps the larger as the floor", flipped.min, 18);
  // Negatives are clamped rather than trusted.
  t.eq("a negative min clamps to zero", safeGapRange(S(4, -5, 10)).min, 0);
  t.eq("both negative clamps to zero", JSON.stringify(safeGapRange(S(4, -5, -9))), '{"min":0,"max":0}');
  // Blank fields arrive as 0/NaN-ish; they must not produce NaN gaps.
  t.eq("missing values become zero", JSON.stringify(safeGapRange(S(4, 0, 0))), '{"min":0,"max":0}');
  t.eq("equal min and max is legal (a fixed gap)", JSON.stringify(safeGapRange(S(4, 15, 15))), '{"min":15,"max":15}');

  // ---- how long a backlog takes ----
  // The first ad goes immediately, so N ads span N-1 gaps.
  t.eq("one ad spans nothing", estimatedSpreadMinutes(1, S(4)), 0);
  t.eq("zero ads span nothing", estimatedSpreadMinutes(0, S(4)), 0);
  t.eq("two ads span one average gap", estimatedSpreadMinutes(2, S(4, 12, 18)), 15);
  t.eq("five ads span four gaps", estimatedSpreadMinutes(5, S(4, 12, 18)), 60);
  // The number that should give an operator pause: a big backlog does not
  // clear inside one day's send window.
  t.eq("twenty ads is over five hours", estimatedSpreadMinutes(20, S(4, 12, 18)) > 280, true);
  t.eq("a reversed range still estimates sanely", estimatedSpreadMinutes(5, S(4, 18, 12)), 72);

  // ---- describing it ----
  t.eq("nothing to spread reads plainly", describeSpread(0), "straight away");
  t.eq("short spreads read in minutes", describeSpread(45), "about 45 minutes");
  t.eq("89 minutes is still minutes", describeSpread(89), "about 89 minutes");
  t.eq("90 minutes becomes hours", describeSpread(90), "about 1.5 hours");
  t.eq("two hours reads plurally", describeSpread(120), "about 2 hours");
  t.eq("one hour would read singularly", describeSpread(60 * 1).length > 0, true);
  t.eq("five hours", describeSpread(300), "about 5 hours");
  // Long spreads round to whole hours rather than pretending to precision.
  t.eq("a very long spread rounds", describeSpread(60 * 12 + 7), "about 12 hours");
}
