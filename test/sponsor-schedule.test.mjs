// Sponsor scheduling: only five businesses run in a week, longer buyers hold
// their later weeks, and whoever is early is scheduled first. This is the
// fairness promise the advertising page makes, so it is pinned hard.
import {
  addWeeks,
  bookedInWeek,
  dayWithinRun,
  earliestStartWeek,
  pickEmailSponsor,
  weekStart,
  weeksCovered,
} from "../lib/sponsor-schedule.ts";

export const name = "sponsor-schedule";

// 2026-08-17 is a Monday; 2026-08-19 a Wednesday; 2026-08-23 a Sunday.
const MON = "2026-08-17";
const NEXT = "2026-08-24";
const THIRD = "2026-08-31";

export function run(t) {
  /* ---- weeks are Monday-based ---- */
  t.eq("Monday is its own week", weekStart(MON), MON);
  t.eq("Wednesday -> that Monday", weekStart("2026-08-19"), MON);
  t.eq("Saturday -> that Monday", weekStart("2026-08-22"), MON);
  // Sunday closes the week it is in, it does not open the next one.
  t.eq("Sunday -> the Monday six days back", weekStart("2026-08-23"), MON);
  t.eq("the following Monday starts a new week", weekStart("2026-08-24"), NEXT);
  t.eq("addWeeks", addWeeks(MON, 2), THIRD);
  t.eq("weeksCovered spans consecutively", weeksCovered(MON, 3), [MON, NEXT, THIRD]);
  t.eq("zero weeks covers nothing", weeksCovered(MON, 0), []);

  /* ---- is a given day inside a run ---- */
  t.eq("first day of a 1-week run", dayWithinRun(MON, MON, 1), true);
  t.eq("Saturday of a 1-week run", dayWithinRun("2026-08-22", MON, 1), true);
  t.eq("the Monday after a 1-week run", dayWithinRun(NEXT, MON, 1), false);
  t.eq("second week of a 2-week run", dayWithinRun("2026-08-26", MON, 2), true);
  t.eq("a day before the run starts", dayWithinRun("2026-08-10", MON, 1), false);

  /* ---- capacity ---- */
  const four = Array.from({ length: 4 }, () => ({ startWeek: MON, weeks: 1 }));
  t.eq("four booked this week", bookedInWeek(four, MON), 4);
  t.eq("none booked next week", bookedInWeek(four, NEXT), 0);
  t.eq("a 2-week booking counts in both", bookedInWeek([{ startWeek: MON, weeks: 2 }], NEXT), 1);

  /* ---- the user's worked example ----
   * "If 4 sponsors pay for a week, and the 5th sponsor pays for 2, he
   * automatically gets the first slot on the second week, then if in the
   * second week 5 sponsors sign up, only the first 4 get to be on that week,
   * otherwise they wait." */
  const fifth = earliestStartWeek({ reservations: four, weeks: 2, fromWeek: MON, capacity: 5 });
  t.eq("the 5th sponsor takes this week's last slot", fifth, MON);
  const afterFifth = [...four, { startWeek: MON, weeks: 2 }];
  t.eq("...and holds one NEXT week too", bookedInWeek(afterFifth, NEXT), 1);
  // So next week has 4 slots left: the next four buyers get in...
  const nextFour = [];
  let booked = [...afterFifth];
  for (let i = 0; i < 4; i++) {
    const start = earliestStartWeek({ reservations: booked, weeks: 1, fromWeek: NEXT, capacity: 5 });
    nextFour.push(start);
    booked = [...booked, { startWeek: start, weeks: 1 }];
  }
  t.eq("the next four all get next week", nextFour, [NEXT, NEXT, NEXT, NEXT]);
  // ...and the fifth of them waits a week, exactly as described.
  t.eq(
    "the one after waits for the following week",
    earliestStartWeek({ reservations: booked, weeks: 1, fromWeek: NEXT, capacity: 5 }),
    THIRD,
  );

  /* ---- a long run needs room in EVERY week ---- */
  const fullNext = Array.from({ length: 5 }, () => ({ startWeek: NEXT, weeks: 1 }));
  t.eq(
    "a 2-week buyer skips a week that is full mid-run",
    earliestStartWeek({ reservations: fullNext, weeks: 2, fromWeek: MON, capacity: 5 }),
    THIRD,
  );
  t.eq(
    "a 1-week buyer still fits in the gap the long one couldn't use",
    earliestStartWeek({ reservations: fullNext, weeks: 1, fromWeek: MON, capacity: 5 }),
    MON,
  );
  t.eq(
    "no room in the horizon -> null, never a silent booking",
    earliestStartWeek({ reservations: four, weeks: 1, fromWeek: MON, capacity: 0 }),
    null,
  );

  /* ---- email banner rotation: one sponsor per edition, fewest rides first ---- */
  const cands = [
    { id: 3, emailRides: 2 },
    { id: 1, emailRides: 1 },
    { id: 2, emailRides: 1 },
  ];
  t.eq("fewest rides wins, ties by id", pickEmailSponsor(cands, "k1")?.id, 1);
  t.eq("nobody active -> nobody rides", pickEmailSponsor([], "k1"), null);
  // Re-composing an edition must not move the banner to a different sponsor.
  const withPrior = [{ id: 5, emailRides: 9, lastEmailKey: "k1" }, { id: 6, emailRides: 0 }];
  t.eq("a recomposed edition keeps its sponsor", pickEmailSponsor(withPrior, "k1")?.id, 5);
  t.eq("a NEW edition goes to the least-served", pickEmailSponsor(withPrior, "k2")?.id, 6);
}
