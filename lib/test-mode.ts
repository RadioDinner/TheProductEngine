/**
 * TEST MODE (session 021, user request) — send real ads to a couple of test
 * phones without touching the subscriber list.
 *
 * The rule the whole design rests on: **test mode narrows the AUDIENCE and
 * changes nothing else.** An ad posted while it is on is a real ad — real ad
 * number, real price, real batching, real category partitioning, real picture
 * badging, real segment accounting. Only the recipient list is cut down to the
 * test numbers. That is what makes a test worth running: a fake pipeline
 * proves nothing about the real one.
 *
 * Two consequences worth stating out loud, because they are what make this
 * safe to leave in the codebase:
 *
 *  1. **It is enforced in the STORE layer** (lib/store.ts), inside the two
 *     functions that answer "who receives this" — not at the four call sites
 *     that ask. A guarantee that depends on every future caller remembering to
 *     check a flag is not a guarantee; this is the same lesson that took the
 *     ring-first switch out of the voice line earlier this session.
 *  2. **It EXPIRES.** Test mode left on is worse than an outage: every ad goes
 *     to two phones, the admin screens look completely healthy, and the real
 *     subscriber list silently receives nothing. There is no state in this app
 *     where "quietly stopped serving everyone" should be able to persist
 *     because somebody forgot a checkbox, so the switch turns itself off.
 *
 * Dependency-free on purpose (like lib/categories.ts) so every decision here
 * is unit-testable without a database — see test/test-mode.test.mjs.
 */

/** How long test mode may stay on before it expires itself, in hours. */
export const TEST_MODE_MAX_HOURS = 4;

/** How many test numbers may be configured. A cap, not a target: this is a
 * bench, and a "test" list long enough to be a mailing list is a mistake
 * waiting to be made. */
export const TEST_NUMBERS_MAX = 5;

export interface TestModeConfig {
  /** The operator's switch. */
  testMode: boolean;
  /** Comma-separated 10-digit numbers. */
  testNumbers: string;
  /** ISO timestamp the switch expires at; "" = no deadline recorded. */
  testModeExpiresAt: string;
}

/**
 * The configured test numbers, normalized to bare 10-digit strings.
 *
 * Deliberately strict — anything that is not a plain US 10-digit number after
 * stripping punctuation is DROPPED rather than guessed at. A typo'd test
 * number must fail loudly by not receiving anything, never quietly become a
 * real member's phone that then gets the operator's test ads.
 */
export function parseTestNumbers(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const digits = entry.replace(/\D/g, "");
    // Accept a leading US country code, then require exactly ten digits.
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10) continue;
    // A US number never starts with 0 or 1 in the area code or exchange.
    if (/^[01]/.test(ten) || /^\d{3}[01]/.test(ten)) continue;
    seen.add(ten);
    if (seen.size >= TEST_NUMBERS_MAX) break;
  }
  return [...seen];
}

/** When a switch flipped at `now` should expire. */
export function testModeExpiry(nowMs: number, hours = TEST_MODE_MAX_HOURS): string {
  return new Date(nowMs + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Is test mode actually in force right now?
 *
 * Three ways to be OFF, and all three matter:
 *   - the switch is off;
 *   - the deadline has passed (the auto-expiry above);
 *   - the switch is on but NO usable test number is configured.
 *
 * That last one is the important one. "Test mode on, recipient list empty"
 * would otherwise mean every ad goes to nobody at all — a total, silent
 * outage produced by a half-finished setting. Treating it as OFF means the
 * worst case of a misconfiguration is that ads go out normally, which is the
 * failure everyone notices immediately and nobody loses money over.
 *
 * An unparseable or missing expiry counts as EXPIRED, not as forever: a
 * corrupted timestamp must not become an indefinite quiet outage.
 */
export function testModeActive(config: TestModeConfig, nowMs: number): boolean {
  if (!config.testMode) return false;
  if (!parseTestNumbers(config.testNumbers).length) return false;
  const deadline = Date.parse(config.testModeExpiresAt ?? "");
  if (!Number.isFinite(deadline)) return false;
  return nowMs < deadline;
}

/** Why test mode is not in force — for the admin screen, which should be able
 * to say "on, but no test numbers" rather than just showing an unlit switch. */
export type TestModeState = "off" | "active" | "expired" | "no-numbers";

export function testModeState(config: TestModeConfig, nowMs: number): TestModeState {
  if (!config.testMode) return "off";
  if (!parseTestNumbers(config.testNumbers).length) return "no-numbers";
  const deadline = Date.parse(config.testModeExpiresAt ?? "");
  if (!Number.isFinite(deadline) || nowMs >= deadline) return "expired";
  return "active";
}

/** Whole minutes left before the switch expires itself (0 once it has). */
export function testModeMinutesLeft(config: TestModeConfig, nowMs: number): number {
  const deadline = Date.parse(config.testModeExpiresAt ?? "");
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - nowMs) / 60000));
}

/**
 * Cut a recipient list down to the test numbers.
 *
 * Note what this does NOT do: it never INVENTS a recipient. It filters the
 * real list, so a test number only receives anything if it is a genuine
 * subscriber row — with its own real category preferences, its own opt-out
 * state, its own block status. That is the whole point. Synthesizing a
 * recipient would test the composer while bypassing exactly the subscriber
 * plumbing (category prefs, STOP, the blocklist) that a test is for.
 *
 * A test number that is not subscribed therefore gets nothing, and the admin
 * screen says so rather than leaving the operator wondering why their phone
 * is quiet.
 */
export function narrowToTestNumbers<T extends { phone: string }>(
  recipients: T[],
  testNumbers: string[],
): T[] {
  if (!testNumbers.length) return [];
  const allow = new Set(testNumbers);
  return recipients.filter((r) => allow.has(r.phone.replace(/\D/g, "").slice(-10)));
}

/** Which configured test numbers are NOT in the subscriber list — the admin
 * screen names them, because "my test phone got nothing" is otherwise an
 * unexplainable silence. */
export function unsubscribedTestNumbers(
  recipients: { phone: string }[],
  testNumbers: string[],
): string[] {
  const have = new Set(recipients.map((r) => r.phone.replace(/\D/g, "").slice(-10)));
  return testNumbers.filter((n) => !have.has(n));
}
