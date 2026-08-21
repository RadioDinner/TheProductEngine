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
import { email } from "@/lib/email";
import { savePhoneCapturedCard } from "@/lib/payments";
import { releaseHeldAds, releasedAdsMessage } from "@/lib/ad-billing";
import { normalizePhone } from "@/lib/phone";
import { sms } from "@/lib/sms";
import { ensureAccount, getAccount, setAutoTopUp } from "@/lib/store";
import {
  MENU_MAX_ATTEMPTS,
  VOICE_PATH,
  acceptTwiml,
  callWasAnswered,
  fetchRecordingMp3,
  hangUpTwiml,
  menuTwiml,
  payConnector,
  payTwiml,
  ringFirst,
  ringSeconds,
  ringToPhones,
  ringTwiml,
  sayAndHangUpTwiml,
  spokenDigits,
  twimlSayThenVoicemail,
  voicemailEmail,
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

/** The menu, with its attempt count carried in the action URL so the next
 * post-back knows which ask it is answering. */
function menu(req: NextRequest, attempt: number): string {
  return menuTwiml({
    actionUrl: stepUrl(req, "menu", { attempt: String(attempt) }),
    voicemailUrl: stepUrl(req, "to-voicemail"),
    attempt,
  });
}

/**
 * Every stage runs inside a catch. A thrown error would otherwise reach Twilio
 * as an HTTP 500, and Twilio answers that with its own robot apology before
 * dropping the call — the caller hears a machine fail and learns nothing, and
 * the operator hears about it never.
 *
 * So a failure speaks in the service's own voice and, wherever the caller
 * might still have something to say, hands them to voicemail instead of
 * hanging up. Losing a card entry to a Stripe outage is a bad minute; losing
 * the call itself is a lost customer.
 */
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    const step = new URL(req.url).searchParams.get("step") ?? "entry";
    console.error(`[voice] unhandled error at step "${step}":`, e);
    // Mid-card-entry there is nothing safe to retry, so apologise and end.
    // Anywhere else, a message still gets the caller what they rang for.
    const recoverable = step !== "pay-result" && step !== "voicemail";
    return recoverable
      ? xml(
          twimlSayThenVoicemail(
            "Sorry, we hit a problem on our end. Please leave a message after the beep and we'll call you back.",
            `${origin(req)}${VOICE_PATH}?step=voicemail`,
          ),
        )
      : xml(
          sayAndHangUpTwiml(
            "Sorry, we hit a problem on our end. Please call again in a few minutes. Goodbye.",
          ),
        );
  }
}

async function handle(req: NextRequest) {
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
    /* The menu answers immediately (session 020). With VOICE_RING_FIRST set,
     * the operator's phones ring first instead and whoever picks up hears who
     * is calling. */
    case "": {
      await startCall({
        callSid,
        fromPhone: caller,
        toPhone: normalizePhone(params.To ?? ""),
      });
      // The menu answers FIRST (session 020, user decision). Ringing the
      // operator ahead of it is opt-in via VOICE_RING_FIRST — keyed to its own
      // flag rather than to "is VOICE_RING_TO set", so the deployment that
      // asked for this change gets it without also having to clear a variable.
      const phones = ringToPhones();
      if (!ringFirst() || !phones.length) return xml(menu(req, 1));
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
      return answered ? xml(hangUpTwiml()) : xml(menu(req, 1));
    }

    case "menu": {
      const digit = (params.Digits ?? "").trim();
      if (digit === "1") {
        return xml(payTwiml({ connector: payConnector, actionUrl: stepUrl(req, "pay-result") }));
      }
      if (digit === "2") {
        return xml(voicemailTwiml({ actionUrl: stepUrl(req, "voicemail") }));
      }
      // An unrecognised key. Ask again, but count the asks: without a ceiling
      // the caller can loop here forever, and every lap is billed.
      const attempt = Number(url.searchParams.get("attempt") ?? "1") + 1;
      if (attempt > MENU_MAX_ATTEMPTS) {
        await updateCall(callSid, { detail: "menu: no valid selection, sent to voicemail" });
        return xml(voicemailTwiml({ actionUrl: stepUrl(req, "voicemail") }));
      }
      return xml(menu(req, attempt));
    }

    /* Silence at the menu — Gather fell through rather than posting a digit.
     * Someone who says nothing still called for a reason, so take a message
     * rather than hang up on them. */
    case "to-voicemail":
      return xml(voicemailTwiml({ actionUrl: stepUrl(req, "voicemail") }));

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
      // Turn ON automatic top-up, because the caller just consented to it out
      // loud. payTwiml's script is the stored-credential authorization the card
      // networks require, word for word: "you authorize … to keep this card on
      // file and to charge it for the ads you place, when your ad credit runs
      // short." The confirmation text below repeats the promise.
      //
      // Without this the promise was empty. coverShortfallWithCard returns
      // early unless getAutoTopUp is true, and saving a card never set it — so
      // a member could call, press 1, add a card, re-text their ad and be told
      // again that they have no credit. That dead end is exactly the loop the
      // "call and add a card" reply now sends people into, so it has to close.
      //
      // Best-effort: "unsupported" (pre-9973 column) or a thrown error must not
      // fail a call in which the card WAS saved.
      try {
        await setAutoTopUp(caller, true);
      } catch (e) {
        console.error("[voice] could not enable auto top-up after a card save:", e);
      }
      // Is the phone card line paying for itself? This is the event that
      // answers it — the only conversion the voice channel produces.
      after(() => analytics.cardSaved({ phone: caller, channel: "voice" }));
      const last4 = (params.PaymentCardNumber ?? "").replace(/\D/g, "").slice(-4);
      await updateCall(callSid, {
        outcome: "card_saved",
        detail: last4 ? `card ending ${last4} saved` : "card saved",
      });
      // Anything this member wrote while they had no money is waiting: held
      // ads out of the review queue, approved ads backed off after a failed
      // collection. Letting them move HERE is what makes the promise in the
      // held-ad reply ("call and press 1") true at the moment the caller is
      // still on the line. Never throws: the card is already saved and a live
      // call must not fail over this.
      //
      // ⚠️ It no longer CHARGES them (session 021) — an ad is collected for
      // when it runs — so the wording below says "covered and on the way",
      // not "paid for". That distinction is the whole point of the change and
      // it must not drift back.
      const release = await releaseHeldAds(caller);
      const freed = [...release.admitted, ...release.unheld];
      // The confirmation goes out on the REGISTERED Telnyx line (the same
      // number members already text), not the Twilio voice number.
      // What the member is told depends on what actually happened, because
      // "you can post ads automatically now" is a claim and it has to be true.
      // release.admitted went back into the REVIEW queue and still needs a
      // yes; release.unheld was already approved and rides the next batch.
      const heldNote = freed.length
        ? ` ${await releasedAdsMessage(freed, release.admitted)}`
        : "";
      await sms
        .send(
          caller,
          `${site.name}: your card ending ${last4 || "on file"} is saved, so you can post ads any time — we charge this card when your ad runs, never before.${heldNote} Call this number any time to change or remove it. Reply STOP to opt out of texts.`,
        )
        .catch((e) => console.error("[voice] card confirmation text failed:", e));
      const spokenHeld = freed.length
        ? ` Your waiting ad${freed.length === 1 ? " is" : "s are"} covered and will go out with the next batch.`
        : "";
      return xml(
        sayAndHangUpTwiml(
          `Thank you. Your card${last4 ? ` ending in ${spokenDigits(last4)}` : ""} is saved, ` +
            `so you can post ads any time.${spokenHeld} ` +
            "We've sent you a text to confirm. Goodbye.",
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
      // …and into the inbox (user request, session 020), with the audio
      // ATTACHED where it can be fetched. A texted Twilio link needs account
      // credentials to open and dies with the recording; an mp3 in the inbox
      // plays on any device and is still there next year.
      //
      // Deliberately after the texts and individually caught: the SMS notice
      // is the one that reaches a phone in a barn, and an email problem must
      // never cost it. Twilio is also still holding the line waiting for TwiML.
      const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim();
      if (adminEmail && recording) {
        try {
          const audio = await fetchRecordingMp3(recording);
          const body = voicemailEmail({
            callerPhone: caller || null,
            isMember: Boolean(from),
            recordingUrl: recording,
            seconds: Number(params.RecordingDuration) || 0,
            attached: Boolean(audio),
            receivedAt: new Date().toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "America/New_York",
            }),
          });
          await email.send({
            to: adminEmail,
            subject: body.subject,
            text: body.text,
            html: body.html,
            ...(audio && {
              attachments: [
                { filename: `voicemail-${caller || "unknown"}-${callSid || "call"}.mp3`, content: audio },
              ],
            }),
          });
        } catch (e) {
          console.error("[voice] voicemail email failed:", e);
        }
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
