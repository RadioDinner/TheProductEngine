/**
 * Google Analytics 4 — configuration, read once from the environment.
 *
 * STAGED, NOT WIRED. Nothing in analytics/src is imported by the app yet; see
 * analytics/04-wiring.md for the exact steps that turn it on.
 *
 * The posture, and why:
 *
 * - **Off unless configured.** No measurement id, no tag; no API secret, no
 *   server events. A missing key must never mean "send anyway", and it must
 *   never mean "crash" either. Same fail-quiet rule the SMS and email lanes
 *   follow.
 * - **Set the measurement id on the PRODUCTION environment only.** That is the
 *   whole preview/staging story — a preview deploy with no id sends nothing,
 *   so it cannot pollute the property with test traffic. Cheaper and more
 *   reliable than sniffing VERCEL_ENV at runtime.
 * - **Advertising features stay off permanently** (see ADVERTISING_SIGNALS).
 *   We do not run ads, we promised members we do not track them around the
 *   internet, and Google Signals is the switch that would make that untrue.
 */

/**
 * Web data stream measurement id, "G-XXXXXXXXXX". Public by design — it ships
 * in the page. NEXT_PUBLIC_ prefix is required for the browser to see it, and
 * the literal `process.env.NEXT_PUBLIC_…` form is required for Next to inline
 * it at build time. Do not refactor this into a dynamic lookup.
 */
export const GA_MEASUREMENT_ID: string = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

/**
 * Measurement Protocol API secret (GA4 Admin → Data Streams → Measurement
 * Protocol API secrets). SERVER ONLY — it authorises writing events into the
 * property. Never prefix this NEXT_PUBLIC_.
 */
export const GA_API_SECRET: string = process.env.GA_API_SECRET ?? "";

/**
 * Salt used to hash a member's phone number into a GA user id. SERVER ONLY,
 * and treat it like a password: with the salt, the hashes are reversible by
 * brute force (there are only 10^10 US phone numbers). Without it they are
 * not. Rotating it resets user-level continuity in GA — new hashes, new
 * users — so rotate deliberately, not casually.
 */
export const ANALYTICS_SALT: string = process.env.ANALYTICS_SALT ?? "";

/**
 * When "1", server events go to the Measurement Protocol VALIDATION endpoint
 * instead of the real one: GA replies with what is wrong and stores nothing.
 * This is the only honest way to develop MP events — the live endpoint returns
 * 204 for a payload it silently discards.
 */
export const GA_VALIDATE_ONLY: boolean = process.env.GA_VALIDATE_ONLY === "1";

/** The browser tag is live only when a measurement id is configured. */
export const browserTagEnabled: boolean = GA_MEASUREMENT_ID !== "";

/**
 * Server-side events need all three: which property, permission to write, and
 * the salt that keeps phone numbers out of Google. Missing the salt is a
 * refusal, not a fallback to raw identifiers.
 */
export const serverEventsEnabled: boolean =
  GA_MEASUREMENT_ID !== "" && GA_API_SECRET !== "" && ANALYTICS_SALT !== "";

/** Why server events are off, in words, for /api/health and admin diagnostics. */
export function serverEventsBlockedReason(): string | null {
  if (!GA_MEASUREMENT_ID) return "NEXT_PUBLIC_GA_MEASUREMENT_ID is not set";
  if (!GA_API_SECRET) return "GA_API_SECRET is not set";
  if (!ANALYTICS_SALT) return "ANALYTICS_SALT is not set";
  return null;
}

export const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";
export const MP_DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";

/**
 * Advertising-signal switches, pushed before `config`. All false, always.
 * Google Signals is what joins a visit to a signed-in Google identity across
 * sites; ad personalization is what feeds remarketing. Both are exactly the
 * "tracking you around the internet" the privacy policy says we do not do.
 */
export const ADVERTISING_SIGNALS = {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const;

/**
 * GA4's hard limits. Exceeding them does not error — GA drops the offending
 * parameter or event and reports the correct-looking rest, which is the worst
 * possible failure mode for a number you are about to make a decision on. So
 * we clamp before sending and unit-test the clamp.
 *
 * Sources: GA4 "Events" and "Measurement Protocol" reference.
 */
export const GA_LIMITS = {
  /** Event name: letters, digits, underscores; must start with a letter. */
  eventNameMaxLength: 40,
  /** Parameters per event (excluding the reserved plumbing ones). */
  paramsPerEvent: 25,
  paramNameMaxLength: 40,
  paramValueMaxLength: 100,
  /** Events per Measurement Protocol request. */
  eventsPerRequest: 25,
  userPropertyNameMaxLength: 24,
  userPropertyValueMaxLength: 36,
  /** MP events older than this are dropped without comment. */
  backdateHours: 72,
} as const;

/** How long we wait on Google before giving up. Matches lib/sms.ts's rule:
 *  an analytics call must never be the reason a member's request hangs. */
export const MP_TIMEOUT_MS = 10_000;
