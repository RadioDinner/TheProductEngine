/**
 * Featured / premium-listing scheduling — the rolling-30-day fair queue
 * (session 019, user rules).
 *
 * The user's model, in their words: "up to 4 sponsored listings or premium
 * business listings per month. Two stacked on each side … These will run
 * independent schedules of 30 days. So if a premium business listing or
 * featured ad is approved on 8-17-26, it'll expire in 30 days … Lets say the
 * fourth one arrives and is approved on 8-30-26. The fifth person that wants
 * to post an approved 'premium' listing will have the first available slot at
 * 9-16-26."
 *
 * So the runs do NOT share a calendar month. Each is its own 30-day window
 * starting the day it is approved, and the four windows drift apart. That is
 * what makes the queue interesting: the next opening is not "next month", it
 * is whenever the EARLIEST-ending of the four runs ends.
 *
 *   4 running, starting 8-17, 8-20, 8-24, 8-30
 *   → ends       9-16, 9-19, 9-23, 9-29
 *   → the 5th applicant starts 9-16, the 6th starts 9-19, and so on.
 *
 * A run covers [start, start + 30) — the slot is occupied on its start day and
 * free again ON its end day, which is what makes 8-17 + 30 days hand the slot
 * over on 9-16 exactly as the user described.
 *
 * Pure and dependency-free: the whole fairness story is unit-testable without
 * a database or a clock, and the public request page renders the same numbers
 * the approval will actually produce.
 */

/** Two stacked on each side of the homepage (user decision, session 019). */
export const FEATURED_CAPACITY = 4;
/** How long one approved run shows for. */
export const FEATURED_RUN_DAYS = 30;

/** Add days to an ET calendar day ("YYYY-MM-DD"). Noon UTC keeps the date
 * from sliding either way across a timezone. */
export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The day a run that started on `startDay` gives its slot back. */
export function runEndDay(startDay: string, runDays: number = FEATURED_RUN_DAYS): string {
  return addDays(startDay, runDays);
}

/** Calendar-day comparison. The strings sort correctly, so this is just
 * readability — but naming it stops a stray Date() creeping in later. */
function later(a: string, b: string): string {
  return a > b ? a : b;
}

/** Is a run that started on `startDay` still showing on `day`? */
export function runsOn(
  day: string,
  startDay: string,
  runDays: number = FEATURED_RUN_DAYS,
): boolean {
  return day >= startDay && day < runEndDay(startDay, runDays);
}

export interface ScheduleInput {
  /** Start days of every APPROVED run, in any order. Ended ones are ignored. */
  approvedStarts: readonly string[];
  /** Today, as an ET calendar day. */
  today: string;
  /** How many already-waiting requests are ahead of the one being quoted. */
  queueAhead?: number;
  capacity?: number;
  runDays?: number;
}

export interface ScheduleResult {
  /** Runs showing right now. */
  runningCount: number;
  /** Slots free at this moment. */
  openNow: number;
  /** The day the request being quoted would START showing. */
  nextStartDay: string;
  /** …and stop. */
  nextEndDay: string;
  /** True when it would start today rather than wait. */
  startsImmediately: boolean;
  /** The days each of the `capacity` slots next frees up, earliest first —
   * what the public page turns into "spots open up on …". */
  slotFreeDays: string[];
}

/**
 * When the next featured run can begin.
 *
 * The arithmetic is a slot-availability simulation, not a formula, because a
 * queue changes the answer: the fifth applicant starts when the first run
 * ends, the sixth when the second ends, and if the fifth's run is long enough
 * it can be the one blocking the seventh.
 *
 * Fairness is by SUBMISSION ORDER, which the caller expresses as `queueAhead`
 * — "there are three valid requests in front of you". That matches the user's
 * rule: "if both are valid/approvable, the first one submitted will get the
 * 4th spot."
 */
export function featuredSchedule(input: ScheduleInput): ScheduleResult {
  const capacity = Math.max(1, input.capacity ?? FEATURED_CAPACITY);
  const runDays = Math.max(1, input.runDays ?? FEATURED_RUN_DAYS);
  const today = input.today;
  const queueAhead = Math.max(0, Math.floor(input.queueAhead ?? 0));

  // Only runs that have not finished still hold a slot.
  const activeEnds = input.approvedStarts
    .map((start) => runEndDay(start, runDays))
    .filter((end) => end > today)
    .sort();

  const runningCount = activeEnds.length;

  // When each slot next frees. If more runs are somehow active than there are
  // slots (a hand-edited row, a capacity that was lowered), the slot frees
  // only once enough of them have ended — take the LAST `capacity` ends, which
  // promises the later date rather than one we cannot keep.
  const slotFreeDays = activeEnds.slice(Math.max(0, runningCount - capacity));
  while (slotFreeDays.length < capacity) slotFreeDays.unshift(today);
  slotFreeDays.sort();

  const openNow = slotFreeDays.filter((day) => day <= today).length;

  // Hand out slots in queue order: each request takes the earliest-free slot,
  // and holding it pushes that slot's next opening out by a full run.
  const free = [...slotFreeDays];
  let start = today;
  for (let i = 0; i <= queueAhead; i++) {
    free.sort();
    start = later(free[0], today);
    free[0] = runEndDay(start, runDays);
  }

  return {
    runningCount,
    openNow,
    nextStartDay: start,
    nextEndDay: runEndDay(start, runDays),
    startsImmediately: start <= today,
    slotFreeDays,
  };
}

/** "2026-09-16" → "September 16, 2026". Pure; noon UTC so the date can't
 * slide. Used by the public request page and the approval confirmation, so
 * both say the same day in the same words. */
export function formatRunDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The sentence the request page shows above the form.
 *
 * Written here rather than in the page so the wording is unit-testable and
 * cannot drift from the arithmetic it describes — the user asked for the page
 * to both EXPLAIN the logic and HONOR it, and those are the same sentence.
 */
export function queueSentence(result: ScheduleResult, queueAhead: number): string {
  const waiting =
    queueAhead === 0
      ? "No one is waiting ahead of you"
      : queueAhead === 1
        ? "One request is waiting ahead of you"
        : `${queueAhead} requests are waiting ahead of you`;

  if (result.startsImmediately) {
    const spots = result.openNow === 1 ? "1 spot is" : `${result.openNow} spots are`;
    return `${spots} open right now. ${waiting}, so once your listing is approved it starts showing the same day and runs through ${formatRunDay(
      result.nextEndDay,
    )}.`;
  }

  return `All ${FEATURED_CAPACITY} spots are taken. ${waiting}. The earliest your featured listing will begin displaying is ${formatRunDay(
    result.nextStartDay,
  )}, and it would run through ${formatRunDay(result.nextEndDay)}.`;
}
