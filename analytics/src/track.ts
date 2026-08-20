/**
 * Browser-side event emitter. The one place the app is allowed to talk to
 * gtag, so every event goes through the same clamping and the same catalogue
 * check.
 *
 * STAGED, NOT WIRED.
 *
 * Design rules:
 *
 * - **Never throw, never block.** A missing tag, an ad blocker, a member with
 *   JavaScript off — all of it is a silent no-op. Analytics that can break a
 *   page is worse than no analytics.
 * - **No PII, enforced at the door.** See scrubValue(): anything that looks
 *   like a phone number or an email address is replaced before it can leave.
 *   Ad bodies on this site are full of phone numbers; a well-meaning
 *   `search_term` or `link_url` is exactly how one escapes.
 * - **Unknown event names warn in development.** A typo in an event name is
 *   invisible in production — GA accepts it and files it under a name nobody
 *   ever looks at.
 */
import { EVENT_CATALOGUE, eventNameProblem, sanitizeParams, type GaParams } from "./events";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const KNOWN = new Set(EVENT_CATALOGUE.map((e) => e.name));

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Strip anything that reads like a phone number or an email address.
 *
 * Deliberately blunt, and deliberately applied to every string parameter
 * rather than to a list of "risky" ones. The failure we are preventing is not
 * carelessness with a field we thought about — it is a field nobody thought
 * about, added in a hurry, carrying a member's number into Google's servers
 * where we cannot delete it.
 */
export function scrubValue(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone]");
}

function scrubParams(params: GaParams): GaParams {
  const out: GaParams = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "string" ? scrubValue(value) : value;
  }
  return out;
}

/** Is a tag actually loaded in this browser right now? */
export function tagReady(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

/** Send one event. Safe to call from anywhere, including during SSR. */
export function track(name: string, params: GaParams = {}): void {
  if (isDev()) {
    const problem = eventNameProblem(name);
    if (problem) console.warn(`[analytics] event "${name}" ${problem}`);
    else if (!KNOWN.has(name)) {
      console.warn(`[analytics] event "${name}" is not in the catalogue (analytics/src/events.ts)`);
    }
  }
  if (!tagReady()) return;
  const clean = sanitizeParams(scrubParams(params));
  if (isDev() && clean.dropped.length) {
    console.warn(`[analytics] "${name}" dropped parameters:`, clean.dropped.join(", "));
  }
  try {
    window.gtag?.("event", name, clean.params);
  } catch {
    // An analytics call is never worth an exception in a click handler.
  }
}

/** A manual page_view, because the tag is configured with send_page_view:false. */
export function trackPageView(pagePath: string, pageTitle?: string): void {
  if (!tagReady()) return;
  try {
    window.gtag?.("event", "page_view", {
      page_path: pagePath,
      page_location: typeof location !== "undefined" ? location.href : undefined,
      page_title: pageTitle,
    });
  } catch {
    /* no-op */
  }
}

/**
 * Attach the signed-in member to this browser. Takes the SALTED HASH from
 * ids.ts, computed on the server — never a phone number. The hash arrives as
 * a prop from a server component; the browser never sees the salt.
 */
export function identify(hashedMemberId: string): void {
  if (!tagReady() || !hashedMemberId) return;
  try {
    window.gtag?.("set", { user_id: hashedMemberId });
  } catch {
    /* no-op */
  }
}

/** Clear the user id on sign-out so the next person on a shared machine — and
 *  in this community a shared machine is common — is not counted as the last. */
export function forgetUser(): void {
  if (!tagReady()) return;
  try {
    window.gtag?.("set", { user_id: null });
  } catch {
    /* no-op */
  }
}

/**
 * User-scoped dimensions (member_status, signup_channel, line_type…). These
 * stick to the user in GA and are what make "sellers versus buyers" a filter
 * rather than a guess.
 */
export function setUserProperties(props: Record<string, string | number>): void {
  if (!tagReady()) return;
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props)) {
    safe[key.slice(0, 24)] = typeof value === "string" ? scrubValue(value).slice(0, 36) : value;
  }
  try {
    window.gtag?.("set", "user_properties", safe);
  } catch {
    /* no-op */
  }
}

/**
 * Consent Mode. Advertising storage is denied permanently and is not
 * parameterised here — there is no code path in this app that should ever
 * grant it. Only analytics storage is a decision, and it is the site's to
 * make; see analytics/05-privacy-and-consent.md.
 */
export function setAnalyticsConsent(granted: boolean): void {
  if (!tagReady()) return;
  try {
    window.gtag?.("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  } catch {
    /* no-op */
  }
}
