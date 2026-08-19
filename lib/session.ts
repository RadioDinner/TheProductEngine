/**
 * Cookie sessions: value is "phone.issuedAt.hmac". No server-side session
 * table needed; revocation happens by password change rotating nothing yet —
 * acceptable for v1, revisit with Supabase auth.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env";

const SESSION_COOKIE = "tpe_session";
const TICKET_COOKIE = "tpe_ticket";
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const TICKET_TTL_S = 10 * 60; // 10 minutes to finish setting a password

/**
 * The signing key. In production a missing SESSION_SECRET is fatal (fail
 * closed) rather than silently falling back to a public constant — that
 * fallback would let anyone forge a session for any phone. Resolved lazily so
 * the build never trips it; it only fires when a cookie is actually signed or
 * verified at request time.
 */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (isProduction) {
    throw new Error("SESSION_SECRET is required in production but is not set.");
  }
  return "dev-secret-not-for-production";
}

/**
 * The signature is bound to the token's KIND, not just its contents.
 *
 * Without this, a session cookie and a set-password ticket were byte-identical
 * constructions — same payload shape, same key — so either verified as the
 * other. Nothing exploitable followed today (both are httpOnly and only the
 * verified owner ever holds one, and a ticket holder can mint a session
 * legitimately anyway), but two token types that are cryptographically
 * interchangeable is a trap waiting for the third token type: the moment one
 * is added with different privileges or a different lifetime, swapping them
 * becomes a real escalation. Domain separation costs one string.
 */
type TokenKind = "session" | "ticket";

function sign(kind: TokenKind, payload: string): string {
  return createHmac("sha256", getSecret()).update(`${kind}.${payload}`).digest("hex");
}

function pack(kind: TokenKind, phone: string): string {
  const payload = `${phone}.${Date.now()}`;
  return `${payload}.${sign(kind, payload)}`;
}

function unpack(kind: TokenKind, value: string, maxAgeMs: number): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [phone, issuedAt, mac] = parts;
  const payload = `${phone}.${issuedAt}`;
  const expected = Buffer.from(sign(kind, payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (Date.now() - Number(issuedAt) > maxAgeMs) return null;
  return phone;
}

export interface Session {
  phone: string;
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const phone = unpack("session", value, SESSION_TTL_S * 1000);
  return phone ? { phone } : null;
}

/** Call from a Server Action only. */
export async function createSession(phone: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, pack("session", phone), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_S,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Short-lived proof that a code was just verified (gates set-password). */
export async function createTicket(phone: string): Promise<void> {
  const jar = await cookies();
  jar.set(TICKET_COOKIE, pack("ticket", phone), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TICKET_TTL_S,
    path: "/login",
  });
}

export async function readTicket(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TICKET_COOKIE)?.value;
  return value ? unpack("ticket", value, TICKET_TTL_S * 1000) : null;
}

export async function destroyTicket(): Promise<void> {
  const jar = await cookies();
  // Must delete at the SAME path the ticket was set with ("/login"); a bare
  // delete targets path "/" and leaves the cookie intact, so the one-time
  // set-password proof stayed reusable for its full TTL.
  jar.delete({ name: TICKET_COOKIE, path: "/login" });
}
