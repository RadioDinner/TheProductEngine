/**
 * America/New_York calendar helpers. Kept import-free so the digest-scheduling
 * logic that depends on them (which ET day/hour is it?) can be unit-tested in
 * isolation, including across DST transitions.
 */

/** ET calendar date (YYYY-MM-DD) and wall-clock hour (0–23) for a moment. */
export function etParts(date: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    // Intl can emit "24" for midnight in some engines — fold it to 0.
    hour: Number(get("hour")) % 24,
  };
}
