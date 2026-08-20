/**
 * Paced release: the rules for trickling a backed-up queue out (user
 * decision, session 016).
 *
 * The stamping itself is one atomic SQL statement (migration 9963) — this
 * module holds the decisions around it, pure and unit-tested, because the
 * settings arrive from an admin form and every one of them can be typed
 * wrong: a max below the min, a negative gap, a threshold of zero meaning two
 * different things depending on who reads it.
 */

export interface PacingSettings {
  /** Pace only when MORE than this many ads are waiting. 0 = never pace. */
  pacedReleaseOver: number;
  pacedGapMinMinutes: number;
  pacedGapMaxMinutes: number;
}

/**
 * Should a backlog of `pending` ads be spread out?
 *
 * Strictly greater-than: at exactly the threshold the queue still goes at
 * once. "Pace when more than 4 are waiting" has to mean five, or the setting
 * reads as a lie to whoever set it.
 */
export function shouldPace(pending: number, settings: PacingSettings): boolean {
  if (settings.pacedReleaseOver <= 0) return false;
  return pending > settings.pacedReleaseOver;
}

/**
 * Make the min/max gap safe to hand to SQL.
 *
 * Both are clamped non-negative, and a max below the min is raised to meet it
 * rather than rejected — an admin who types 18 and 12 the wrong way round
 * meant a 12-18 spread, and silently pacing at a NEGATIVE gap (which would
 * schedule ads into the past and release the whole backlog at once, the exact
 * thing this feature prevents) is the worst possible reading of that typo.
 */
export function safeGapRange(settings: PacingSettings): { min: number; max: number } {
  const min = Math.max(0, settings.pacedGapMinMinutes || 0);
  const max = Math.max(min, settings.pacedGapMaxMinutes || 0);
  return { min, max };
}

/**
 * How long the tail of a paced backlog takes, in minutes, at the average gap.
 * Used to tell the operator what they are about to set in motion — "23 ads
 * waiting, about 5 hours to clear" is the number that decides whether the
 * pacing is right or whether they should be dealing with the backlog
 * differently.
 */
export function estimatedSpreadMinutes(
  pending: number,
  settings: PacingSettings,
): number {
  if (pending <= 1) return 0;
  const { min, max } = safeGapRange(settings);
  return Math.round((pending - 1) * ((min + max) / 2));
}

/** "about 4 hours" / "about 35 minutes" — for admin copy. */
export function describeSpread(minutes: number): string {
  if (minutes <= 0) return "straight away";
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = minutes / 60;
  const rounded = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
  return `about ${rounded} hour${rounded === 1 ? "" : "s"}`;
}
