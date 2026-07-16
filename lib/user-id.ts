/**
 * USER_ID (FEATURES.md item 0, session 008): every member gets a public id
 * beyond their phone/email — 6 random digits, leading zeros allowed, never
 * duplicated. When an account merge retires an id, it must not be reused for
 * a whole year. Uniqueness is enforced by the stores (unique index + retry in
 * Supabase, in-memory scan in the file store); this module is the pure logic
 * so the unit suite can pin it.
 */

/** How long a retired (merged-away) id stays un-reusable: one year. */
export const USER_ID_RETIREMENT_MS = 365 * 24 * 60 * 60 * 1000;

/** How many draws a store makes before giving up (collisions are ~one in a
 * million per draw at this list's size — 25 misses means something is wrong). */
export const USER_ID_MAX_ATTEMPTS = 25;

/** One candidate id: 6 random digits, "000000"–"999999". */
export function randomUserId(rng: () => number = Math.random): string {
  return String(Math.floor(rng() * 1_000_000)).padStart(6, "0");
}

export function isValidUserId(id: string): boolean {
  return /^[0-9]{6}$/.test(id);
}

/** True while a tombstoned id is still inside its do-not-reuse year. */
export function isRetirementActive(retiredAtIso: string, nowMs: number): boolean {
  const retiredAt = Date.parse(retiredAtIso);
  return Number.isFinite(retiredAt) && retiredAt > nowMs - USER_ID_RETIREMENT_MS;
}
