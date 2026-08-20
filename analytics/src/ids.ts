/**
 * Identity for analytics — how we say "this is the same person" without ever
 * telling Google who the person is.
 *
 * SERVER ONLY (imports node:crypto). STAGED, NOT WIRED.
 *
 * The problem this file solves: on this service most members never load a web
 * page. They text. A flip-phone seller who posts eleven ads over a year is a
 * real, valuable, repeat customer, and to a cookie-based analytics product
 * they do not exist at all. Meanwhile the one identifier we *do* have for them
 * — their phone number — is exactly the identifier we are forbidden to send
 * (Google's terms ban PII, and /privacy promises members we do not hand their
 * number to anyone for anything but delivering the service).
 *
 * The resolution:
 *
 *   phone → salted SHA-256 → `user_id`        (who, stably, but not really who)
 *   hash  → two integers   → `client_id`      (a device GA can hang a session on)
 *
 * Both are deterministic, so the same member is the same GA user across a
 * year of texts. Neither is reversible without ANALYTICS_SALT. And a member
 * who ALSO uses the website gets their browser's real `_ga` client id for web
 * events plus the same `user_id` on both sides — GA stitches the two together
 * on User-ID, which is why the property's reporting identity should be set to
 * "Blended" (see analytics/03-ga4-console-setup.md).
 */
import { createHash } from "node:crypto";

/** Ten digits, or "" if the input is not a usable US number. */
export function digitsOnly(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : "";
}

/**
 * A stable, non-reversible id for a member. Prefixed so a stray value is
 * recognisable in a report as "one of ours, hashed" rather than mistaken for
 * something meaningful.
 *
 * Returns "" for an unusable phone or a missing salt — the callers treat that
 * as "send this event without a user_id" rather than inventing one. An event
 * with no user is still a true event; an event attached to the wrong user is a
 * lie that survives in the reports forever.
 */
export function hashedMemberId(phone: string, salt: string): string {
  const digits = digitsOnly(phone);
  if (!digits || !salt) return "";
  const hex = createHash("sha256").update(`${salt}:phone:${digits}`).digest("hex");
  // 32 hex chars = 128 bits. Well inside GA's 256-char user_id limit, and far
  // beyond any collision concern at this scale.
  return `m_${hex.slice(0, 32)}`;
}

/**
 * A GA client id ("<int>.<int>") derived from a hashed member id, for events
 * that have no browser behind them at all — a text message, a phone call, a
 * cron send.
 *
 * GA requires *some* client_id on every Measurement Protocol event. The naive
 * choice is a random one per event, and it is a trap: every text a member ever
 * sends becomes a separate one-event "user", so user counts inflate by orders
 * of magnitude and every engagement metric collapses. Deriving it from the
 * member hash makes an SMS member one consistent GA user for life.
 */
export function syntheticClientId(hashedId: string): string {
  const hex = createHash("sha256").update(`client:${hashedId}`).digest("hex");
  const a = parseInt(hex.slice(0, 8), 16);
  const b = parseInt(hex.slice(8, 16), 16);
  return `${a}.${b}`;
}

/** Convenience: phone straight to the client id used for off-web events. */
export function clientIdForPhone(phone: string, salt: string): string {
  const hashed = hashedMemberId(phone, salt);
  return hashed ? syntheticClientId(hashed) : "";
}

/**
 * Pull the GA client id out of the `_ga` cookie so a SERVER event can be
 * attributed to the same browser session the member is sitting in.
 *
 * The cookie looks like `GA1.1.1234567890.1712345678`; the client id is the
 * last two dot-separated parts. Some deployments write `GA1.2.…`, and a raw
 * `1234567890.1712345678` shows up in test fixtures, so both are accepted.
 *
 * This matters for the money path: a Stripe purchase is confirmed by webhook,
 * on a server, minutes later. Without the browser's client id the purchase
 * lands as a brand-new user and the acquisition report shows revenue arriving
 * from nowhere, permanently unattributed to the campaign that earned it.
 */
export function gaClientIdFromCookie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (!/^\d+$/.test(last) || !/^\d+$/.test(secondLast)) return null;
  return `${secondLast}.${last}`;
}

/**
 * A privacy-preserving "was this the same visitor?" token for our OWN
 * first-party counter (analytics/sql/first-party-upgrade.sql) — not for GA.
 *
 * The day key is part of the hash, so the token changes at midnight and cannot
 * follow anyone from one day to the next. That is the deliberate trade: we
 * learn "roughly how many different people came today", which is the number
 * the operator actually wants, and we give up cross-day tracking, which we
 * promised not to do. Nothing identifying is stored — only the digest.
 */
export function dailyVisitorHash(
  ip: string,
  userAgent: string,
  salt: string,
  dayKey: string,
): string {
  if (!salt) return "";
  return createHash("sha256")
    .update(`${salt}:${dayKey}:${ip || "-"}:${userAgent || "-"}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * GA4 sessions are stitched by `session_id`. Server events that belong to a
 * web session should carry the browser's; events that have no session at all
 * (a text at 6am) get a stable per-member-per-day id so a day's texts read as
 * one session instead of thirty.
 */
export function syntheticSessionId(hashedId: string, dayKey: string): number {
  const hex = createHash("sha256").update(`session:${hashedId}:${dayKey}`).digest("hex");
  return parseInt(hex.slice(0, 9), 16);
}
