/**
 * Town hall events board (FEATURES item 18, v1) — the pure rules, kept
 * dependency-free (like lib/post-ad.ts and lib/myads.ts) so the unit suite
 * can pin them: field caps, event-date validation, and the upcoming-events
 * filter/sort (nearest date first; past events auto-drop).
 *
 * V1 is the free board only: submit → admin review → display until the date
 * passes. The paid SMS/email event blast is PHASE 2 (pricing unconfirmed) —
 * nothing here touches payments. The I/O lives in lib/town-hall-store.ts and
 * lib/town-hall-actions.ts.
 */

// Modest caps (user asked for a simple board, not a CMS). The title and body
// are required; time and place are optional free text.
export const EVENT_TITLE_MAX = 80;
export const EVENT_TIME_MAX = 40;
export const EVENT_PLACE_MAX = 120;
export const EVENT_BODY_MAX = 500;

/** How far out an event may be dated — guards fat-fingered years ("2062"). */
export const EVENT_MAX_DAYS_AHEAD = 366;

/** One event as the public board shows it. */
export interface TownEventView {
  id: number;
  title: string;
  /** ET calendar day, YYYY-MM-DD — compared as a string against "today". */
  eventDate: string;
  timeText: string | null;
  placeText: string | null;
  body: string;
}

/** Is `day` a real calendar date in strict YYYY-MM-DD form? */
export function isValidEventDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Whole days from `fromDay` to `toDay` (both valid YYYY-MM-DD); + = future. */
export function daysBetween(fromDay: string, toDay: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toDay) - utc(fromDay)) / 86_400_000);
}

export type EventDateVerdict = "ok" | "invalid" | "past" | "toofar";

/** May an event be submitted for `day`, seen from ET-today? Today itself is
 * fine (a supper tonight is exactly what the board is for). */
export function eventDateVerdict(day: string, todayDay: string): EventDateVerdict {
  if (!isValidEventDay(day)) return "invalid";
  if (day < todayDay) return "past"; // ISO days compare correctly as strings
  if (daysBetween(todayDay, day) > EVENT_MAX_DAYS_AHEAD) return "toofar";
  return "ok";
}

/**
 * The display rule for every surface (homepage sidebar + /town-hall):
 * only today-or-later events, nearest date first, submission order breaking
 * ties. Past events auto-drop — no cron, no status flip, just this filter.
 */
export function upcomingEvents<T extends { eventDate: string; id: number }>(
  events: T[],
  todayDay: string,
): T[] {
  return events
    .filter((e) => e.eventDate >= todayDay)
    .sort((a, b) =>
      a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : a.id - b.id,
    );
}

/** "Sat, Aug 2" for a YYYY-MM-DD day — rendered in UTC on purpose: the day is
 * already an ET calendar day, so any timezone math here would shift it. */
export function formatEventDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
