/**
 * The event catalogue — the single definition of what we count and what we
 * call it. Docs are generated from this list by hand; tests assert every entry
 * is legal GA4. If an event is not in here, it should not be sent.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE NAMING TRAP, read this before adding anything
 * ─────────────────────────────────────────────────────────────────────────
 * GA4 RESERVES `ad_click`, `ad_impression`, `ad_exposure`, `ad_query`,
 * `ad_activeview` and `ad_reward`. This business is *about* ads. The obvious
 * names for our own most important events are all taken, and GA silently
 * discards events that use a reserved name — you would see nothing and have no
 * error to search for.
 *
 * So a classified ad is a **listing** everywhere in this catalogue:
 * `listing_view`, `listing_reveal`, `listing_approved`. It reads slightly
 * off against the rest of the codebase (which says "ad"), and that is the
 * cost of the collision. RESERVED_EVENT_NAMES below is checked by the test
 * suite so this cannot be re-introduced by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY SOME EVENTS USE GOOGLE'S NAMES AND OTHERS USE OURS
 * ─────────────────────────────────────────────────────────────────────────
 * Google's recommended names (`sign_up`, `login`, `purchase`, `refund`,
 * `begin_checkout`, `search`, `view_item`, `select_item`, `generate_lead`)
 * light up GA4's built-in reports with no configuration. Everything else gets
 * a custom name and needs a custom dimension to be reportable. So: use
 * Google's name wherever the meaning genuinely matches, ours where it does
 * not. Forcing a bad fit onto a recommended name is worse than a custom event
 * — it puts nonsense into a report someone will trust.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT NEVER GOES IN A PARAMETER
 * ─────────────────────────────────────────────────────────────────────────
 * No phone numbers. No email addresses. No ad body text, ad titles or chat
 * text — members write their own phone numbers into ad bodies constantly, and
 * the website masks them for exactly that reason. No names, no addresses.
 * Sending any of it would breach Google's own terms (which forbid PII) *and*
 * the promise on /privacy. Identify people only by the salted hash from
 * ids.ts. This is not a style rule; it is the rule.
 */

/** A parameter value GA4 accepts. */
export type GaParamValue = string | number | boolean;

/**
 * An `items[]` entry. We only ever populate the non-personal fields.
 * `item_name` is deliberately absent from this type: an ad's name is member-
 * written text, and there is no safe way to send it.
 */
export interface GaItem {
  item_id: string;
  item_category?: string;
  item_list_name?: string;
  item_brand?: string;
  price?: number;
  quantity?: number;
  index?: number;
}

export type GaParams = Record<string, GaParamValue | GaItem[] | undefined>;

/**
 * Names GA4 will not accept from us. Sending one is a silent no-op, so this
 * list is enforced in tests rather than trusted to memory.
 * Source: GA4 "Reserved event names" reference.
 */
export const RESERVED_EVENT_NAMES: ReadonlySet<string> = new Set([
  "ad_activeview",
  "ad_click",
  "ad_exposure",
  "ad_impression",
  "ad_query",
  "ad_reward",
  "adunit_exposure",
  "app_clear_data",
  "app_exception",
  "app_install",
  "app_remove",
  "app_store_refund",
  "app_store_subscription_cancel",
  "app_store_subscription_convert",
  "app_store_subscription_renew",
  "app_update",
  "app_upgrade",
  "dynamic_link_app_open",
  "dynamic_link_app_update",
  "dynamic_link_first_open",
  "error",
  "firebase_campaign",
  "firebase_in_app_message_action",
  "firebase_in_app_message_dismiss",
  "firebase_in_app_message_impression",
  "first_open",
  "first_visit",
  "in_app_purchase",
  "notification_dismiss",
  "notification_foreground",
  "notification_open",
  "notification_receive",
  "os_update",
  "session_start",
  "user_engagement",
]);

/** Prefixes GA4 rejects outright. */
export const RESERVED_PREFIXES: readonly string[] = ["_", "firebase_", "google_", "ga_"];

/** Where an event is emitted from. */
export type EventScope =
  /** The browser tag, on the website. */
  | "web"
  /** Our servers, via the Measurement Protocol — SMS, voice, cron, webhooks. */
  | "server"
  /** Both, distinguished by the `channel` parameter. */
  | "both";

export interface EventSpec {
  /** The GA4 event name, exactly as sent. */
  name: string;
  scope: EventScope;
  /** Where it fires from, in terms someone can find in the codebase. */
  trigger: string;
  /** The question this event exists to answer. If you cannot fill this in,
   *  do not add the event — an unread number still costs quota and attention. */
  question: string;
  /** Parameter names this event carries. */
  params: readonly string[];
  /** True for events proposed as GA4 "key events" (conversions). */
  keyEvent?: boolean;
}

/**
 * THE CATALOGUE.
 *
 * Ordered as the business reads: reach → interest → supply → money → the
 * off-web channels that most of this audience actually lives on.
 */
export const EVENT_CATALOGUE: readonly EventSpec[] = [
  // ── Reach and navigation ────────────────────────────────────────────────
  {
    name: "page_view",
    scope: "web",
    trigger: "Every App Router navigation (analytics/src/GoogleAnalytics.tsx).",
    question: "What do people look at, and where did they arrive from?",
    params: ["page_path", "page_location", "page_title"],
  },
  {
    name: "view_item_list",
    scope: "web",
    trigger: "Homepage and any category-filtered browse.",
    question: "Which categories do buyers actually browse?",
    params: ["item_list_name", "listing_category", "results_count", "items"],
  },
  {
    name: "select_item",
    scope: "web",
    trigger: "Clicking through from a list to an ad.",
    question: "Which listings earn the click, and from which list position?",
    params: ["item_list_name", "items"],
  },
  {
    name: "view_item",
    scope: "web",
    trigger: "/ad/[id] rendered.",
    question: "Which listings and categories get looked at?",
    params: ["items", "listing_category", "listing_age_days", "has_photo"],
  },
  {
    name: "search",
    scope: "web",
    trigger: "Homepage search submitted.",
    question: "What are people looking for that we may not carry?",
    params: ["search_term", "results_count"],
  },

  // ── Buyer intent — the events that mean a sale might happen ─────────────
  {
    name: "listing_reveal",
    scope: "web",
    trigger: 'lib/reveal-actions.ts revealNumber() — the "Show number" button.',
    question:
      "How many real buyer contacts does the site produce? This is the closest thing the website has to a sale, because the deal itself happens on the phone where we cannot see it.",
    params: ["listing_category", "reveals_left", "items"],
    keyEvent: true,
  },
  {
    name: "listing_reveal_blocked",
    scope: "web",
    trigger: "revealNumber() refused: daily allowance exhausted, or not signed in.",
    question:
      "Is the anti-scraping allowance costing real buyers? A rising count here is the signal to raise revealsPerDay.",
    params: ["reason", "listing_category"],
  },
  {
    name: "chat_start",
    scope: "web",
    trigger: "lib/account-actions.ts startChat().",
    question: "How often does interest turn into an actual conversation?",
    params: ["listing_category"],
    keyEvent: true,
  },
  {
    name: "chat_message_sent",
    scope: "web",
    trigger: "lib/chat-actions.ts sendChatText() / sendChatPhoto().",
    question: "Do conversations continue, or die after one message?",
    params: ["has_photo", "message_index"],
  },

  // ── Supply — getting ads onto the board ─────────────────────────────────
  {
    name: "post_start",
    scope: "web",
    trigger: "/account/post rendered.",
    question: "How many people start posting an ad but never finish?",
    params: [],
  },
  {
    name: "post_submit",
    scope: "both",
    trigger: 'lib/post-actions.ts postAd() (web) and the "AD NEW" command (SMS).',
    question:
      "How many ads get posted, and — the one that shapes the whole product — how many come by text versus the website?",
    params: ["channel", "listing_category", "photo_count", "has_photo", "value", "currency"],
    keyEvent: true,
  },
  {
    name: "post_blocked",
    scope: "both",
    trigger: "A post refused before review: word filter, insufficient balance, blocked number.",
    question: "What stops people posting? Each reason is a different fix.",
    params: ["channel", "reason"],
  },
  {
    name: "listing_approved",
    scope: "server",
    trigger: "Operator approves on /admin/ads.",
    question: "How long do sellers wait for review, and does that wait cost us repeat posts?",
    params: ["listing_category", "wait_minutes", "channel", "photo_count"],
  },
  {
    name: "listing_rejected",
    scope: "server",
    trigger: "Operator rejects on /admin/ads.",
    question: "What are we turning away, and is the word filter too tight?",
    params: ["reason", "listing_category", "channel"],
  },
  {
    name: "listing_broadcast",
    scope: "server",
    trigger: "lib/digest-engine.ts — the ad text actually leaves for subscribers.",
    question:
      "Reach per ad, and the cost of it. Pair recipients with segments to see what an ad costs to deliver.",
    params: ["recipients", "segments", "is_mms", "listing_category"],
  },
  {
    name: "listing_sold",
    scope: "server",
    trigger: 'SOLD command, or "Mark sold" in My ads.',
    question:
      "Does the service work? Sell-through and days-to-sell are the only honest answer, and they are the best thing we could ever put on a marketing page.",
    params: ["listing_category", "days_to_sell", "channel"],
    keyEvent: true,
  },
  {
    name: "listing_expired",
    scope: "server",
    trigger: "Website listing reaches expiryDays without selling.",
    question: "What share of ads run their course unsold, by category?",
    params: ["listing_category", "days_listed"],
  },

  // ── Membership ──────────────────────────────────────────────────────────
  {
    name: "sign_up",
    scope: "both",
    trigger: "SUBSCRIBE by text, the email signup form, or account creation on the web.",
    question:
      "Where do members come from? Today this is genuinely unknown — the answer decides where the next flyer goes.",
    params: ["method", "channel"],
    keyEvent: true,
  },
  {
    name: "login",
    scope: "web",
    trigger: "lib/auth-actions.ts submitCode() / submitPassword().",
    question: "Do members come back to the website, or is it a one-visit tool?",
    params: ["method"],
  },
  {
    name: "unsubscribe",
    scope: "both",
    trigger: "STOP by text, or the web/email unsubscribe.",
    question:
      "The churn number. Watch it against listing_broadcast volume — if STOPs climb with send frequency, the frequency is wrong.",
    params: ["channel", "reason"],
  },
  {
    name: "categories_changed",
    scope: "both",
    trigger: "Category toggles by text, or the /account checkboxes.",
    question: "Do people narrow what they receive rather than leaving entirely?",
    params: ["channel", "category_count"],
  },

  // ── Money ───────────────────────────────────────────────────────────────
  {
    name: "begin_checkout",
    scope: "web",
    trigger: "lib/account-actions.ts startStripeCheckout().",
    question: "How many top-ups are started versus finished?",
    params: ["value", "currency", "items"],
  },
  {
    name: "purchase",
    scope: "server",
    trigger:
      "app/api/stripe/webhook/route.ts — the paid event, never the redirect. A success page can be reloaded, shared, or reached without paying.",
    question: "Revenue, by product and by member.",
    params: ["transaction_id", "value", "currency", "items", "payment_channel"],
    keyEvent: true,
  },
  {
    name: "refund",
    scope: "server",
    trigger: "Refund written to the ledger.",
    question: "What is refund pressure by reason, and is a category driving it?",
    params: ["transaction_id", "value", "currency", "reason"],
  },
  {
    name: "auto_topup",
    scope: "server",
    trigger: "Auto top-up covers a posting shortfall from a saved card.",
    question: "Does auto top-up remove the money friction, or just hide it?",
    params: ["value", "currency", "outcome"],
  },
  {
    name: "generate_lead",
    scope: "web",
    trigger: "lib/business-actions.ts startBusinessCheckout() — a business starts buying sponsorship.",
    question: "Is business advertising a real line of revenue or a page nobody uses?",
    params: ["value", "currency", "weeks", "package_name"],
    keyEvent: true,
  },
  {
    name: "starter_credit_granted",
    scope: "server",
    trigger: "First-post starter credit granted.",
    question:
      "How fast is the launch offer being consumed, and do the members who take it post a second time?",
    params: ["value", "currency"],
  },

  // ── The channels most of this audience actually uses ─────────────────────
  {
    name: "sms_inbound",
    scope: "server",
    trigger: "app/api/telnyx/inbound/route.ts, after the command is parsed.",
    question:
      "What do people text us, and what do they get wrong? Every `unknown` command is a wording problem we can fix.",
    params: ["command", "is_member", "is_known_number"],
  },
  {
    name: "sms_reply_suppressed",
    scope: "server",
    trigger: "An outbound reply refused by a rate cap, a pause switch, or attack mode.",
    question: "Are the abuse guards biting real members?",
    params: ["reason", "message_class"],
  },
  {
    name: "pic_pull",
    scope: "server",
    trigger: "PIC command served or refused.",
    question:
      "Picture demand versus the MMS bill. Pair `granted` with the per-MMS cost to see what pictures actually cost per month.",
    params: ["outcome", "pulls_left"],
  },
  {
    name: "email_edition_sent",
    scope: "server",
    trigger: "lib/email-digest.ts, per edition.",
    question: "Is the email edition worth keeping, per edition slot?",
    params: ["recipients", "listing_count", "slot_hour"],
  },
  {
    name: "call_inbound",
    scope: "server",
    trigger: "app/api/voice/route.ts.",
    question:
      "How many people call rather than text? This audience picks up the phone, and today the only record is the call log.",
    params: ["outcome", "duration_seconds", "menu_choice"],
  },
  {
    name: "card_saved",
    scope: "server",
    trigger: "The call-in card line attaches a card.",
    question: "Is the phone card line paying for itself?",
    params: ["channel"],
    keyEvent: true,
  },

  // ── Housekeeping ────────────────────────────────────────────────────────
  {
    name: "contact_submit",
    scope: "web",
    trigger: "lib/contact-actions.ts submitFeedback().",
    question: "Questions versus ideas — which is the site failing to answer on its own?",
    params: ["contact_type"],
  },
  {
    name: "town_hall_submit",
    scope: "web",
    trigger: "lib/town-hall-actions.ts submitTownHallEvent().",
    question: "Does the free events board pull people in?",
    params: [],
  },
  {
    name: "ui_click",
    scope: "web",
    trigger:
      "Any internal link or button, via the one delegated listener in analytics/src/clicks.ts.",
    question:
      "What do people actually click? One event with the text, destination and page section, rather than forty bespoke events nobody remembers to add. Listing clicks are excluded — they go to select_item, which handles high cardinality properly. External links are excluded too: GA4's Enhanced Measurement already reports those, and measuring one thing twice leaves two numbers that disagree.",
    params: ["click_text", "click_href", "click_section"],
  },
] as const;

/**
 * Why an event name is illegal, or null if it is fine. Kept as prose rather
 * than a boolean so a failing test says what to do about it.
 */
export function eventNameProblem(name: string): string | null {
  if (!name) return "empty";
  if (name.length > 40) return `longer than 40 characters (${name.length})`;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return "must start with a letter and contain only letters, digits and underscores";
  }
  if (RESERVED_EVENT_NAMES.has(name)) return "is a GA4 reserved event name — it would be discarded silently";
  for (const p of RESERVED_PREFIXES) {
    if (name.startsWith(p)) return `starts with the reserved prefix "${p}"`;
  }
  return null;
}

/** Same, for a parameter name. */
export function paramNameProblem(name: string): string | null {
  if (!name) return "empty";
  if (name.length > 40) return `longer than 40 characters (${name.length})`;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return "must start with a letter and contain only letters, digits and underscores";
  }
  for (const p of RESERVED_PREFIXES) {
    if (name.startsWith(p)) return `starts with the reserved prefix "${p}"`;
  }
  return null;
}

/**
 * Clamp a parameter bag to what GA4 will actually keep.
 *
 * GA does not reject an over-long value or a 26th parameter — it drops them
 * and returns success. Clamping here means the data is at worst truncated,
 * never mysteriously absent, and `dropped` tells us it happened.
 */
export function sanitizeParams(params: GaParams): {
  params: Record<string, GaParamValue | GaItem[]>;
  dropped: string[];
} {
  const out: Record<string, GaParamValue | GaItem[]> = {};
  const dropped: string[] = [];
  let kept = 0;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (paramNameProblem(key)) {
      dropped.push(key);
      continue;
    }
    if (kept >= 25) {
      dropped.push(key);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > 100 ? value.slice(0, 100) : value;
    } else {
      out[key] = value;
    }
    kept++;
  }
  return { params: out, dropped };
}

/** Look up a spec by name — used by the wiring helpers and the tests. */
export function findEvent(name: string): EventSpec | undefined {
  return EVENT_CATALOGUE.find((e) => e.name === name);
}

/** The events proposed as GA4 key events (conversions). */
export function keyEvents(): readonly string[] {
  return EVENT_CATALOGUE.filter((e) => e.keyEvent).map((e) => e.name);
}
