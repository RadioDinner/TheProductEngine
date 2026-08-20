// Featured / premium-listing scheduling — the rolling-30-day fair queue
// (session 019).
//
// The user described the behaviour with a worked example and asked for the
// request page to both EXPLAIN the logic and HONOR it. Their example is pinned
// here verbatim, because it is the specification.
import {
  FEATURED_CAPACITY,
  FEATURED_RUN_DAYS,
  addDays,
  featuredSchedule,
  formatRunDay,
  queueSentence,
  runEndDay,
  runsOn,
} from "../lib/featured-schedule.ts";

export const name = "featured-schedule";

export function run(t) {
  // ---- the shape the user set ----
  t.eq("four spots — two on each side", FEATURED_CAPACITY, 4);
  t.eq("each runs 30 days", FEATURED_RUN_DAYS, 30);

  // ---- THE USER'S WORKED EXAMPLE ----
  // "if a premium business listing or featured ad is approved on 8-17-26,
  //  it'll expire in 30 days"
  t.eq("approved 8-17 expires 9-16", runEndDay("2026-08-17"), "2026-09-16");
  // "Lets say the fourth one arrives and is approved on 8-30-26. The fifth
  //  person … will have the first available slot at 9-16-26."
  const four = ["2026-08-17", "2026-08-20", "2026-08-24", "2026-08-30"];
  const fifth = featuredSchedule({ approvedStarts: four, today: "2026-08-31" });
  t.eq("all four spots are taken", fifth.runningCount, 4);
  t.eq("none are open now", fifth.openNow, 0);
  t.eq("THE FIFTH STARTS 9-16, exactly as the user said", fifth.nextStartDay, "2026-09-16");
  t.eq("and runs its own 30 days", fifth.nextEndDay, "2026-10-16");
  t.eq("it does not start today", fifth.startsImmediately, false);

  // The sixth waits for the SECOND run to end, not the first again.
  const sixth = featuredSchedule({ approvedStarts: four, today: "2026-08-31", queueAhead: 1 });
  t.eq("the sixth starts when the 8-20 run ends", sixth.nextStartDay, "2026-09-19");
  const seventh = featuredSchedule({ approvedStarts: four, today: "2026-08-31", queueAhead: 2 });
  t.eq("the seventh follows the 8-24 run", seventh.nextStartDay, "2026-09-23");
  const eighth = featuredSchedule({ approvedStarts: four, today: "2026-08-31", queueAhead: 3 });
  t.eq("the eighth follows the 8-30 run", eighth.nextStartDay, "2026-09-29");
  // The NINTH is the interesting one: every original run has ended, so it
  // waits on the fifth applicant's run, which started 9-16.
  const ninth = featuredSchedule({ approvedStarts: four, today: "2026-08-31", queueAhead: 4 });
  t.eq("the ninth waits on the FIFTH's run, not the originals", ninth.nextStartDay, "2026-10-16");

  // ---- room to spare ----
  const three = featuredSchedule({
    approvedStarts: ["2026-08-17", "2026-08-20", "2026-08-24"],
    today: "2026-08-31",
  });
  t.eq("three running leaves one open", three.openNow, 1);
  t.eq("the user's '3 confirmed, 2 apply' case starts today", three.nextStartDay, "2026-08-31");
  t.eq("…and starts immediately", three.startsImmediately, true);
  // "if both are valid/approvable, the first one submitted will get the 4th
  //  spot" — and the SECOND of the two waits for the earliest run to end.
  const secondApplicant = featuredSchedule({
    approvedStarts: ["2026-08-17", "2026-08-20", "2026-08-24"],
    today: "2026-08-31",
    queueAhead: 1,
  });
  t.eq("the second applicant waits for 8-17 to end", secondApplicant.nextStartDay, "2026-09-16");

  const empty = featuredSchedule({ approvedStarts: [], today: "2026-08-31" });
  t.eq("an empty board has every spot open", empty.openNow, 4);
  t.eq("an empty board starts today", empty.nextStartDay, "2026-08-31");
  t.eq("even the fourth applicant starts today",
    featuredSchedule({ approvedStarts: [], today: "2026-08-31", queueAhead: 3 }).nextStartDay,
    "2026-08-31");
  t.eq("but the FIFTH waits a full run",
    featuredSchedule({ approvedStarts: [], today: "2026-08-31", queueAhead: 4 }).nextStartDay,
    "2026-09-30");

  // ---- runs that already ended free their slot ----
  const stale = featuredSchedule({
    approvedStarts: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"],
    today: "2026-08-31",
  });
  t.eq("finished runs hold nothing", stale.runningCount, 0);
  t.eq("so the board is wide open", stale.nextStartDay, "2026-08-31");
  // The hand-over day itself: a run started 8-17 is OVER on 9-16, so the slot
  // is free that day rather than the day after.
  const handover = featuredSchedule({ approvedStarts: ["2026-08-17"], today: "2026-09-16" });
  t.eq("a slot frees ON the end day", handover.runningCount, 0);
  t.eq("a run covers its start day", runsOn("2026-08-17", "2026-08-17"), true);
  t.eq("a run covers the day before it ends", runsOn("2026-09-15", "2026-08-17"), true);
  t.eq("a run does NOT cover its end day", runsOn("2026-09-16", "2026-08-17"), false);
  t.eq("a run does not cover the day before it starts", runsOn("2026-08-16", "2026-08-17"), false);

  // ---- dates don't slide ----
  t.eq("a month rolls over", addDays("2026-08-31", 1), "2026-09-01");
  t.eq("a year rolls over", addDays("2026-12-31", 1), "2027-01-01");
  t.eq("a leap day is handled", addDays("2028-02-28", 1), "2028-02-29");
  t.eq("30 days across a month boundary", runEndDay("2026-01-31"), "2026-03-02");

  // ---- odd data can't promise a date we can't keep ----
  const overbooked = featuredSchedule({
    approvedStarts: ["2026-08-17", "2026-08-20", "2026-08-24", "2026-08-30", "2026-08-31"],
    today: "2026-08-31",
  });
  t.eq("over-booking is reported honestly", overbooked.runningCount, 5);
  // Five running against four slots: nothing frees until the SECOND end.
  t.eq("over-booking promises the later date", overbooked.nextStartDay, "2026-09-19");
  t.eq("a negative queue position is treated as none",
    featuredSchedule({ approvedStarts: [], today: "2026-08-31", queueAhead: -3 }).nextStartDay,
    "2026-08-31");
  t.eq("capacity is always at least one",
    featuredSchedule({ approvedStarts: [], today: "2026-08-31", capacity: 0 }).slotFreeDays.length, 1);

  // ---- the words the page shows must match the arithmetic ----
  t.eq("the date reads plainly", formatRunDay("2026-09-16"), "September 16, 2026");
  const waitingWords = queueSentence(fifth, 0);
  t.eq("a full board names the earliest start", waitingWords.includes("September 16, 2026"), true);
  t.eq("a full board says it is full", waitingWords.includes("All 4 spots are taken"), true);
  t.eq("nobody ahead is said plainly", waitingWords.includes("No one is waiting ahead of you"), true);
  t.eq("one ahead is singular", queueSentence(fifth, 1).includes("One request is waiting"), true);
  t.eq("several ahead are counted", queueSentence(fifth, 3).includes("3 requests are waiting"), true);
  const openWords = queueSentence(three, 0);
  t.eq("an open board says so", openWords.includes("1 spot is open right now"), true);
  t.eq("an open board promises the same day", openWords.includes("starts showing the same day"), true);
  t.eq("an open board still names the end", openWords.includes("September 30, 2026"), true);
}
