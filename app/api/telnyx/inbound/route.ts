/**
 * Telnyx inbound-message webhook. Point the messaging profile's webhook URL
 * here. Signature verification activates when TELNYX_PUBLIC_KEY is set
 * (Portal → Account → Public Key); without it (dev) requests are trusted.
 */
import { createPublicKey, verify as edVerify } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handleInbound } from "@/lib/engine";
import { normalizePhone } from "@/lib/phone";
import { isProduction } from "@/lib/env";

const TELNYX_TOLERANCE_S = 300;

function verifySignature(raw: string, req: NextRequest): boolean {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKeyB64) {
    // Fail CLOSED in production: without the key we can't authenticate the
    // sender, and a forged `from` would let anyone act as any phone number.
    return !isProduction;
  }
  const signature = req.headers.get("telnyx-signature-ed25519");
  const timestamp = req.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  // Reject stale/replayed webhooks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TELNYX_TOLERANCE_S) return false;
  try {
    // Wrap Telnyx's raw 32-byte Ed25519 key in an SPKI DER header.
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyB64, "base64"),
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return edVerify(
      null,
      Buffer.from(`${timestamp}|${raw}`),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

interface TelnyxMedia {
  url?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const data = (event as { data?: { event_type?: string; payload?: Record<string, unknown> } })
    .data;
  if (data?.event_type === "message.received" && data.payload) {
    const payload = data.payload;
    const from = normalizePhone(
      String((payload.from as { phone_number?: string } | undefined)?.phone_number ?? ""),
    );
    const text = String(payload.text ?? "");
    const media = Array.isArray(payload.media)
      ? (payload.media as TelnyxMedia[]).map((m) => m.url).filter((u): u is string => Boolean(u))
      : [];
    if (from) {
      await handleInbound({ from, text, ...(media.length && { media }) });
    }
  }
  // Delivery-status events (message.sent / message.finalized) are accepted
  // and ignored for now; provider_status updates come with the admin pass.
  return NextResponse.json({ ok: true });
}
