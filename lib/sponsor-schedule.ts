/**
 * Sponsor scheduling — the fair-queue arithmetic behind business packages
 * (session 016, user rules). Pure and dependency-free so the whole fairness
 * story is unit-testable without a database or a clock.
 *
 * The model:
 *   * Weeks run Monday–Sunday, named by their Monday in ET ("2026-08-17").
 *   * Only `capacity` sponsors (5) may RUN in any one week.
 *   * A package buying N weeks holds a slot in N CONSECUTIVE weeks — so the
 *     2-week buyer who takes this week's last slot already holds one next
 *     week, and a later 1-week buyer waits for the first week with room.
 *   * Whoever paid first is scheduled first: the queue is ordered by
 *     payment, never by who happens to be approved on a slow afternoon.
 */

/** The Monday of the week containing an ET day ("YYYY-MM-DD"), as its own
 * "YYYY-MM-DD". Noon UTC keeps the date from sliding across a timezone. */
export function weekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  // getUTCDay: 0=Sunday. Monday-start means Sunday belongs to the week that
  // began six days earlier, not the one starting tomorrow.
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

/** The Monday `n` weeks after this one. */
export function addWeeks(week: string, n: number): string {
  const date = new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n * 7);
  return date.toISOString().slice(0, 10);
}

/** Every week a package occupies, given where it starts and how many it bought. */
export function weeksCovered(startWeek: string, weeks: number): string[] {
  return Array.from({ length: Math.max(0, weeks) }, (_, i) => addWeeks(startWeek, i));
}

/** Is `day` inside the run this package reserved? */
export function dayWithinRun(day: string, startWeek: string, weeks: number): boolean {
  const week = weekStart(day);
  return week >= startWeek && week < addWeeks(startWeek, weeks);
}

export interface Reservation {
  startWeek: string;
  weeks: number;
}

/** How many sponsors are already reserved in a given week. */
export function bookedInWeek(reservations: Reservation[], week: string): number {
  return reservations.filter(
    (r) => week >= r.startWeek && week < addWeeks(r.startWeek, r.weeks),
  ).length;
}

/**
 * The earliest week a package of `weeks` length can start without ever
 * exceeding `capacity` — the answer to "when do I actually run?" that a
 * business is told at approval.
 *
 * A multi-week package needs room in EVERY week of its run, so it lands on
 * the first Monday where the whole block fits; a shorter package can slot
 * into a gap a longer one couldn't use. Searching a bounded horizon keeps a
 * nonsense configuration (capacity 0) from looping forever — null means
 * "no room in the next `horizonWeeks`", which the caller reports rather than
 * silently scheduling.
 */
export function earliestStartWeek(args: {
  reservations: Reservation[];
  weeks: number;
  fromWeek: string;
  capacity: number;
  horizonWeeks?: number;
}): string | null {
  const horizon = args.horizonWeeks ?? 52;
  if (args.weeks < 1 || args.capacity < 1) return null;
  for (let offset = 0; offset < horizon; offset++) {
    const start = addWeeks(args.fromWeek, offset);
    const fits = weeksCovered(start, args.weeks).every(
      (week) => bookedInWeek(args.reservations, week) < args.capacity,
    );
    if (fits) return start;
  }
  return null;
}

export interface EmailRotationCandidate {
  id: number;
  /** Editions this package's banner has already ridden. */
  emailRides: number;
  /** The last edition it rode — re-composing that edition must not pick a
   * different sponsor, or the same banner would be paid for twice. */
  lastEmailKey?: string | null;
}

/**
 * Which sponsor's banner rides one email edition. One per edition (the
 * user's rule), chosen as the fewest rides so far, ties broken by id — a
 * plain round robin that stays fair when packages start and end mid-week.
 *
 * Idempotent: if a candidate already rode THIS edition key, it keeps it, so
 * a re-composed edition never hands the slot to somebody else.
 */
export function pickEmailSponsor<T extends EmailRotationCandidate>(
  candidates: T[],
  editionKey: string,
): T | null {
  if (!candidates.length) return null;
  const already = candidates.find((c) => c.lastEmailKey === editionKey);
  if (already) return already;
  return candidates.reduce((best, c) =>
    c.emailRides < best.emailRides || (c.emailRides === best.emailRides && c.id < best.id)
      ? c
      : best,
  );
}
