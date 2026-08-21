/**
 * The call-in card line (FEATURES item 31) — Twilio voice webhooks served by
 * THIS app, at /api/voice.
 *
 * Why in-app rather than the standalone pay-by-phone/ service: the app
 * already holds STRIPE_SECRET_KEY (so the "both deployments must share one
 * Stripe account" hazard disappears — it is the same account by
 * construction), it can stamp the caller's member account with the new
 * customer id immediately (no Stripe search lag), and confirmation texts go
 * out over the REGISTERED Telnyx line instead of an unregistered Twilio one.
 * The standalone service stays in the repo as a reference/fallback.
 *
 * Call flow (one route, `?step=` picks the stage). THE MENU ANSWERS. Nothing
 * in here ever dials a phone, so a caller reaches the card line on the first
 * ring instead of waiting out someone else's cell.
 *
 *   menu     → answers immediately: 1 = save a card, 2 = voicemail + callback.
 *   pay      → consent script, then <Pay> keypad capture (tokenize only).
 *   result   → attach the token to the caller's Stripe customer + confirm.
 *   voicemail→ recording lands; the operator gets a text AND an email with the
 *              audio attached.
 *
 * Session 021, user decision — "I don't want it to ring to my cell phone
 * first". Session 020 had already made the menu answer first, but kept the old
 * ring-first path alive behind `VOICE_RING_FIRST`. That switch, its stages
 * (ring / whisper / accept / after-ring) and its three environment variables
 * are now GONE rather than merely defaulted off, because "off by default" and
 * "cannot happen" are different guarantees: the first is one Vercel setting
 * away from ringing a cell phone again, and this behaviour should be a
 * property of the code that no console can flip back.
 *
 * The operator still hears about a call — just not by being dialed. A
 * voicemail texts every number in ADMIN_PHONES and emails ADMIN_EMAIL with the
 * audio attached, which is the path that already worked when nobody picked up.
 *
 * PCI: card digits go carrier → Twilio → Stripe. They never reach this app,
 * its logs, or an SMS thread. Never add a <Gather> that collects card digits.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { site } from "@/lib/config";

/** The webhook path to give Twilio ("A call comes in"). */
export const VOICE_PATH = "/api/voice";

/** The line is live only with an auth token to verify Twilio's signature. */
export const voiceConfigured = Boolean(process.env.TWILIO_AUTH_TOKEN);

/** Pay Connector name from the Twilio console (README step 4). */
export const payConnector = process.env.TWILIO_PAY_CONNECTOR || "Default";

/* ------------------------------------------------------------------ */
/* Request authenticity                                                */
/* ------------------------------------------------------------------ */

/**
 * Twilio's request signature: HMAC-SHA1 over the full URL (query string
 * included) followed by every POST parameter, sorted by name, as
 * name+value with no separators — base64.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

/**
 * null = the request really came from Twilio; otherwise the reason (logged,
 * so a rejected webhook is diagnosable from the function logs instead of a
 * bare 403). Fails CLOSED in production exactly like the Telnyx webhook: an
 * unauthenticated caller could otherwise drive the IVR and attach cards to
 * arbitrary phone numbers.
 */
export function voiceSignatureRejection(args: {
  header: string | null;
  url: string;
  params: Record<string, string>;
  authToken: string | undefined;
  production: boolean;
}): string | null {
  if (!args.authToken) return args.production ? "TWILIO_AUTH_TOKEN is not set" : null;
  if (!args.header) return "missing X-Twilio-Signature header";
  const expected = twilioSignature(args.authToken, args.url, args.params);
  const got = Buffer.from(args.header, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return "X-Twilio-Signature does not match (auth token, or a proxied URL mismatch?)";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* TwiML                                                               */
/* ------------------------------------------------------------------ */

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function say(text: string): string {
  return `<Say>${escapeXml(text)}</Say>`;
}

/** Read a phone number the way a person would hear it: digit by digit. */
export function spokenDigits(value: string): string {
  return value.replace(/\D/g, "").split("").join(" ");
}

/**
 * NOTHING IN THIS FILE MAY DIAL A PHONE (session 023, user decision).
 *
 * There used to be a `<Dial>` here that rang the operator's cells before the
 * menu, with a whisper leg and an answer-confirmation keypress to stop a
 * carrier voicemail from swallowing the call. All of it is deleted. A caller
 * to the card line reaches the menu on the first ring, every time.
 *
 * If a `<Dial>` is ever wanted back, it needs a deliberate decision rather
 * than a resurrected environment variable — the whole reason the old switch
 * went away is that it could be flipped from a console without anyone reading
 * this comment. `voice.test.mjs` asserts that no stage emits `<Dial`.
 */

/**
 * How many times a caller may press something that isn't 1 or 2 before the
 * call stops asking. Without a ceiling the menu re-prompts forever: an invalid
 * digit posts back to the same step, which serves the same menu, which accepts
 * another invalid digit. A caller with a sticky keypad, or a pocket-dial, sat
 * in that loop until they hung up — and every lap is billed.
 */
export const MENU_MAX_ATTEMPTS = 3;

/**
 * The attendant menu — now the FIRST thing a caller hears (session 020).
 *
 * The wording is the user's, near enough verbatim: "thank you for calling the
 * plain exchange, to add a card on file, press 1, to leave a voicemail and
 * receive a callback, press 2". It no longer opens with "nobody is free to
 * pick up right now", which was true when the operator's phones rang first and
 * is simply confusing now that the menu answers on the first ring.
 *
 * `attempt` is 1 for the first ask and climbs with each unrecognised key. Past
 * MENU_MAX_ATTEMPTS the caller is sent to voicemail rather than hung up on —
 * someone pressing the wrong key three times still has something to say, and
 * dropping the call loses it.
 */
export function menuTwiml(args: {
  actionUrl: string;
  /** Where silence goes. Passed explicitly rather than derived from
   * actionUrl: rewriting one URL into another with a string replace breaks
   * silently the day a query parameter moves. Optional, and its absence ends
   * the call politely instead of throwing — a TwiML builder that can throw
   * takes a live call down with it. */
  voicemailUrl?: string;
  /** 1 = first ask. Anything higher re-asks after an unrecognised key. */
  attempt?: number;
  /** Kept for callers that only need "ask again"; same as attempt: 2. */
  reprompt?: boolean;
}): string {
  const attempt = args.attempt ?? (args.reprompt ? 2 : 1);
  const lead =
    attempt > 1
      ? "Sorry, I didn't get that."
      : `Thank you for calling ${site.name}.`;
  return twiml(
    `<Gather numDigits="1" timeout="8" action="${escapeXml(args.actionUrl)}" method="POST">` +
      say(
        `${lead} To add a card on file, press 1. ` +
          "To leave a voicemail and receive a callback, press 2.",
      ) +
      `</Gather>` +
      // Gather falls through to here when the caller says nothing at all
      // (rather than pressing a wrong key), so silence ends in a voicemail
      // too instead of a dial tone.
      (args.voicemailUrl
        ? say("Let's take a message instead.") +
          `<Redirect method="POST">${escapeXml(args.voicemailUrl)}</Redirect>`
        : say("We didn't get a selection. Goodbye.") + `<Hangup/>`),
  );
}

/** Stage 3 — consent, then keypad card capture.
 *
 * The spoken sentence IS the stored-credential authorization the card
 * networks require before a card may be kept for later off-session charges;
 * the Stripe customer gets a `card_consent_at` stamp as the record.
 *
 * ⚠️ It says WHEN the charge happens, and since session 023 that is when the
 * ad runs rather than when it is written. This is not editable from
 * /admin/replies with the rest of the copy, deliberately: it is the legal
 * record of what the caller agreed to, it is pinned by test/voice.test.mjs,
 * and it has to keep agreeing with what the service actually does. If the
 * charging moment ever moves again, this sentence moves with it in the same
 * commit. */
export function payTwiml(args: { connector: string; actionUrl: string }): string {
  return twiml(
    say(
      "You will enter your card number, expiration date, security code, and billing zip code " +
        "using your phone keypad. Nobody here will hear or see the numbers. " +
        `By continuing, you authorize ${site.name} to keep this card on file and to charge it ` +
        "for the ads you place, when each ad goes out and your ad credit doesn't cover it. " +
        "To change or remove the card, call this number back any time. Let's begin.",
    ) +
      `<Pay paymentConnector="${escapeXml(args.connector)}" chargeAmount="0" ` +
      `tokenType="payment-method" securityCode="true" postalCode="true" ` +
      `maxAttempts="3" timeout="10" action="${escapeXml(args.actionUrl)}" method="POST"/>`,
  );
}

/** Stage 4 — voicemail. */
export function voicemailTwiml(args: { actionUrl: string }): string {
  return twiml(
    say(`Please leave a message after the beep, and we'll call you back.`) +
      `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
      `action="${escapeXml(args.actionUrl)}" method="POST"/>` +
      say("We didn't get a message. Goodbye.") +
      `<Hangup/>`,
  );
}

/**
 * Say something, then record — the graceful failure. Used when a stage throws:
 * the caller hears a plain apology in the service's own voice and still gets
 * to leave their message, rather than Twilio's generic error tone and a dead
 * line.
 */
export function twimlSayThenVoicemail(text: string, recordActionUrl: string): string {
  return twiml(
    say(text) +
      `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
      `action="${escapeXml(recordActionUrl)}" method="POST"/>` +
      say("We didn't get a message. Goodbye.") +
      `<Hangup/>`,
  );
}

/* ------------------------------------------------------------------ */
/* Voicemail by email                                                   */
/* ------------------------------------------------------------------ */

/**
 * The Twilio recording, as an .mp3 URL a browser can open.
 *
 * Twilio hands back a bare resource URL; appending .mp3 is what makes it play
 * rather than return JSON. Kept pure so the email body can be built and tested
 * without a network.
 */
export function recordingMp3Url(recordingUrl: string): string {
  const clean = recordingUrl.trim().replace(/\.(mp3|wav)$/i, "");
  return clean ? `${clean}.mp3` : "";
}

/** The Twilio account SID out of a recording URL, so the fetch can
 * authenticate without a second environment variable to keep in sync. */
export function accountSidFromRecordingUrl(recordingUrl: string): string | null {
  return recordingUrl.match(/\/Accounts\/(AC[0-9a-f]{32})\//i)?.[1] ?? null;
}

/**
 * Fetch the recording so it can be ATTACHED to the email rather than linked.
 *
 * Why attach at all: a Twilio media link is only playable by someone holding
 * the account credentials, and even where it opens it is a bare URL in an
 * inbox that expires with the recording. An attached mp3 plays in the mail
 * client, survives the recording being deleted, and is searchable later.
 *
 * Returns null on any failure — a missing SID, an auth rejection, a recording
 * Twilio has not finished writing yet (the action webhook can beat it by a
 * second or two), or anything oversized. The caller then sends the link-only
 * email, because a voicemail notice WITHOUT the audio still does its job and a
 * notice that never arrives does not.
 */
export async function fetchRecordingMp3(
  recordingUrl: string,
  opts: { authToken?: string; maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const url = recordingMp3Url(recordingUrl);
  const sid = accountSidFromRecordingUrl(recordingUrl);
  const token = opts.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!url || !sid || !token) return null;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    });
    if (!response.ok) {
      console.error(`[voice] recording fetch failed (${response.status})`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) {
      console.error(`[voice] recording is ${buffer.length} bytes — not attaching`);
      return null;
    }
    return buffer.toString("base64");
  } catch (e) {
    console.error("[voice] recording fetch threw:", e);
    return null;
  }
}

/** A voicemail notice for the operator's inbox. Pure — the route supplies the
 * facts and decides whether the audio could be fetched. */
export function voicemailEmail(args: {
  callerPhone: string | null;
  isMember: boolean;
  recordingUrl: string;
  seconds: number;
  attached: boolean;
  receivedAt: string;
}): { subject: string; text: string; html: string } {
  const who = args.callerPhone ? formatSpoken(args.callerPhone) : "an unknown number";
  const member = args.callerPhone ? (args.isMember ? "a member" : "not a member yet") : "";
  const link = recordingMp3Url(args.recordingUrl);
  const length = args.seconds > 0 ? `${args.seconds} second${args.seconds === 1 ? "" : "s"}` : "";
  const facts = [
    ["From", `${who}${member ? ` (${member})` : ""}`],
    ["Received", args.receivedAt],
    ...(length ? [["Length", length]] : []),
  ] as [string, string][];
  const subject = `Voicemail from ${who}${length ? ` (${length})` : ""}`;
  const note = args.attached
    ? "The recording is attached to this email."
    : "The recording could not be attached this time — use the link below.";
  const text = [
    `${site.name} — voicemail on the card line.`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    note,
    link ? `Listen: ${link}` : "",
    "",
    args.callerPhone ? `Call back: ${formatSpoken(args.callerPhone)}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const rows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#5b6670;font-size:13px;">${escapeXml(k)}</td>` +
        `<td style="padding:2px 0;font-size:15px;color:#20262b;"><strong>${escapeXml(v)}</strong></td></tr>`,
    )
    .join("");
  const html =
    `<div style="margin:0 auto;max-width:520px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;">` +
    `<p style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;color:#20262b;">Voicemail on the card line</p>` +
    `<table style="border-collapse:collapse;margin:8px 0 12px;">${rows}</table>` +
    `<p style="margin:0 0 8px;font-size:14px;color:#20262b;">${escapeXml(note)}</p>` +
    (link
      ? `<p style="margin:0;font-size:14px;"><a href="${escapeXml(link)}" style="color:#2d5570;">Play it in your browser</a></p>`
      : "") +
    `</div>`;
  return { subject, text, html };
}

/** (330) 555-0142 — the readable form for an email, not the spoken one. */
function formatSpoken(phone: string): string {
  const d = phone.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

/** A closing line — spoken, then the call ends. */
export function sayAndHangUpTwiml(text: string): string {
  return twiml(say(text) + `<Hangup/>`);
}

/** Nothing left to do on this leg (the human answered, or the recording is
 * saved): end quietly. */
export function hangUpTwiml(): string {
  return twiml(`<Hangup/>`);
}
