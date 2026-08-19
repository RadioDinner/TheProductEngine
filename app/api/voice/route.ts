/**
 * The call-in card line — every stage of the Twilio voice call, selected by
 * `?step=`. Point the Twilio number's "A call comes in" webhook at
 * https://<site>/api/voice (HTTP POST); every later stage is an action URL
 * this route hands back, so there is only ever one thing to configure.
 *
 * See lib/voice.ts for the flow, the TwiML, and the PCI rule (card digits
 * never reach this app — Twilio tokenizes them straight into Stripe).
 */
import { NextResponse, type NextRequest } from "next/server";
import { site } from "@/lib/config";
import { isProduction } from "@/lib/env";
import { savePhoneCapturedCard } from "@/lib/payments";
import { normalizePhone } from "@/lib/phone";
import { sms } from "@/lib/sms";
import { ensureAccount, getAccount } from "@/lib/store";
import {
  VOICE_PATH,
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

  switch (step) {
    /* The operator's phones ring first; whoever picks up hears who is
     * calling, and the call is simply a conversation. */
    case "": {
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
      return xml(whisperTwiml(url.searchParams.get("caller")));

    /* Answered = handled by a human, nothing more to do. Any other outcome
     * (no answer, busy, the call went to a personal voicemail box) drops
     * through to the attendant. */
    case "after-ring":
      return params.DialCallStatus === "completed"
        ? xml(hangUpTwiml())
        : xml(menuTwiml({ actionUrl: stepUrl(req, "menu") }));

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
        return xml(
          sayAndHangUpTwiml(
            "Sorry, something went wrong on our end and the card was not saved. Please call again later. Goodbye.",
          ),
        );
      }
      const last4 = (params.PaymentCardNumber ?? "").replace(/\D/g, "").slice(-4);
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

    default:
      console.error(`[voice] unknown step "${step}"`);
      return xml(sayAndHangUpTwiml("Sorry, something went wrong. Goodbye."));
  }
}
