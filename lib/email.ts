/**
 * Email transport + signed links. Resend sends for real once RESEND_API_KEY
 * exists; until then the dev transport logs sends into the message audit and
 * the /dev/email viewer renders them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isProduction } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
}

/** True while no email provider is configured — enables the dev viewer. */
export const emailDevEcho = !process.env.RESEND_API_KEY;

export const siteUrl = process.env.SITE_URL ?? "http://localhost:3311";
const FROM = process.env.EMAIL_FROM ?? "The Plain Exchange <ads@theplainexchange.com>";

const devTransport: EmailTransport = {
  async send(msg) {
    console.log(`[email:dev] to ${msg.to}: ${msg.subject}`);
  },
};

const resendTransport: EmailTransport = {
  async send(msg) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend send failed (${response.status}): ${await response.text()}`);
    }
  },
};

export const email: EmailTransport = emailDevEcho ? devTransport : resendTransport;

// ---------- stateless signed links (confirm + unsubscribe) ----------

function tokenSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (isProduction) {
    throw new Error("SESSION_SECRET is required in production but is not set.");
  }
  return "dev-secret-not-for-production";
}

export function emailToken(purpose: "confirm" | "unsub", address: string): string {
  return createHmac("sha256", tokenSecret())
    .update(`${purpose}:${address.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyEmailToken(
  purpose: "confirm" | "unsub",
  address: string,
  token: string,
): boolean {
  const expected = Buffer.from(emailToken(purpose, address));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function confirmUrl(address: string): string {
  return `${siteUrl}/email/confirm?e=${encodeURIComponent(address)}&t=${emailToken("confirm", address)}`;
}

export function unsubscribeUrl(address: string): string {
  return `${siteUrl}/email/unsubscribe?e=${encodeURIComponent(address)}&t=${emailToken("unsub", address)}`;
}
