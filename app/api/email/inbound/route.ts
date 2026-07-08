/**
 * Inbound-email webhook — lets people subscribe to the email edition by sending
 * a message to subscribe@theplainexchange.com (no website visit needed).
 *
 * Wire it up in Resend: add an Inbound address for subscribe@ (MX records per
 * Resend's setup) pointing its webhook at /api/email/inbound, and set
 * RESEND_WEBHOOK_SECRET (the endpoint's `whsec_…` signing secret). Resend signs
 * with Svix headers (svix-id / svix-timestamp / svix-signature); we verify them
 * and fail CLOSED in production if the secret is missing, so nobody can forge a
 * subscribe event. Per the product decision, a valid inbound message subscribes
 * the sender directly and sends a welcome with a one-click unsubscribe link.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { subscribeEmailOnly } from "@/lib/store";
import { logMessage } from "@/lib/engine-store";
import { siteUrl, unsubscribeUrl } from "@/lib/email";
import { dispatchEmail } from "@/lib/outbound";
import { isProduction } from "@/lib/env";
import { site } from "@/lib/config";

const TOLERANCE_S = 300;
const INBOUND_ADDRESS = (process.env.EMAIL_INBOUND_ADDRESS ?? "subscribe@theplainexchange.com").toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Verify a Svix-signed webhook (Resend's scheme). */
function verifySvix(secret: string, req: NextRequest, raw: string): boolean {
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !timestamp || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${raw}`).digest();
  // Header is a space-separated list of "v1,<base64sig>" entries.
  for (const part of sigHeader.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const candidate = Buffer.from(part.slice(comma + 1), "base64");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** Pull a bare lowercased address out of "Name <a@b.com>" or "a@b.com". */
function parseAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/<([^>]+)>/);
  const addr = (match ? match[1] : raw).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

/** Normalize a to/from field that may be a string, an object, or a list of either. */
function addressList(value: unknown): string[] {
  const out: string[] = [];
  const one = (v: unknown) => {
    if (typeof v === "string") {
      const a = parseAddress(v);
      if (a) out.push(a);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const a = parseAddress(o.address ?? o.email ?? o.value);
      if (a) out.push(a);
    }
  };
  if (Array.isArray(value)) value.forEach(one);
  else one(value);
  return out;
}

function welcomeEmail(to: string): { subject: string; html: string; text: string } {
  const unsub = unsubscribeUrl(to);
  const subject = `You're subscribed — ${site.name}`;
  const text = [
    `You're subscribed to ${site.name} — ${site.region} classifieds by email.`,
    ``,
    `The ads come to this address with each email edition, pictures included.`,
    `Browse anytime at ${siteUrl}.`,
    ``,
    `Prefer text messages? Text SUBSCRIBE to ${site.smsNumber}.`,
    ``,
    `To stop the emails, unsubscribe here: ${unsub}`,
  ].join("\n");
  const html = `<div style="margin:0 auto;max-width:600px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
    <p style="font-size:18px;font-weight:600;">You're subscribed to ${site.name}.</p>
    <p style="font-size:15px;line-height:1.5;">The classified ads for ${site.region} will come to this address with each email edition, pictures included. Browse anytime at <a href="${siteUrl}" style="color:#2d5570;">the website</a>.</p>
    <p style="font-size:14px;color:#5b6670;">Prefer text messages? Text <strong>SUBSCRIBE</strong> to ${site.smsNumber}.</p>
    <p style="font-size:12px;color:#5b6670;">Didn't sign up, or want to stop? <a href="${unsub}" style="color:#2d5570;">Unsubscribe with one click</a>.</p>
  </div>`;
  return { subject, html, text };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const raw = await req.text();
  if (secret) {
    if (!verifySvix(secret, req, raw)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (isProduction) {
    // Fail closed: an unauthenticated subscribe endpoint could be spammed to
    // enroll (and email) arbitrary addresses.
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  // Resend nests the email under `data`; tolerate a flat shape too.
  const data = (event.data as Record<string, unknown>) ?? event;
  const typeStr = String(event.type ?? event.event ?? "").toLowerCase();
  const looksInbound = typeStr.includes("inbound") || typeStr.includes("received");

  const sender = parseAddress(
    typeof data.from === "string"
      ? data.from
      : (data.from as Record<string, unknown> | undefined)?.address ??
          (data.from as Record<string, unknown> | undefined)?.email,
  );
  const recipients = [
    ...addressList(data.to),
    ...addressList((data.envelope as Record<string, unknown> | undefined)?.to),
  ];
  const toSubscribe =
    recipients.some((r) => r === INBOUND_ADDRESS || r.split("@")[0] === "subscribe") ||
    (looksInbound && recipients.length === 0);

  if (!sender || !toSubscribe) {
    // Not a subscribe message (e.g. a delivery-status event on this endpoint,
    // or a shape we can't read) — acknowledge without acting.
    if (!looksInbound && recipients.length === 0) {
      console.log("[email:inbound] ignored event type:", typeStr || "(none)");
    }
    return NextResponse.json({ ok: true });
  }

  const isNew = await subscribeEmailOnly(sender);
  if (isNew) {
    const { subject, html, text } = welcomeEmail(sender);
    try {
      await dispatchEmail({ to: sender, subject, html, text }, { cls: "transactional" });
      await logMessage({ direction: "outbound", channel: "email", address: sender, body: `${subject}\n\n${text}`, html });
    } catch (e) {
      // Already subscribed; a failed welcome must not fail the webhook (Resend
      // would retry and, since they're now subscribed, skip the welcome anyway).
      console.error("[email:inbound] welcome send failed:", e);
    }
  }
  return NextResponse.json({ ok: true, subscribed: sender, welcomed: isNew });
}
