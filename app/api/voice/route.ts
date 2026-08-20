/**
 * The call-in card line — every stage of the Twilio voice call, selected by
 * `?step=`. Point the Twilio number's "A call comes in" webhook at
 * https://<site>/api/voice (HTTP POST); every later stage is an action URL
 * this route hands back, so there is only ever one thing to configure.
 *
 * See lib/voice.ts for the flow, the TwiML, and the PCI rule (card digits
 * never reach this app — Twilio tokenizes them straight into Stripe).
 */
import { after, NextResponse, type NextRequest } from "next/server";
import * as analytics from "@/analytics/src/server-events";
import { setAfterImpl } from "@/analytics/src/after";
import { startCall, updateCall } from "@/lib/call-log";
import { site } from "@/lib/config";
import { isProduction } from "@/lib/env";
import { savePhoneCapturedCard } from "@/lib/payments";
import { normalizePhone } from "@/lib/phone";
import { sms } from "@/lib/sms";
import { ensureAccount, getAccount } from "@/lib/store";
import {
  VOICE_PATH,
  acceptTwiml,
  callWasAnswered,
  hangUpTwiml,
  menuTwiml,
  payConnector,
  payTwiml,
  ringSeconds,
  ringToPhones,
  ringTwiml,
  sayAndHangUpTwiml,
  spokenDigits,
  voiceSignatureRejection,
  voicemailTwiml,
  whisperTwiml,
} from "@/lib/voice";

// Attaching the card is three sequential Stripe calls on a live phone call —
// well inside this, but the platform default is not worth the risk.
// This route emits analytics; keep them alive past the response.
setAfterImpl(after);

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function xml(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** The public origin Twilio actually called — the signature covers the exact
 * URL, so this must be the outside-world host, not Vercel's internal one. */
function origin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `https://${host}`;
}

function stepUrl(req: NextRequest, step: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ step, ...extra });
  return `${origin(req)}${VOICE_PATH}?${params}`;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const step = url.searchParams.get("step") ?? "";

  // Twilio posts application/x-www-form-urlencoded; the signature covers the
  // full URL plus every one of these fields.
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const rejection = voiceSignatureRejection({
    header: req.headers.get("x-twilio-signature"),
    url: `${origin(req)}${url.pathname}${url.search}`,
    params,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    production: isProduction,
  });
  if (rejection) {
    console.error(`[voice] rejected ${step || "entry"}: ${rejection}`);
    return new NextResponse("forbidden", { status: 403 });
  }

  const caller = normalizePhone(params.From ?? params.Caller ?? "");
  const callSid = params.CallSid ?? "";

  switch (step) {
    /* The operator's phones ring first; whoever picks up hears who is
     * calling, and the call is simply a conversation. */
    case "": {
      await startCall({
        callSid,
        fromPhone: caller,
        toPhone: normalizePhone(params.To ?? ""),
      });
      const phones = ringToPhones();
      if (!phones.length) return xml(menuTwiml({ actionUrl: stepUrl(req, "menu") }));
      return xml(
        ringTwiml({
          phones,
          seconds: ringSeconds(),
          actionUrl: stepUrl(req, "after-ring"),
          whisperUrl: stepUrl(req, "whisper", caller ? { caller } : {}),
        }),
      );
    }

    case "whisper":
      return xml(
        whisperTwiml({
          callerPhone: url.searchParams.get("caller"),
          acceptUrl: stepUrl(req, "accept"),
        }),
      );

    case "accept":
      return xml(acceptTwiml(Boolean((params.Digits ?? "").trim())));

    /* A person confirmed and talked = handled, nothing more to do. Everything
     * else (no answer, busy, a voicemail box that picked up, a leg the
     * whisper dropped) falls through to the attendant. */
    case "after-ring": {
      const answered = callWasAnswered(params.DialCallStatus, params.DialCallDuration);
      await updateCall(callSid, {
        outcome: answered ? "answered" : "attendant",
        ...(answered && { durationSeconds: Number(params.DialCallDuration) }),
      });
      // How many people phone rather than text. This audience picks up the
      // phone, and until now the only record of it was the call log.
      after(() =>
        analytics.callInbound({
          phone: caller || undefined,
          outcome: answered ? "answered" : "attendant",
          durationSeconds: answered ? Number(params.DialCallDuration) || 0 : 0,
        }),
      );
      return answered
        ? xml(hangUpTwiml())
        : xml(menuTwiml({ actionUrl: stepUrl(req, "menu") }));
    }

    case "menu": {
      const digit = (params.Digits ?? "").trim();
      if (digit === "1") {
        return xml(payTwiml({ connector: payConnector, actionUrl: stepUrl(req, "pay-result") }));
      }
      if (digit === "2") {
        return xml(voicemailTwiml({ actionUrl: stepUrl(req, "voicemail") }));
      }
      return xml(menuTwiml({ actionUrl: stepUrl(req, "menu"), reprompt: true }));
    }

    /* Twilio has tokenized the card into Stripe and handed us a pm_… id. */
    case "pay-result": {
      if (params.Result !== "success" || !params.PaymentToken || !caller) {
        console.error("[voice] card capture failed:", {
          result: params.Result,
          error: params.PaymentError,
          code: params.PayErrorCode,
          caller,
        });
        await updateCall(callSid, {
          outcome: "card_failed",
          detail: `card entry ${params.Result ?? "failed"}${params.PayErrorCode ? ` (${params.PayErrorCode})` : ""}`,
        });
        return xml(
          sayAndHangUpTwiml(
            "Sorry, we could not save that card. Please check the card and call again. Goodbye.",
          ),
        );
      }
      // A first-time caller gets an account right here, so "call in, put a
      // card on file, start posting" works end to end.
      const account = await ensureAccount(caller);
      const saved = await savePhoneCapturedCard({
        phone: caller,
        paymentMethodId: params.PaymentToken,
        storedCustomerId: account.stripeCustomerId,
      });
      if (!saved) {
        await updateCall(callSid, {
          outcome: "card_failed",
          detail: "the card was captured but Stripe rejected it (see the function log)",
        });
        return xml(
          sayAndHangUpTwiml(
            "Sorry, something went wrong on our end and the card was not saved. Please call again later. Goodbye.",
          ),
        );
      }
      // Is the phone card line paying for itself? This is the event that
      // answers it — the only conversion the voice channel produces.
      after(() => analytics.cardSaved({ phone: caller, channel: "voice" }));
      const last4 = (params.PaymentCardNumber ?? "").replace(/\D/g, "").slice(-4);
      await updateCall(callSid, {
        outcome: "card_saved",
        detail: last4 ? `card ending ${last4} saved` : "card saved",
      });
      // The confirmation goes out on the REGISTERED Telnyx line (the same
      // number members already text), not the Twilio voice number.
      if (last4) {
        await sms
          .send(
            caller,
            `${site.name}: your card ending ${last4} is saved. When you post an ad and your ad credit runs short, we'll charge the difference to this card. Call this number any time to change or remove it. Reply STOP to opt out of texts.`,
          )
          .catch((e) => console.error("[voice] card confirmation text failed:", e));
      }
      return xml(
        sayAndHangUpTwiml(
          `Thank you. Your card${last4 ? ` ending in ${spokenDigits(last4)}` : ""} is saved, ` +
            "and we've sent you a text to confirm. Goodbye.",
        ),
      );
    }

    /* A recording landed — tell the operator by text; the audio lives in the
     * Twilio console (this app never stores it). */
    case "voicemail": {
      const recording = params.RecordingUrl ?? "";
      const admins = (process.env.ADMIN_PHONES ?? "")
        .split(",")
        .map((entry) => normalizePhone(entry.trim()))
        .filter((phone): phone is string => Boolean(phone));
      await updateCall(callSid, {
        outcome: "voicemail",
        recordingUrl: recording || null,
        ...(params.RecordingDuration && { durationSeconds: Number(params.RecordingDuration) }),
      });
      after(() =>
        analytics.callInbound({
          phone: caller || undefined,
          outcome: "voicemail",
          durationSeconds: Number(params.RecordingDuration) || 0,
        }),
      );
      const from = caller ? await getAccount(caller) : null;
      const who = caller ? `+1${caller}${from ? "" : " (not a member yet)"}` : "an unknown number";
      for (const admin of admins) {
        await sms
          .send(
            admin,
            `${site.name}: voicemail on the card line from ${who}. Listen: ${recording}`,
          )
          .catch((e) => console.error("[voice] voicemail notice failed:", e));
      }
      return xml(sayAndHangUpTwiml("Thank you. We'll call you back. Goodbye."));
    }

    /* Twilio's call status callback (optional to configure, and the only
     * source of the TOTAL length of a call — our other webhooks fire while
     * the caller is still on the line). */
    case "status": {
      if (params.CallStatus === "completed") {
        await updateCall(callSid, {
          durationSeconds: Number(params.CallDuration) || 0,
          endedAt: new Date().toISOString(),
        });
      }
      return new NextResponse(null, { status: 204 });
    }

    default:
      console.error(`[voice] unknown step "${step}"`);
      return xml(sayAndHangUpTwiml("Sorry, something went wrong. Goodbye."));
  }
}
