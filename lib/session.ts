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

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function pack(phone: string): string {
  const payload = `${phone}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function unpack(value: string, maxAgeMs: number): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [phone, issuedAt, mac] = parts;
  const payload = `${phone}.${issuedAt}`;
  const expected = Buffer.from(sign(payload));
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
  const phone = unpack(value, SESSION_TTL_S * 1000);
  return phone ? { phone } : null;
}

/** Call from a Server Action only. */
export async function createSession(phone: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, pack(phone), {
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
  jar.set(TICKET_COOKIE, pack(phone), {
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
  return value ? unpack(value, TICKET_TTL_S * 1000) : null;
}

export async function destroyTicket(): Promise<void> {
  const jar = await cookies();
  // Must delete at the SAME path the ticket was set with ("/login"); a bare
  // delete targets path "/" and leaves the cookie intact, so the one-time
  // set-password proof stayed reusable for its full TTL.
  jar.delete({ name: TICKET_COOKIE, path: "/login" });
}
