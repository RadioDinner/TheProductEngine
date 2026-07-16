/**
 * Inbound-email webhook — lets people subscribe to the email edition by sending
 * a message to subscribe@theplainexchange.com (no website visit needed).
 *
 * Wire it up in Resend: add an Inbound address for subscribe@ (MX records per
 * Resend's setup) pointing its webhook at /api/email/inbound, and set
 * RESEND_WEBHOOK_SECRET (the endpoint's `whsec_…` signing secret). Resend signs
 * with Svix headers (svix-id / svix-timestamp / svix-signature); we verify them
 * and fail CLOSED in production if the secret is missing, so nobody can forge a
 * subscribe event. The webhook is authenticated, but the email's From header is
 * trivially spoofable — so a valid inbound message does NOT enroll the sender.
 * It sends a confirm link (double opt-in); the subscription only happens when
 * the real inbox owner clicks it. Symmetric with the web form.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { addPhotoSubmission, countAdPhotos, getAdRecord, logMessage } from "@/lib/engine-store";
import { confirmUrl, siteUrl } from "@/lib/email";
import { dispatchEmail } from "@/lib/outbound";
import { isProduction } from "@/lib/env";
import { site } from "@/lib/config";
import { MAX_PHOTOS_PER_AD, normalizeAttachments, parseAdNumber } from "@/lib/email-photos";
import { attachmentBytes, storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";

const TOLERANCE_S = 300;
const INBOUND_ADDRESS = (process.env.EMAIL_INBOUND_ADDRESS ?? "subscribe@theplainexchange.com").toLowerCase();
const PHOTOS_ADDRESS = (process.env.EMAIL_PHOTOS_ADDRESS ?? "photos@theplainexchange.com").toLowerCase();
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

function confirmEmail(to: string): { subject: string; html: string; text: string } {
  const link = confirmUrl(to);
  const subject = `Confirm your email — ${site.name}`;
  const text = [
    `You (or someone using this address) asked to get ${site.name}'s ads by email.`,
    ``,
    `Confirm to start the email editions: ${link}`,
    ``,
    `If you didn't ask for this, ignore this message — you won't be subscribed.`,
    ``,
    `Prefer text messages? Text SUBSCRIBE to ${site.smsNumber}. Browse anytime at ${siteUrl}.`,
  ].join("\n");
  const html = `<div style="margin:0 auto;max-width:600px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
    <p style="font-size:16px;">You (or someone using this address) asked to get <strong>${site.name}</strong>'s ads by email.</p>
    <p><a href="${link}" style="display:inline-block;background:#2d5570;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:2px;font-weight:600;">Confirm my email</a></p>
    <p style="font-size:13px;color:#5b6670;">If you didn't ask for this, ignore this message — you won't be subscribed.</p>
  </div>`;
  return { subject, html, text };
}

/**
 * Emailed-in extra ad pictures (FEATURES item 1): a message to photos@ with
 * the ad number in the subject ("Ad 1042" / "#1042") and pictures attached.
 * Every image is byte-sniffed and re-hosted exactly like an MMS photo, then
 * parked as a SUBMISSION awaiting admin review on /admin/ads — the sender
 * address is spoofable, so review is the gate, and nothing goes live here.
 * The sender gets one acknowledgment only when something was actually saved
 * (no backscatter for junk mail).
 */
async function handlePhotoEmail(
  sender: string,
  data: Record<string, unknown>,
): Promise<NextResponse> {
  const subject = typeof data.subject === "string" ? data.subject : "";
  const text = typeof data.text === "string" ? data.text : "";
  const adId = parseAdNumber(subject, text);
  if (!adId) {
    console.log("[email:photos] no ad number in subject/body — ignored");
    return NextResponse.json({ ok: true });
  }
  const ad = await getAdRecord(adId);
  // Live-ish ads only: extras make no sense for rejected/sold/expired/deleted.
  if (!ad || (ad.status !== "approved" && ad.status !== "pending")) {
    console.log(`[email:photos] ad #${adId} not accepting pictures — ignored`);
    return NextResponse.json({ ok: true });
  }
  const attachments = normalizeAttachments(data.attachments);
  if (!attachments.length) return NextResponse.json({ ok: true });

  const room = MAX_PHOTOS_PER_AD - (await countAdPhotos(adId));
  let saved = 0;
  let unsupported = false;
  for (const attachment of attachments.slice(0, Math.max(0, room))) {
    const bytes = await attachmentBytes(attachment);
    if (!bytes) continue;
    let url: string | null = null;
    if (supabaseConfigured) {
      const stored = await storeImageBytes(bytes);
      if (!stored.ok) {
        console.log("[email:photos] attachment rejected:", stored.reason);
        continue;
      }
      url = stored.url;
    } else {
      // Dev mode has no storage bucket — inline the (sniff-verified) image so
      // the review/gallery flow still works end-to-end in walks.
      const ext = sniffImage(bytes);
      if (!ext) continue;
      url = `data:${CONTENT_TYPE_BY_EXT[ext]};base64,${bytes.toString("base64")}`;
    }
    const outcome = await addPhotoSubmission(adId, url, sender);
    if (outcome === "unsupported") {
      unsupported = true;
      break;
    }
    saved++;
  }
  if (unsupported) {
    console.error("[email:photos] migration 0015 not applied — submission dropped");
    return NextResponse.json({ ok: true });
  }
  if (saved > 0) {
    const ackText = [
      `Got ${saved === 1 ? "your picture" : `${saved} pictures`} for ad #${adId}.`,
      ``,
      `They'll appear on the ad's website listing once they're approved (every picture is reviewed by hand, usually within a day).`,
      ``,
      `${site.name} · ${siteUrl}/ad/${adId}`,
    ].join("\n");
    const ackHtml = `<div style="margin:0 auto;max-width:600px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
      <p style="font-size:16px;">Got ${saved === 1 ? "your picture" : `${saved} pictures`} for <strong>ad #${adId}</strong>.</p>
      <p style="font-size:14px;">They'll appear on <a href="${siteUrl}/ad/${adId}" style="color:#2d5570;">the ad's website listing</a> once they're approved — every picture is reviewed by hand, usually within a day.</p>
    </div>`;
    try {
      await dispatchEmail(
        { to: sender, subject: `Pictures received for ad #${adId}`, text: ackText, html: ackHtml },
        { cls: "transactional" },
      );
      await logMessage({
        direction: "outbound",
        channel: "email",
        address: sender,
        body: `Pictures received for ad #${adId}\n\n${ackText}`,
      });
    } catch (e) {
      console.error("[email:photos] ack send failed:", e);
    }
  }
  return NextResponse.json({ ok: true, saved });
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
  // photos@ = emailed-in extra pictures for an ad (FEATURES item 1).
  const toPhotos = recipients.some((r) => r === PHOTOS_ADDRESS || r.split("@")[0] === "photos");
  if (sender && toPhotos) return handlePhotoEmail(sender, data);
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

  // Double opt-in: do NOT enroll on receipt (the From is spoofable). Send a
  // confirm link; the subscribe happens only when the real owner clicks it.
  const { subject, html, text } = confirmEmail(sender);
  try {
    await dispatchEmail({ to: sender, subject, html, text }, { cls: "transactional" });
    await logMessage({ direction: "outbound", channel: "email", address: sender, body: `${subject}\n\n${text}`, html });
  } catch (e) {
    // A failed confirm send must not fail the webhook (Resend would just retry).
    console.error("[email:inbound] confirm send failed:", e);
  }
  return NextResponse.json({ ok: true, confirmationSent: sender });
}
