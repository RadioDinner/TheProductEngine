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

/** null = verified; otherwise the reason, logged so a rejected webhook is
 * diagnosable from the Vercel function logs instead of a bare 401. */
function signatureRejection(raw: string, req: NextRequest): string | null {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKeyB64) {
    // Fail CLOSED in production: without the key we can't authenticate the
    // sender, and a forged `from` would let anyone act as any phone number.
    return isProduction ? "TELNYX_PUBLIC_KEY is not set" : null;
  }
  const signature = req.headers.get("telnyx-signature-ed25519");
  const timestamp = req.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return "missing telnyx-signature-ed25519/telnyx-timestamp headers";
  // Reject stale/replayed webhooks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TELNYX_TOLERANCE_S) {
    return `timestamp outside ${TELNYX_TOLERANCE_S}s tolerance (age ${Math.round(age)}s)`;
  }
  try {
    // Wrap Telnyx's raw 32-byte Ed25519 key in an SPKI DER header.
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyB64, "base64"),
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const ok = edVerify(
      null,
      Buffer.from(`${timestamp}|${raw}`),
      key,
      Buffer.from(signature, "base64"),
    );
    return ok ? null : "Ed25519 signature does not verify (TELNYX_PUBLIC_KEY mismatch?)";
  } catch (e) {
    return `signature check threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}

interface TelnyxMedia {
  url?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const rejection = signatureRejection(raw, req);
  if (rejection) {
    console.warn(`[telnyx-inbound] webhook rejected: ${rejection}`);
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
    const providerId = typeof payload.id === "string" ? payload.id : undefined;
    if (from) {
      try {
        await handleInbound({ from, text, ...(media.length && { media }) }, providerId);
      } catch (e) {
        // Name the failure in the function logs — a bare 500 is invisible.
        // NOTE: the message row was already recorded by recordInboundOnce, so
        // Telnyx's retry of this 500 will dedup to a no-op; the text is lost
        // until the underlying error (usually a missing migration) is fixed
        // and the sender texts again.
        console.error(
          `[telnyx-inbound] handleInbound failed for ${from} (${JSON.stringify(text.slice(0, 40))}):`,
          e,
        );
        return NextResponse.json({ error: "handler error" }, { status: 500 });
      }
    } else {
      console.warn(`[telnyx-inbound] dropped message.received with unparseable from number`);
    }
  } else if (data?.event_type === "message.sent" || data?.event_type === "message.finalized") {
    // Delivery receipts for our outbound sends. Not yet persisted, but logged:
    // this line in the function logs is the ground truth for "did the carrier
    // deliver it, and if not, which 4xxxx code came back".
    const p = data.payload ?? {};
    const recipients = Array.isArray(p.to)
      ? (p.to as { phone_number?: string; status?: string }[])
          .map((t) => `${t.phone_number}:${t.status}`)
          .join(",")
      : "";
    console.log(
      `[telnyx-dlr] ${data.event_type} id=${p.id} to=${recipients} errors=${JSON.stringify(p.errors ?? [])}`,
    );
  }
  return NextResponse.json({ ok: true });
}
