/**
 * EDITABLE AUTO-REPLY COPY (session 023, user request: "I want an admin tab
 * where I can go in and edit the messages and add or remove variables from
 * auto replies, rather than having a code/prompt session. Plus, I can see the
 * messages").
 *
 * Every message in the CATALOGUE below has a stable key, a default body, and a
 * declared list of variables. The operator edits the body on /admin/replies;
 * the edit is stored as an override and the default stays in the code as the
 * floor to fall back to. Nothing here does I/O — the store is
 * lib/message-template-store.ts and the renderer front door is lib/messages.ts,
 * so the whole of this file can be unit-pinned.
 *
 * THREE RULES THAT ARE NOT STYLE:
 *
 * 1. **A variable the operator deletes is deleted; a variable they invent is
 *    refused.** "Add or remove variables" is the feature, so `{adId}` may be
 *    dropped from any message — but `{ballance}` must not save, because it
 *    would render as nothing and the operator would never find out. Every
 *    `{token}` in a saved body is checked against that message's declared list.
 *
 * 2. **Some phrases are load-bearing and the editor refuses to lose them.**
 *    Two kinds: carrier-compliance words (STOP on the opt-out confirmation)
 *    and DEDUP MARKERS — several replies are suppressed to one per number per
 *    day by scanning the outbound log for a substring of their own text
 *    (STOP_MARKER, REDIRECT_MARKER, PIC_LIMIT_MARKER…). Edit one of those
 *    without keeping the marker and the suppression silently stops working:
 *    the message is fine, and the service starts texting somebody the same
 *    sentence every five minutes. `requires` is what stops that.
 *
 * 3. **Optional pieces are their own templates, not inline conditionals.** A
 *    confirmation is a sentence plus two or three clauses that may or may not
 *    apply (the charge, the picture note, the send window). Each clause is a
 *    template of its own and the parent carries it as a variable, so an
 *    operator can rewrite "we won't charge until it runs" without touching the
 *    sentence it sits inside, and a clause that doesn't apply renders empty
 *    without leaving a double space behind (see renderTemplate).
 */

export type TemplateChannel = "sms" | "voice" | "email";

export interface TemplateVar {
  /** Token name, used as `{name}` in the body. */
  name: string;
  /** What it holds, in the operator's language — this is UI copy. */
  describes: string;
  /** A realistic value, used for the live preview on /admin/replies. */
  example: string;
}

export interface RequiredPhrase {
  text: string;
  why: string;
}

export interface TemplateSpec {
  key: string;
  /** Heading it sits under on /admin/replies. */
  group: string;
  label: string;
  channel: TemplateChannel;
  /** When the service sends it — shown under the label. */
  when: string;
  /** The wording as shipped. An override never deletes this. */
  body: string;
  vars: TemplateVar[];
  /** Phrases the body must keep. See rule 2 above. */
  requires?: RequiredPhrase[];
  /** A clause that rides inside another message rather than being sent alone. */
  fragment?: boolean;
  /** Longest the operator may make it. SMS bodies default to SMS_MAX_CHARS. */
  maxChars?: number;
}

/** The longest a single editable SMS body may be. Six GSM segments is already
 * a real bill to send; past that it wants to be a web page, not a text. */
export const SMS_MAX_CHARS = 900;

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/** Every `{token}` a body actually uses, in order, deduped. */
export function templateTokens(body: string): string[] {
  const out: string[] = [];
  for (const m of String(body ?? "").matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Substitute `{token}` values into a body.
 *
 * The tidy-up afterwards is the part that matters. Clauses are optional and
 * render as the empty string when they don't apply, so a body written as
 * "Got it! Your ad is #{adId}. {chargeNote}{windowNote}" must not come out as
 * "Got it! Your ad is #1042.  " with two spaces and a trailing one. Runs of
 * SPACES collapse (newlines are left alone, so the multi-paragraph welcome
 * keeps its shape), a space before . , ; : ! ? is dropped, and the whole thing
 * is trimmed. An unknown token renders empty rather than printing itself —
 * the editor refuses to save one, so reaching this means a template shipped
 * with a typo, and a stray "{ballance}" in a member's text is worse than a
 * gap.
 */
export function renderTemplate(body: string, values: Record<string, unknown>): string {
  const filled = String(body ?? "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_all, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) return "";
    return String(value);
  });
  return filled
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ([.,;:!?)])/g, "$1")
    .replace(/\( /g, "(")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

export interface TemplateProblem {
  kind: "empty" | "unknown-var" | "missing-phrase" | "too-long";
  message: string;
}

/**
 * Everything wrong with a proposed body, in the order an operator would want
 * to fix it. An empty array means it saves.
 *
 * `known` is passed in rather than read off the spec so a caller can allow the
 * variables of an embedded fragment too — the parent of a clause offers both
 * its own tokens and, for convenience, nothing else; keeping the list a
 * parameter means that policy lives in one place (editableVariables below).
 */
export function validateTemplateBody(
  spec: TemplateSpec,
  body: string,
  known: string[] = spec.vars.map((v) => v.name),
): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const text = String(body ?? "");
  if (!text.trim()) {
    problems.push({ kind: "empty", message: "The message can't be blank." });
    return problems; // everything below would just repeat this
  }
  for (const token of templateTokens(text)) {
    if (!known.includes(token)) {
      problems.push({
        kind: "unknown-var",
        message: `{${token}} isn't one of this message's variables, so it would come out blank. Use one from the list, or delete it.`,
      });
    }
  }
  for (const required of spec.requires ?? []) {
    if (!text.includes(required.text)) {
      problems.push({
        kind: "missing-phrase",
        message: `This message has to keep "${required.text}" — ${required.why}`,
      });
    }
  }
  const limit = spec.maxChars ?? (spec.channel === "sms" ? SMS_MAX_CHARS : 4000);
  if (text.length > limit) {
    problems.push({
      kind: "too-long",
      message: `That's ${text.length} characters and the limit is ${limit}.`,
    });
  }
  return problems;
}

/** The variables the editor offers for a template. */
export function editableVariables(spec: TemplateSpec): TemplateVar[] {
  return spec.vars;
}

/** Example values for every declared variable — the live preview's input. */
export function exampleValues(spec: TemplateSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of spec.vars) out[v.name] = v.example;
  return out;
}

// ---------------------------------------------------------------------------
// the catalogue
// ---------------------------------------------------------------------------

/** Variables that mean the same thing everywhere they appear. */
const V = {
  adId: { name: "adId", describes: "the ad number", example: "1042" },
  price: { name: "price", describes: "what the ad costs", example: "$50.00" },
  balance: { name: "balance", describes: "the member's ad credit right now", example: "$20.00" },
  spare: {
    name: "spare",
    describes: "credit not already promised to another ad they've posted",
    example: "$20.00",
  },
  short: { name: "short", describes: "how much more they need", example: "$30.00" },
  left: { name: "left", describes: "credit left after the ad runs", example: "$130.00" },
  supportPhone: { name: "supportPhone", describes: "our phone number", example: "(330) 275-1603" },
  siteName: { name: "siteName", describes: "the name of the service", example: "The Plain Exchange" },
  siteUrl: { name: "siteUrl", describes: "the website address", example: "ThePlainExchange.com" },
  title: { name: "title", describes: "the first few words of the ad", example: "Horse cart for sale" },
  reason: { name: "reason", describes: "the reason you typed when you turned it down", example: "Please include a price." },
} as const satisfies Record<string, TemplateVar>;

/**
 * Every message the operator can edit. Order is display order on
 * /admin/replies; `group` breaks it into headings.
 *
 * Adding one here is half the job — the send site has to ask for it by key
 * (see lib/messages.ts). A key in this list that nothing renders is dead copy
 * on an admin page, which is worse than no entry at all.
 */
export const TEMPLATES: TemplateSpec[] = [
  // ---------------- an ad arrives ----------------
  {
    key: "ad.received.text",
    group: "When an ad comes in",
    label: "Ad received — text ad",
    channel: "sms",
    when: "The moment a text-only ad is accepted into the review queue.",
    body:
      "Got it! Your ad is #{adId} and is waiting for review. You'll get a text when it's approved and it goes out. {moneyNote}{photoNote}{windowNote}",
    vars: [
      V.adId,
      V.price,
      V.balance,
      { name: "moneyNote", describes: "the payment sentence (edit it below)", example: "Nothing is charged until your ad goes out." },
      { name: "photoNote", describes: "the picture advice, when there is any", example: "" },
      { name: "windowNote", describes: "when it will send, if that isn't right away", example: "" },
    ],
  },
  {
    key: "ad.received.picture",
    group: "When an ad comes in",
    label: "Ad received — ad with a picture",
    channel: "sms",
    when: "The moment an ad with a picture is accepted into the review queue.",
    body:
      "Got your ad! It's #{adId} and is waiting for review - you'll get a text when it's approved and it goes out. {moneyNote}{photoNote}{windowNote}",
    vars: [
      V.adId,
      V.price,
      V.balance,
      { name: "moneyNote", describes: "the payment sentence (edit it below)", example: "Nothing is charged until your ad goes out." },
      { name: "photoNote", describes: "the picture advice, when there is any", example: "Send more pictures one at a time." },
      { name: "windowNote", describes: "when it will send, if that isn't right away", example: "" },
    ],
  },
  {
    key: "ad.money.covered",
    group: "When an ad comes in",
    label: "Payment sentence — their credit covers it",
    channel: "sms",
    when: "Rides the ad-received text when the member's ad credit already covers the ad.",
    fragment: true,
    body: "It costs {price} and nothing is charged until your ad goes out.",
    vars: [V.price, V.balance, V.left],
  },
  {
    key: "ad.money.card",
    group: "When an ad comes in",
    label: "Payment sentence — they have a card on file",
    channel: "sms",
    when:
      "Rides the ad-received text when the ad costs more than their credit and they have a card saved. This is the promise the service now keeps: the card is charged when the ad runs, not when it is written.",
    fragment: true,
    body:
      "It costs {price} and your card won't be charged until your ad runs.",
    vars: [V.price, V.balance, V.short],
  },
  {
    key: "ad.money.owing",
    group: "When an ad comes in",
    label: "Payment sentence — they still need to pay",
    channel: "sms",
    when:
      "Rides the ad-received text when the ad costs more than their credit and there is no card on file. The ad is still reviewed; it just can't go out until the money is there.",
    fragment: true,
    body:
      "It costs {price} and you have {spare} to spend, so we'll need the other {short} before it goes out. Call {supportPhone} and press 1 to put a card on file, or add money at {siteUrl}.",
    vars: [V.price, V.spare, V.balance, V.short, V.supportPhone, V.siteUrl],
  },
  {
    key: "ad.held",
    group: "When an ad comes in",
    label: "Ad held — too many already waiting on payment",
    channel: "sms",
    when:
      "Sent instead of the ad-received text once a member has the maximum number of ads waiting on payment. The ad is saved, out of the review queue, and released as soon as they pay.",
    body:
      "Got it - your ad is saved as #{adId} and nothing has been charged. You already have {waiting} ads waiting on payment, so this one is on hold until those are covered. Call {supportPhone} and press 1 to put a card on file, or add money at {siteUrl}. Text BAL any time.",
    vars: [
      V.adId,
      V.price,
      V.balance,
      V.supportPhone,
      V.siteUrl,
      { name: "waiting", describes: "how many of their ads are already waiting on payment", example: "3" },
    ],
  },
  // ---------------- review decisions ----------------
  {
    key: "ad.approved",
    group: "After you review an ad",
    label: "Approved — going out shortly",
    channel: "sms",
    when: "You approve an ad during sending hours and it is paid for or funded.",
    body:
      "Your ad #{adId} is approved. It goes out to subscribers {batchWait}. Text STATUS {adId} any time to check it.",
    vars: [
      V.adId,
      { name: "batchWait", describes: "how soon the next batch goes", example: "with the next batch of ads, usually within the hour" },
    ],
  },
  {
    key: "ad.approved.closed",
    group: "After you review an ad",
    label: "Approved — outside sending hours",
    channel: "sms",
    when: "You approve an ad when texts aren't going out yet (overnight, Sunday, after the Saturday close).",
    body:
      "Your ad #{adId} is approved. It goes out {nextSend}{hoursClause}. Text STATUS {adId} any time to check it.",
    vars: [
      V.adId,
      { name: "nextSend", describes: "when sending starts again", example: "tomorrow at 7am" },
      { name: "hoursClause", describes: "the sending hours, when quoting them helps", example: " — texts only go out between 7am and 6pm, Monday through Saturday" },
    ],
  },
  {
    key: "ad.approved.awaiting-payment",
    group: "After you review an ad",
    label: "Approved — waiting for payment",
    channel: "sms",
    when:
      "You approve an ad the member can't pay for yet. It holds its place: nothing else has to happen once the money lands, it simply goes out with the next batch.",
    body:
      "Good news - your ad #{adId} is approved! We just need the money before it can go out. It costs {price} and you have {spare} to spend, so {short} is still owed. Call {supportPhone} and press 1 to put a card on file, or add money at {siteUrl}, and it goes out with the next batch.",
    vars: [V.adId, V.price, V.spare, V.balance, V.short, V.supportPhone, V.siteUrl],
  },
  {
    key: "ad.rejected.benign",
    group: "After you review an ad",
    label: "Turned down — fixable",
    channel: "sms",
    when: "You turn an ad down as a fixable problem rather than a rule break.",
    body:
      "Your ad #{adId} was not accepted: {reason} {refundNote} You can fix it and send it again.",
    vars: [
      V.adId,
      V.reason,
      { name: "refundNote", describes: "what happened to the money", example: "Nothing was charged." },
    ],
  },
  {
    key: "ad.rejected.violation",
    group: "After you review an ad",
    label: "Turned down — against the rules",
    channel: "sms",
    when: "You turn an ad down as a rule break. A third one suspends the member.",
    body:
      "Your ad #{adId} violated our posting guidelines and was not accepted: {reason} {warning}",
    vars: [
      V.adId,
      V.reason,
      { name: "warning", describes: "the strike count, or the suspension notice", example: "Warning 1 of 3 — a third violation will suspend your ability to post." },
    ],
  },

  // ---------------- the ad runs ----------------
  {
    key: "ad.ran",
    group: "When the ad goes out",
    label: "Receipt — the ad went out and was paid for",
    channel: "sms",
    when:
      "Sent as the ad actually goes out to subscribers, which is the moment the money moves. This is the receipt that makes \"nothing is charged until it runs\" checkable. Switch it off under Settings if you'd rather not send it.",
    body: "Your ad #{adId} just went out to subscribers. {chargeNote} See it at {siteUrl}/ad/{adId}",
    vars: [
      V.adId,
      V.price,
      V.left,
      V.siteUrl,
      V.title,
      { name: "chargeNote", describes: "what was taken and what's left", example: "$50.00 came off your ad credit — $130.00 left." },
    ],
  },
  {
    key: "ad.charge-failed",
    group: "When the ad goes out",
    label: "Couldn't take payment when the ad came up",
    channel: "sms",
    when:
      "The ad reached the front of the queue and we couldn't collect for it. It keeps its place and goes out as soon as the money is there — we don't retry the card straight away.",
    body:
      "Your ad #{adId} is ready to go out but we couldn't collect the {price} for it{cardNote}. It's holding its place. Call {supportPhone} and press 1 to put a card on file, or add money at {siteUrl}, and it goes out with the next batch.",
    vars: [
      V.adId,
      V.price,
      V.balance,
      V.supportPhone,
      V.siteUrl,
      { name: "cardNote", describes: "what the bank said, if we tried a card", example: " (card declined)" },
    ],
  },
  {
    key: "ad.funded",
    group: "When the ad goes out",
    label: "Money landed — waiting ads released",
    channel: "sms",
    when:
      "A card is saved on the phone line, or money is added, and ads that were waiting on payment can now run. It goes out on its own after a website top-up, and rides the card-saved confirmation when somebody adds a card by phone — so it deliberately carries no service name of its own.",
    body: "Thanks - your ad{plural} {adIds} {isAre} covered and {next}.",
    vars: [
      { name: "adIds", describes: "the ad numbers, comma separated", example: "#1042, #1043" },
      { name: "plural", describes: "an s when there is more than one", example: "s" },
      { name: "isAre", describes: "is / are", example: "are" },
      {
        name: "next",
        describes: "what happens now — reviewed first, or straight out with the next batch",
        example: "will go out with the next batch",
      },
    ],
  },

  // ---------------- money ----------------
  {
    key: "money.pay-instructions",
    group: "Money",
    label: "How to pay — the standard sentence",
    channel: "sms",
    when: "Ends every reply that has to ask a member for money.",
    fragment: true,
    body:
      "Call {supportPhone} and press 1 to put a card on file - we'll charge it when your ad runs. Or add money at {siteUrl}",
    vars: [V.supportPhone, V.siteUrl],
  },
  {
    key: "money.price-sheet",
    group: "Money",
    label: "The price list, in one line",
    channel: "sms",
    when: "Rides the welcome and the BAL reply. The prices themselves come from Settings — this is only the wording around them.",
    fragment: true,
    body: "Text ad {textPrice}; {picturePrices}.",
    vars: [
      { name: "textPrice", describes: "the text-ad price from Settings", example: "$20.00" },
      { name: "picturePrices", describes: "the picture prices from Settings", example: "1 pic $30.00, 2 pics $40.00, 3 pics $50.00" },
    ],
  },
  {
    key: "money.balance",
    group: "Money",
    label: "Reply to BAL",
    channel: "sms",
    when: "A member texts BAL.",
    body: "You have {balance} of ad credit.{owedNote} {priceSheet} {payInstructions}.",
    vars: [
      V.balance,
      { name: "owedNote", describes: "what their waiting ads will cost, when they have some", example: " Your ads waiting to go out will use $50.00 of it." },
      { name: "priceSheet", describes: "the price list sentence above", example: "Text ad $20.00; 1 pic $30.00." },
      { name: "payInstructions", describes: "the how-to-pay sentence above", example: "Call (330) 275-1603 and press 1 to put a card on file" },
    ],
  },

  // ---------------- sold ----------------
  {
    key: "sold.confirmed",
    group: "When something sells",
    label: "Marked sold — and who bought it?",
    channel: "sms",
    when: "A seller texts SOLD and we can open the ratings conversation.",
    body:
      "Ad #{adId} marked SOLD. Congratulations! What was the phone number of the buyer? Reply with their number and you can rate each other — or reply SKIP.",
    vars: [V.adId, V.title],
  },
  {
    key: "sold.confirmed.plain",
    group: "When something sells",
    label: "Marked sold — plain confirmation",
    channel: "sms",
    when: "A seller texts SOLD when the ratings conversation isn't available.",
    body: "Ad #{adId} marked SOLD. Congratulations!",
    vars: [V.adId, V.title],
  },

  // ---------------- subscription & compliance ----------------
  {
    key: "subscribe.already",
    group: "Joining and leaving",
    label: "They're already subscribed",
    channel: "sms",
    when: "A number that is already on the list texts SUBSCRIBE again.",
    body:
      "You're already subscribed. Ads come in batches, several to a text, {windowLabel}. Reply STOP to cancel, HELP for help.",
    vars: [
      { name: "windowLabel", describes: "the sending hours from Settings", example: "7am to 6pm Mon-Sat" },
    ],
    requires: [
      { text: "STOP", why: "carriers require every message like this to say how to opt out." },
      { text: "HELP", why: "carriers require a way to reach help." },
    ],
  },
  {
    key: "stop.confirmation",
    group: "Joining and leaving",
    label: "Opt-out confirmation",
    channel: "sms",
    when: "Someone texts STOP. This is the last message they get.",
    body:
      "{siteName}: you're unsubscribed and won't get more ads. Reply START any time to come back.",
    vars: [V.siteName],
    requires: [
      {
        text: "unsubscribed and won't get more",
        why:
          "the service finds this exact phrase in its own sent messages to avoid confirming a STOP twice. Change it and that stops working.",
      },
      { text: "START", why: "the opt-out confirmation has to say how to come back." },
    ],
  },
  {
    key: "unknown.redirect",
    group: "Joining and leaving",
    label: "We didn't understand that",
    channel: "sms",
    when: "A text that isn't a command arrives. Sent at most once a day to any one number.",
    body:
      "This is {siteName}'s automated system. To reach a seller, use the contact info in their ad. Text HELP for a list of commands.",
    vars: [V.siteName, V.supportPhone],
    requires: [
      {
        text: "automated system",
        why:
          "the service finds this exact phrase in its own sent messages to keep from repeating itself. Change it and it will reply to every stray text.",
      },
    ],
  },

  // ---------------- welcome ----------------
  {
    key: "welcome.1",
    group: "The welcome (five texts, in order)",
    label: "Welcome 1 — what this is",
    channel: "sms",
    when: "First of the five texts a new subscriber gets.",
    body:
      "Welcome to {siteName}!\n\nAds come in batches - several in one text, each with its own ad number - {windowLabel}.\n\n{priceLine}{starterLine}",
    vars: [
      V.siteName,
      { name: "windowLabel", describes: "the sending hours from Settings", example: "7am to 6pm Mon - Sat" },
      { name: "priceLine", describes: "the price list sentence", example: "Text ad $20.00; 1 pic $30.00." },
      { name: "starterLine", describes: "the free-credit offer, while it is open", example: "\n\nYou have $40.00 of free ad credit!" },
    ],
  },
  {
    key: "welcome.2",
    group: "The welcome (five texts, in order)",
    label: "Welcome 2 — how to post",
    channel: "sms",
    when: "Second of the five welcome texts.",
    body:
      "To post, text AD and your ad, like:\n\nAD Hay for sale, $5/bale. Call 330-555-0142\n\nWhen posting an AD you can send up to {maxPhotos} pictures. The first one goes out with the batch, marked with your ad number.\n\nSee more pictures by replying PIC and the ad number, like PIC 1022 - that sends up to {extraPhotos} more. The rest are on {siteUrl}!",
    vars: [
      V.siteUrl,
      { name: "maxPhotos", describes: "pictures one ad can hold", example: "8" },
      { name: "extraPhotos", describes: "extra pictures a PIC pull sends", example: "2" },
    ],
  },
  {
    key: "welcome.3",
    group: "The welcome (five texts, in order)",
    label: "Welcome 3 — the commands",
    channel: "sms",
    when: "Third of the five welcome texts.",
    body:
      "To check your balance, reply BAL\n\nTo mark your ad item as sold, reply SOLD followed by your ad number.\n\nTo view your ads, reply MY ADS.",
    vars: [],
  },
  {
    key: "welcome.4",
    group: "The welcome (five texts, in order)",
    label: "Welcome 4 — the website and paying",
    channel: "sms",
    when: "Fourth of the five welcome texts.",
    body:
      "Every ad is also on {siteUrl}.\n\nAlong with all the remaining pictures and other special features too.\n\nYou can sign up for the ads by email too, free.\n\nTo pay by card, call {cardPhone} and enter it on your phone keypad",
    vars: [
      V.siteUrl,
      { name: "cardPhone", describes: "the number to call to save a card", example: "(330) 275-1603" },
    ],
  },
  {
    key: "welcome.5",
    group: "The welcome (five texts, in order)",
    label: "Welcome 5 — pick your categories",
    channel: "sms",
    when: "Last of the five welcome texts. The category list itself is built from the categories, not from this wording.",
    body:
      "Last thing, pick what you want ads for. Reply with a number (or the word):\n{menu}\nText HELP for help. Text STOP to end.",
    vars: [
      { name: "menu", describes: "the numbered category list", example: "1 - ALL, every ad\n2 - buggies & bikes (BUGGIES)" },
    ],
    requires: [
      { text: "STOP", why: "carriers require the opt-in sequence to say how to opt out." },
      { text: "HELP", why: "carriers require a way to reach help." },
      { text: "{menu}", why: "without the category list this text asks a question nobody can answer." },
    ],
  },
  {
    key: "welcome.fallback",
    group: "The welcome (five texts, in order)",
    label: "Welcome — short version",
    channel: "sms",
    when: "Used in place of the five-text welcome where the category menu can't be offered.",
    body:
      "Welcome to {siteName}! Ads come in batches, several to a text, {windowLabel}. To place your own ad, text AD and your ad - for example: AD Hay for sale, $5/bale. Call 330-555-0142. Text HELP for all commands.",
    vars: [
      V.siteName,
      { name: "windowLabel", describes: "the sending hours from Settings", example: "7am to 6pm Mon-Sat" },
    ],
    requires: [{ text: "HELP", why: "carriers require a way to reach help." }],
  },
];

/** Look a template up by key. Unknown keys are a programming error, not an
 * operator one — the caller falls back to its own hardcoded string. */
export function templateSpec(key: string): TemplateSpec | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** The catalogue split into its display groups, order preserved. */
export function templateGroups(): { group: string; templates: TemplateSpec[] }[] {
  const out: { group: string; templates: TemplateSpec[] }[] = [];
  for (const spec of TEMPLATES) {
    const existing = out.find((g) => g.group === spec.group);
    if (existing) existing.templates.push(spec);
    else out.push({ group: spec.group, templates: [spec] });
  }
  return out;
}
