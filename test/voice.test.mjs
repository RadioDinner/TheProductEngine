// The call-in card line: request authenticity and the TwiML each stage
// returns. A forged webhook could attach cards to arbitrary phone numbers,
// so the signature check gets the same scrutiny as money code.
import * as voice from "../lib/voice.ts";
import {
  escapeXml,
  hangUpTwiml,
  MENU_MAX_ATTEMPTS,
  accountSidFromRecordingUrl,
  menuTwiml,
  recordingMp3Url,
  voicemailEmail,
  payTwiml,
  sayAndHangUpTwiml,
  spokenDigits,
  twilioSignature,
  twimlSayThenVoicemail,
  voiceSignatureRejection,
  voicemailTwiml,
} from "../lib/voice.ts";

export const name = "voice";

const TOKEN = "12345";
const URL_A = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS_A = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675309",
  Digits: "1234",
  From: "+14158675309",
  To: "+18005551212",
};

export function run(t) {
  /* ---- signature algorithm ---- */
  // Twilio's own documented example (auth token "12345"): URL + every param
  // sorted by name, concatenated name+value, HMAC-SHA1, base64.
  t.eq(
    "documented Twilio vector",
    twilioSignature(TOKEN, URL_A, PARAMS_A),
    "RSOYDt4T1cUTdK1PDd93/VVr8B8=",
  );
  // Parameter ORDER must not matter (form field order is not guaranteed).
  const shuffled = Object.fromEntries(Object.entries(PARAMS_A).reverse());
  t.eq(
    "param order irrelevant",
    twilioSignature(TOKEN, URL_A, shuffled),
    twilioSignature(TOKEN, URL_A, PARAMS_A),
  );
  // Anything else in the covered material must change the signature.
  t.eq(
    "different token -> different signature",
    twilioSignature("54321", URL_A, PARAMS_A) === twilioSignature(TOKEN, URL_A, PARAMS_A),
    false,
  );
  t.eq(
    "query string is covered",
    twilioSignature(TOKEN, "https://mycompany.com/myapp.php?foo=1", PARAMS_A) ===
      twilioSignature(TOKEN, URL_A, PARAMS_A),
    false,
  );
  t.eq(
    "a tampered param -> different signature",
    twilioSignature(TOKEN, URL_A, { ...PARAMS_A, From: "+13305551234" }) ===
      twilioSignature(TOKEN, URL_A, PARAMS_A),
    false,
  );

  /* ---- the gate ---- */
  const good = twilioSignature(TOKEN, URL_A, PARAMS_A);
  const gate = (over) =>
    voiceSignatureRejection({
      header: good,
      url: URL_A,
      params: PARAMS_A,
      authToken: TOKEN,
      production: true,
      ...over,
    });
  t.eq("valid signature accepted", gate({}), null);
  t.eq("wrong signature rejected", gate({ header: "nope" }) !== null, true);
  t.eq("missing header rejected", gate({ header: null }) !== null, true);
  t.eq("forged From rejected", gate({ params: { ...PARAMS_A, From: "+13305551234" } }) !== null, true);
  // Fail CLOSED in production without a token; open in dev so the flow can be
  // exercised locally (same rule as the Telnyx webhook).
  t.eq("no token in production -> rejected", gate({ authToken: undefined }) !== null, true);
  t.eq("no token in dev -> allowed", gate({ authToken: undefined, production: false }), null);

  /* ---- nothing may dial a phone (session 021, user decision) ---- */
  // The operator's cells used to ring for 18 seconds before the menu got its
  // turn, behind VOICE_RING_FIRST. The switch and its stages are deleted, and
  // these checks are what stop them growing back: an env var that silently
  // resurrects a <Dial> is the exact failure mode the removal was for.
  for (const gone of [
    "ringTwiml",
    "whisperTwiml",
    "acceptTwiml",
    "callWasAnswered",
    "ringToPhones",
    "ringFirst",
    "ringSeconds",
  ]) {
    t.eq(`${gone} is gone from lib/voice`, gone in voice, false);
  }

  const menu = menuTwiml({ actionUrl: "https://x.test/api/voice?step=menu" });
  t.eq("menu: one digit gathered", /numDigits="1"/.test(menu), true);
  t.eq("menu: offers the card option", /press 1/i.test(menu), true);
  /* ---- the menu answers first now, and says the user's words (session 020) ---- */
  t.eq("menu: greets rather than apologising for nobody picking up",
    /thank you for calling/i.test(menu), true);
  t.eq("menu: no longer claims nobody is free", /nobody is free/i.test(menu), false);
  t.eq("menu: names the card option the user's way",
    /add a card on file, press 1/i.test(menu), true);
  t.eq("menu: names the voicemail option the user's way",
    /leave a voicemail and receive a callback, press 2/i.test(menu), true);
  // Silence must land somewhere useful, not on a dial tone.
  const withVm = menuTwiml({ actionUrl: "https://x.test/api/voice?step=menu&attempt=1",
    voicemailUrl: "https://x.test/api/voice?step=to-voicemail" });
  t.eq("menu: silence redirects to voicemail", /<Redirect/.test(withVm), true);
  t.eq("menu: and does not just hang up", /<Hangup/.test(withVm), false);
  // A builder that throws takes a live call down, so a missing URL degrades.
  t.eq("menu: without a voicemail URL it ends politely instead of throwing",
    /<Hangup/.test(menuTwiml({ actionUrl: "u" })), true);
  // NB say() XML-escapes, so the apostrophe is &apos; in the rendered TwiML.
  t.eq("menu: a later attempt apologises",
    /Sorry, I didn&apos;t get that/.test(menuTwiml({ actionUrl: "u", attempt: 3 })), true);
  t.eq("menu: the first attempt does not apologise",
    /Sorry, I didn&apos;t get that/.test(menuTwiml({ actionUrl: "u", attempt: 1 })), false);
  t.eq("menu: there is a ceiling on re-asks", MENU_MAX_ATTEMPTS >= 2 && MENU_MAX_ATTEMPTS <= 5, true);

  /* ---- voicemail by email (session 020) ---- */
  t.eq("recording url becomes a playable mp3",
    recordingMp3Url("https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9"),
    "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9.mp3");
  t.eq("an already-.mp3 url is not doubled",
    recordingMp3Url("https://x.test/RE9.mp3"), "https://x.test/RE9.mp3");
  t.eq("a blank url stays blank", recordingMp3Url("  "), "");
  // A synthetic SID, assembled from parts so no literal Twilio Account SID
  // pattern ever sits in the repo — GitHub's push protection blocks those, and
  // it is right to: a real one belongs in the environment, never in a test.
  const sid = "AC" + "0123456789abcdef".repeat(2);
  t.eq("account sid comes out of the recording url",
    accountSidFromRecordingUrl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/RE8`), sid);
  t.eq("a url with no account sid yields null",
    accountSidFromRecordingUrl("https://x.test/nope"), null);
  const mail = voicemailEmail({
    callerPhone: "2343010048", isMember: false,
    recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9",
    seconds: 34, attached: true, receivedAt: "Aug 21, 2026, 9:14 AM",
  });
  t.eq("email subject names the caller", /\(234\) 301-0048/.test(mail.subject), true);
  t.eq("email subject carries the length", /34 seconds/.test(mail.subject), true);
  t.eq("email says the audio is attached", /attached to this email/i.test(mail.text), true);
  t.eq("email still carries the link", /RE9\.mp3/.test(mail.text), true);
  t.eq("email flags a non-member", /not a member yet/i.test(mail.text), true);
  const noAudio = voicemailEmail({
    callerPhone: null, isMember: false, recordingUrl: "https://x.test/RE1",
    seconds: 0, attached: false, receivedAt: "Aug 21, 2026, 9:14 AM",
  });
  t.eq("without audio the email says so", /could not be attached/i.test(noAudio.text), true);
  t.eq("an unknown caller is named as such", /unknown number/i.test(noAudio.subject), true);
  t.eq("menu: offers a message", /press 2/i.test(menu), true);
  t.eq("menu: hangs up when nothing is pressed", menu.includes("<Hangup/>"), true);
  t.eq("menu: reprompt differs", menuTwiml({ actionUrl: "u", reprompt: true }) !== menuTwiml({ actionUrl: "u" }), true);

  const pay = payTwiml({ connector: "Default", actionUrl: "https://x.test/api/voice?step=pay-result" });
  t.eq("pay: tokenize only (charges nothing today)", /chargeAmount="0"/.test(pay), true);
  t.eq("pay: returns a payment-method id", /tokenType="payment-method"/.test(pay), true);
  t.eq("pay: asks for CVC and zip", /securityCode="true"/.test(pay) && /postalCode="true"/.test(pay), true);
  t.eq("pay: names the connector", /paymentConnector="Default"/.test(pay), true);
  // The spoken stored-credential authorization is what card networks require
  // before a card may be kept for later off-session charges.
  t.eq("pay: consent is spoken before capture", /you authorize/i.test(pay), true);
  t.eq("pay: consent precedes the Pay verb", pay.indexOf("authorize") < pay.indexOf("<Pay"), true);
  // No <Gather> may ever collect card digits — that would put them in our logs.
  t.eq("pay: no digit gathering", pay.includes("<Gather"), false);

  const vm = voicemailTwiml({ actionUrl: "https://x.test/api/voice?step=voicemail" });
  t.eq("voicemail: records with a beep", /<Record /.test(vm) && /playBeep="true"/.test(vm), true);
  t.eq("voicemail: bounded length", /maxLength="120"/.test(vm), true);

  t.eq("hang-up is a bare Response", hangUpTwiml().includes("<Hangup/>"), true);
  t.eq("closing line speaks then hangs up", /<Say>.*<\/Say><Hangup\/>/.test(sayAndHangUpTwiml("Bye")), true);

  /* ---- helpers ---- */
  t.eq("digits are spoken singly", spokenDigits("4242"), "4 2 4 2");
  t.eq("formatting stripped before speaking", spokenDigits("(330) 600-1834"), "3 3 0 6 0 0 1 8 3 4");
  t.eq("xml escaping", escapeXml(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");

  /* ---- every stage is well-formed XML with exactly one Response ---- */
  const stages = [
    ["menu", menu],
    ["menu (reprompt)", menuTwiml({ actionUrl: "u", attempt: 2 })],
    ["pay", pay],
    ["voicemail", vm],
    ["hangup", hangUpTwiml()],
    ["closing line", sayAndHangUpTwiml("Bye")],
    ["error -> voicemail", twimlSayThenVoicemail("Sorry", "https://x.test/api/voice?step=voicemail")],
  ];
  for (const [label, doc] of stages) {
    t.eq(`${label}: declares XML`, doc.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>'), true);
    t.eq(`${label}: one closing Response`, (doc.match(/<\/Response>/g) ?? []).length, 1);
    // The regression that matters: no stage may place an outbound call. A
    // <Dial> anywhere in this list means a caller is listening to someone's
    // cell ring again instead of reaching the menu.
    t.eq(`${label}: does not dial a phone`, /<Dial\b/.test(doc), false);
  }
}
