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
 * Call flow (one route, `?step=` picks the stage):
 *   ring     → the operator phones ring first (whisper announces the caller);
 *              answered = a normal human conversation, nothing else happens.
 *   menu     → nobody answered: 1 = save a card, 2 = leave a message.
 *   pay      → consent script, then <Pay> keypad capture (tokenize only).
 *   result   → attach the token to the caller's Stripe customer + confirm.
 *   voicemail→ recording lands, the operator gets a text with the link.
 *
 * PCI: card digits go carrier → Twilio → Stripe. They never reach this app,
 * its logs, or an SMS thread. Never add a <Gather> that collects card digits.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { site } from "@/lib/config";
import { normalizePhone } from "@/lib/phone";

/** The webhook path to give Twilio ("A call comes in"). */
export const VOICE_PATH = "/api/voice";

/** The line is live only with an auth token to verify Twilio's signature. */
export const voiceConfigured = Boolean(process.env.TWILIO_AUTH_TOKEN);

/** Pay Connector name from the Twilio console (README step 4). */
export const payConnector = process.env.TWILIO_PAY_CONNECTOR || "Default";

/**
 * The phones that ring before the attendant picks up — "my cell and my
 * wife's" (user request, session 016). Comma-separated 10-digit numbers in
 * VOICE_RING_TO; empty means the attendant answers immediately.
 */
export function ringToPhones(): string[] {
  return (process.env.VOICE_RING_TO ?? "")
    .split(",")
    .map((entry) => normalizePhone(entry.trim()))
    .filter((phone): phone is string => Boolean(phone));
}

/** How long those phones ring before the attendant takes over. Keep it UNDER
 * the cells' own voicemail delay (usually 25–30 s) — otherwise a personal
 * voicemail "answers" the call and the attendant never gets its turn. */
export function ringSeconds(): number {
  const configured = Number(process.env.VOICE_RING_SECONDS);
  return Number.isFinite(configured) && configured >= 5 && configured <= 60
    ? Math.round(configured)
    : 18;
}

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

/** Stage 1 — ring the operator phones, then fall through to the attendant.
 * callerId is deliberately NOT set: on a call forwarded from your own Twilio
 * number Twilio passes the ORIGINAL caller through, so the cell shows the
 * member's number and you can just call them back. */
export function ringTwiml(args: {
  phones: string[];
  seconds: number;
  actionUrl: string;
  whisperUrl: string;
}): string {
  const numbers = args.phones
    .map((phone) => `<Number url="${escapeXml(args.whisperUrl)}">+1${phone}</Number>`)
    .join("");
  return twiml(
    `<Dial timeout="${args.seconds}" action="${escapeXml(args.actionUrl)}" method="POST">${numbers}</Dial>`,
  );
}

/**
 * Played to whoever picks up, before they're connected — and it demands a
 * keypress ("answer confirmation").
 *
 * The keypress is the load-bearing part: a CELL'S VOICEMAIL ANSWERS THE CALL
 * (phone off, busy, or — the way this was found — the member is calling from
 * a number that is itself on the ring list, so the carrier sends it straight
 * to their mailbox). An answered leg would otherwise bridge the caller to a
 * beep, and the attendant would never run. A mailbox can't press a key, so
 * it gets hung up and the caller falls through to the menu.
 */
export function whisperTwiml(args: { callerPhone: string | null; acceptUrl: string }): string {
  const who = args.callerPhone ? ` from ${spokenDigits(args.callerPhone)}` : "";
  return twiml(
    `<Gather numDigits="1" timeout="6" action="${escapeXml(args.acceptUrl)}" method="POST">` +
      say(`${site.name} call${who}. Press any key to take it.`) +
      `</Gather><Hangup/>`,
  );
}

/** The answer-confirmation verdict on the ANSWERING leg: a key was pressed,
 * so bridge the two calls (an empty response ends the whisper and connects);
 * otherwise drop this leg and let the caller move on to the attendant. */
export function acceptTwiml(pressedKey: boolean): string {
  return pressedKey ? twiml("") : twiml(`<Hangup/>`);
}

/**
 * Did a person actually take the call? Twilio reports a voicemail pickup —
 * and a leg the whisper hung up — as `completed` too, so the DURATION of the
 * bridged conversation is what separates them: nothing was bridged unless
 * someone confirmed, which makes any positive duration a real conversation.
 */
export function callWasAnswered(status: string | undefined, duration: string | undefined): boolean {
  return status === "completed" && Number(duration) > 0;
}

/** Stage 2 — the attendant menu (nobody answered). */
export function menuTwiml(args: { actionUrl: string; reprompt?: boolean }): string {
  const lead = args.reprompt
    ? "Sorry, I didn't get that."
    : `Thanks for calling ${site.name}. Nobody is free to pick up right now.`;
  return twiml(
    `<Gather numDigits="1" timeout="8" action="${escapeXml(args.actionUrl)}" method="POST">` +
      say(
        `${lead} To put a card on file for your ads, press 1. ` +
          "To leave a message, press 2.",
      ) +
      `</Gather>` +
      say("We didn't get a selection. Goodbye.") +
      `<Hangup/>`,
  );
}

/** Stage 3 — consent, then keypad card capture.
 *
 * The spoken sentence IS the stored-credential authorization the card
 * networks require before a card may be kept for later off-session charges;
 * the Stripe customer gets a `card_consent_at` stamp as the record. */
export function payTwiml(args: { connector: string; actionUrl: string }): string {
  return twiml(
    say(
      "You will enter your card number, expiration date, security code, and billing zip code " +
        "using your phone keypad. Nobody here will hear or see the numbers. " +
        `By continuing, you authorize ${site.name} to keep this card on file and to charge it ` +
        "for the ads you place, when your ad credit runs short. " +
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

/** A closing line — spoken, then the call ends. */
export function sayAndHangUpTwiml(text: string): string {
  return twiml(say(text) + `<Hangup/>`);
}

/** Nothing left to do on this leg (the human answered, or the recording is
 * saved): end quietly. */
export function hangUpTwiml(): string {
  return twiml(`<Hangup/>`);
}
