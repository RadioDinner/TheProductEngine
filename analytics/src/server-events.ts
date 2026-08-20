/**
 * The server-side event helpers — one named function per business moment, so
 * wiring an event into the app is a single obvious line and not a lesson in
 * the Measurement Protocol.
 *
 * SERVER ONLY. STAGED, NOT WIRED.
 *
 * Every helper here is fire-and-forget. Call them with `void`:
 *
 *     void analytics.postSubmitted({ phone, channel: "sms", category, photoCount, priceCents });
 *
 * Do not await them in a request path. A text message arriving at 6am must not
 * wait on Google, and if Google is down the member must never know.
 */
import { ANALYTICS_SALT } from "./config";
import type { GaItem, GaParams } from "./events";
import { clientIdForPhone, hashedMemberId, syntheticSessionId } from "./ids";
import { sendServerEvents, type ServerEvent } from "./measurement-protocol";

/** ET calendar day, the same day boundary the rest of the app counts on. */
export function etDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface Who {
  /** The member's phone, in any format. Hashed before it leaves this process. */
  phone?: string;
  /**
   * The browser's `_ga` client id, when the event came out of a web request.
   * Pass it whenever you have it: it is what keeps a webhook-confirmed
   * purchase attached to the visit that earned it instead of arriving from
   * "(direct)" with no campaign, no referrer and no story.
   */
  clientId?: string;
}

/** Resolve who this event belongs to, hashing on the way. */
function identity(who: Who): { clientId: string; userId?: string; sessionId?: number } {
  const userId = who.phone ? hashedMemberId(who.phone, ANALYTICS_SALT) : "";
  const clientId = who.clientId || (who.phone ? clientIdForPhone(who.phone, ANALYTICS_SALT) : "");
  const sessionId = userId ? syntheticSessionId(userId, etDayKey()) : undefined;
  return { clientId, userId: userId || undefined, sessionId };
}

/** The one call every helper below funnels through. Never throws. */
export async function emit(
  who: Who,
  events: ServerEvent[],
  userProperties?: Record<string, string | number>,
): Promise<void> {
  const id = identity(who);
  if (!id.clientId) return; // nothing to attribute this to — see ids.ts
  try {
    await sendServerEvents({
      clientId: id.clientId,
      userId: id.userId,
      sessionId: id.sessionId,
      events,
      userProperties,
    });
  } catch (e) {
    // sendServerEvents already swallows its own failures; this is the belt.
    console.error("[analytics] emit failed:", e);
  }
}

const dollars = (cents: number): number => Math.round(cents) / 100;

// ── Supply ────────────────────────────────────────────────────────────────

export function postSubmitted(args: {
  phone?: string;
  clientId?: string;
  channel: "sms" | "web" | "email";
  category?: string;
  photoCount: number;
  priceCents: number;
}): Promise<void> {
  return emit(args, [
    {
      name: "post_submit",
      params: {
        channel: args.channel,
        listing_category: args.category ?? "uncategorized",
        photo_count: args.photoCount,
        has_photo: args.photoCount > 0,
        value: dollars(args.priceCents),
        currency: "USD",
      },
    },
  ]);
}

export function postBlocked(args: {
  phone?: string;
  clientId?: string;
  channel: "sms" | "web";
  /** A short code, never the member's words: "word_filter", "no_balance",
   *  "blocked_number", "too_long". Free text here would leak ad bodies. */
  reason: string;
}): Promise<void> {
  return emit(args, [
    { name: "post_blocked", params: { channel: args.channel, reason: args.reason } },
  ]);
}

export function listingApproved(args: {
  phone?: string;
  category?: string;
  channel: "sms" | "web";
  waitMinutes: number;
  photoCount: number;
}): Promise<void> {
  return emit(args, [
    {
      name: "listing_approved",
      params: {
        listing_category: args.category ?? "uncategorized",
        channel: args.channel,
        wait_minutes: args.waitMinutes,
        photo_count: args.photoCount,
      },
    },
  ]);
}

export function listingRejected(args: {
  phone?: string;
  category?: string;
  channel: "sms" | "web";
  reason: string;
}): Promise<void> {
  return emit(args, [
    {
      name: "listing_rejected",
      params: {
        listing_category: args.category ?? "uncategorized",
        channel: args.channel,
        reason: args.reason,
      },
    },
  ]);
}

export function listingBroadcast(args: {
  phone?: string;
  category?: string;
  recipients: number;
  segments: number;
  isMms: boolean;
}): Promise<void> {
  return emit(args, [
    {
      name: "listing_broadcast",
      params: {
        listing_category: args.category ?? "uncategorized",
        recipients: args.recipients,
        segments: args.segments,
        is_mms: args.isMms,
      },
    },
  ]);
}

export function listingSold(args: {
  phone?: string;
  category?: string;
  channel: "sms" | "web";
  daysToSell: number;
}): Promise<void> {
  return emit(args, [
    {
      name: "listing_sold",
      params: {
        listing_category: args.category ?? "uncategorized",
        channel: args.channel,
        days_to_sell: args.daysToSell,
      },
    },
  ]);
}

// ── Membership ────────────────────────────────────────────────────────────

export function signedUp(args: {
  phone?: string;
  clientId?: string;
  method: "sms" | "web" | "email" | "voice";
}): Promise<void> {
  return emit(
    args,
    [{ name: "sign_up", params: { method: args.method, channel: args.method } }],
    { signup_channel: args.method },
  );
}

export function unsubscribed(args: {
  phone?: string;
  clientId?: string;
  channel: "sms" | "web" | "email";
  reason?: string;
}): Promise<void> {
  return emit(args, [
    {
      name: "unsubscribe",
      params: { channel: args.channel, reason: args.reason ?? "member_request" },
    },
  ]);
}

// ── Money ─────────────────────────────────────────────────────────────────

/**
 * A completed payment. Call this from the Stripe webhook and nowhere else —
 * the checkout success page can be reloaded, bookmarked, shared, or reached
 * without paying, and every one of those would book revenue that did not
 * happen. `transactionId` must be the Stripe id so GA de-duplicates a retried
 * webhook instead of counting the money twice.
 */
export function purchaseCompleted(args: {
  phone?: string;
  clientId?: string;
  transactionId: string;
  amountCents: number;
  /** "credit_topup" | "sponsorship_1w" | "featured_slot" … */
  productId: string;
  productCategory: string;
  paymentChannel: "web" | "phone" | "auto_topup" | "admin";
}): Promise<void> {
  const items: GaItem[] = [
    {
      item_id: args.productId,
      item_category: args.productCategory,
      price: dollars(args.amountCents),
      quantity: 1,
    },
  ];
  return emit(args, [
    {
      name: "purchase",
      params: {
        transaction_id: args.transactionId,
        value: dollars(args.amountCents),
        currency: "USD",
        payment_channel: args.paymentChannel,
        items,
      },
    },
  ]);
}

export function refunded(args: {
  phone?: string;
  transactionId: string;
  amountCents: number;
  reason: string;
}): Promise<void> {
  return emit(args, [
    {
      name: "refund",
      params: {
        transaction_id: args.transactionId,
        value: dollars(args.amountCents),
        currency: "USD",
        reason: args.reason,
      },
    },
  ]);
}

export function autoTopUp(args: {
  phone?: string;
  amountCents: number;
  outcome: "charged" | "declined" | "no_card";
}): Promise<void> {
  return emit(args, [
    {
      name: "auto_topup",
      params: { value: dollars(args.amountCents), currency: "USD", outcome: args.outcome },
    },
  ]);
}

export function starterCreditGranted(args: {
  phone?: string;
  amountCents: number;
}): Promise<void> {
  return emit(args, [
    {
      name: "starter_credit_granted",
      params: { value: dollars(args.amountCents), currency: "USD" },
    },
  ]);
}

// ── The off-web channels ──────────────────────────────────────────────────

/**
 * Every inbound text, tagged with the parsed command. The `unknown` bucket is
 * the point: each one is somebody who tried to use the service and was not
 * understood, and it is the cheapest product research this business has.
 */
export function smsInbound(args: {
  phone?: string;
  /** parseCommand(...).kind — "ad", "pic", "subscribe", "unknown", … */
  command: string;
  isMember: boolean;
}): Promise<void> {
  return emit(args, [
    { name: "sms_inbound", params: { command: args.command, is_member: args.isMember } },
  ]);
}

export function picPull(args: {
  phone?: string;
  outcome: "granted" | "out_of_pulls" | "throttled" | "not_found";
  pullsLeft: number;
}): Promise<void> {
  return emit(args, [
    { name: "pic_pull", params: { outcome: args.outcome, pulls_left: args.pullsLeft } },
  ]);
}

export function smsReplySuppressed(args: {
  phone?: string;
  reason: "rate_limit" | "outbound_paused" | "under_attack" | "budget";
  messageClass: string;
}): Promise<void> {
  return emit(args, [
    {
      name: "sms_reply_suppressed",
      params: { reason: args.reason, message_class: args.messageClass },
    },
  ]);
}

export function callInbound(args: {
  phone?: string;
  outcome: "answered" | "attendant" | "voicemail" | "abandoned";
  durationSeconds: number;
  menuChoice?: string;
}): Promise<void> {
  return emit(args, [
    {
      name: "call_inbound",
      params: {
        outcome: args.outcome,
        duration_seconds: args.durationSeconds,
        menu_choice: args.menuChoice ?? "none",
      },
    },
  ]);
}

export function cardSaved(args: { phone?: string; channel: "voice" | "web" }): Promise<void> {
  return emit(args, [{ name: "card_saved", params: { channel: args.channel } }]);
}

/**
 * One email edition went out. Sent under the OPERATOR's identity rather than a
 * member's: it is one service-level event, not one per recipient. Sending it
 * per recipient would be 400 events for one send and would drown every other
 * number in the property.
 */
export function emailEditionSent(args: {
  operatorPhone: string;
  recipients: number;
  listingCount: number;
  slotHour: number;
}): Promise<void> {
  return emit({ phone: args.operatorPhone }, [
    {
      name: "email_edition_sent",
      params: {
        recipients: args.recipients,
        listing_count: args.listingCount,
        slot_hour: args.slotHour,
      },
    },
  ]);
}

/** Escape hatch for anything the named helpers do not cover yet. */
export function custom(who: Who, name: string, params: GaParams = {}): Promise<void> {
  return emit(who, [{ name, params }]);
}
