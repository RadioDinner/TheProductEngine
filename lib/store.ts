/**
 * Account + verification-code + credits store.
 *
 * The exported async functions are the interface the app depends on. Two
 * implementations sit behind them: a JSON-file store for development (below)
 * and Supabase (lib/store-supabase.ts), chosen by env configuration.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  randomInt,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { supabaseConfigured } from "@/lib/db";
import * as remote from "@/lib/store-supabase";
import { CHAT_PHOTO_CAP, nudgeWindowOpen } from "@/lib/chat";
import { accruePicQuota } from "@/lib/pic-quota";
import { decideReveal } from "@/lib/reveal-quota";
import { unreadChatCount } from "@/lib/unread";
import { normalizePhone } from "@/lib/phone";
import { USER_ID_MAX_ATTEMPTS, isRetirementActive, randomUserId } from "@/lib/user-id";
import { decideCategoryConfirm, type ConfirmAction } from "@/lib/categories";

// ---------- shared types & rules ----------

export interface Account {
  phone: string; // 10 digits
  /** Public 6-digit member id (FEATURES item 0, migration 9986). Populated
   * lazily via ensureUserId — most account reads leave it undefined so the
   * core lookup path never depends on the migration. */
  userId?: string | null;
  passwordHash?: string; // "salt:hash" hex
  createdAt: string; // ISO
  email?: string;
  subscribedAt?: string | null;
  /** Email-edition opt-in for phone members with a saved email. */
  emailSubscribedAt?: string | null;
  /** Stripe customer id, set after the first completed checkout. */
  stripeCustomerId?: string | null;
  /** Starter-grant ad passes: consumed before credits, either ad type. */
  freeAds: number;
  /**
   * When the one-time starter free-ad grant was applied — set on the seller's
   * FIRST `AD NEW`, not on account creation. Null = not yet granted (a number
   * that only ever subscribes/checks balance never mints free-ad passes). Once
   * set, the grant never re-fires (even after the passes are used up).
   */
  starterGrantedAt?: string | null;
  offenseCount?: number;
  postingBannedAt?: string | null;
  /** PIC daily-quota bank — pulls available right now (lib/pic-quota.ts). */
  picBalance?: number;
  /** ET day (YYYY-MM-DD) the PIC bank was last accrued to; null/undefined = never. */
  picAccrualDay?: string | null;
  /** Number look-up bank (item 23) — reveals available now (lib/reveal-quota.ts). */
  revealBalance?: number;
  /** ET day (YYYY-MM-DD) the reveal bank was last accrued to; null/undefined = never. */
  revealAccrualDay?: string | null;
  /** Profile picture URL (FEATURES item 3) — file store only; Supabase reads
   * it via getProfile so core lookups never depend on migration 9983. */
  profilePhoto?: string | null;
  /** PRIVATE pickup address (FEATURES item 3) — same storage note as above. */
  pickupAddress?: string | null;
  /** When the operator verified this member (FEATURES item 7) — file store
   * only; Supabase reads it via getVerifiedAt (migration 9981). */
  verifiedAt?: string | null;
  /** Last you-have-a-chat-message SMS (item 15, migration 9980) — the nudge
   * dedup watermark that replaced the audit-log body scan. */
  chatNudgedAt?: string | null;
  /** Category prefs (items 22/24, migration 9976): null/undefined = ALL
   * (default/grandfathered), [] = none (warned, allowed), else lowercase keys. */
  categories?: string[] | null;
  /** Category-confirmation throttle window anchor (item 24) — watermark, not
   * a log scan. */
  categoryConfirmWindowStart?: string | null;
  /** Confirmations counted inside the open throttle window. */
  categoryConfirmCount?: number;
}

/** A subscriber with their category prefs — the digest composer's read. */
export interface SubscriberCategories {
  phone: string;
  categories: string[] | null;
}

/** An email-edition recipient with their category prefs (null = ALL; email-
 * only signups have no prefs and read as ALL). */
export interface EmailRecipientCategories {
  email: string;
  categories: string[] | null;
}

/** Result of an atomic PIC-quota reservation. remaining = -1 when the quota is off. */
export interface PicQuotaResult {
  allowed: boolean;
  remaining: number;
}

/** One reveal-log row (item 23) — for the /admin/insights excessive-reveal flags. */
export interface RevealSince {
  phone: string;
  adId: number;
  at: string; // ISO
}

/**
 * Short-lived SMS conversation state (FEATURES item 2): after SOLD, the open
 * question to a phone — first the buyer's number, then the RATE 1–5 answer.
 * One context per phone; expired contexts read as absent.
 */
export interface SmsContext {
  kind: "buyer_phone" | "rate";
  adId: number;
  /** The other party (the person being rated when kind = "rate"). */
  otherPhone?: string;
  /** Role of the RATED party for a "rate" context. */
  ratedRole?: "buyer" | "seller";
  expiresAt: string; // ISO
}

/** Star ratings received, split by the role the person played. */
export interface RatingSummary {
  asSeller: { count: number; average: number | null };
  asBuyer: { count: number; average: number | null };
}

/** Profile bits (FEATURES item 3): the picture is public; the pickup address
 * is PRIVATE and only ever leaves via an explicit share into a chat. */
export interface Profile {
  profilePhoto: string | null;
  pickupAddress: string | null;
}

/** One chat thread as one member sees it (FEATURES item 4). */
export interface ChatSummary {
  id: number;
  adId: number | null;
  /** The other party's public member id (never their phone). */
  otherMemberId: string | null;
  otherPhoto: string | null;
  /** The other party carries the operator-granted green check (item 7). */
  otherVerified: boolean;
  lastMessageAt: string;
  unread: boolean;
}

export interface ChatMessageView {
  id: number;
  mine: boolean;
  body: string;
  /** Web-uploaded picture URL (item 14, migration 9980) — website only. */
  photo?: string | null;
  /** True once a member reported this message (item 13, migration 9980). */
  reported?: boolean;
  at: string;
}

/** Everything the thread page needs, fetched (and marked read) in one call. */
export interface ChatThreadView {
  summary: ChatSummary;
  messages: ChatMessageView[];
}

/** Result of sending into a thread (item 15 shape). */
export type SendChatResult =
  | {
      outcome: "sent";
      /** The stored message, for optimistic/confirmed append in the UI. */
      message: ChatMessageView;
      /** So the caller can nudge them by SMS — never shown in the chat UI. */
      otherPhone: string;
      /** When the other party last got the nudge SMS; null = never;
       * undefined = unknown (pre-9980 — caller falls back to the log scan). */
      otherNudgedAt?: string | null;
      /** True when the audit copy already happened inside the send_chat RPC. */
      audited: boolean;
      /** Which implementation ran — for the send-timing logs. */
      path: "rpc" | "fallback" | "file";
    }
  | { outcome: "denied" | "unsupported" | "photocap" };

/** One open member report, for the operator queue (item 13, migration 9980). */
export interface ReportedChatMessage {
  messageId: number;
  chatId: number;
  adId: number | null;
  body: string;
  photo: string | null;
  /** When the message was sent. */
  at: string;
  reportedAt: string;
  senderPhone: string;
  senderMemberId: string | null;
  reporterPhone: string;
}

/** Email-only subscriber (no phone account) — spec Q11. */
export interface EmailSubscriber {
  email: string;
  subscribedAt: string;
}

/** Admin Subscribers view rows — who is subscribed and since when. */
export interface SmsSubscriberEntry {
  phone: string;
  subscribedAt: string;
}
export interface EmailSubscriberEntry {
  email: string;
  subscribedAt: string | null;
}

/** Result of an admin account merge (see mergeAccounts). */
export type MergeOutcome =
  | { ok: true; kind: "phone"; loserPhone: string; adsMoved: number; creditEntriesMoved: number }
  | { ok: true; kind: "email"; email: string }
  | { ok: false; reason: string };

export const OFFENSE_BAN_THRESHOLD = 3;

export type LedgerKind = "grant" | "purchase" | "spend" | "refund" | "adjustment";

/** Credits are an append-only ledger; the balance is the sum of deltas. */
export interface LedgerEntry {
  at: string; // ISO
  delta: number;
  kind: LedgerKind;
  note: string;
  /** External reference (Stripe payment intent) — the webhook's idempotency key. */
  ref?: string;
}

export type CreateCodeResult = { ok: true; devEcho?: string } | { ok: false; error: "rate" };
export type VerifyCodeResult = "ok" | "wrong" | "expired" | "attempts" | "none";

/** A ledger entry with its owner's phone — for the admin spend/revenue insights. */
export interface LedgerSince {
  phone: string;
  delta: number;
  kind: LedgerKind;
  at: string;
}

export const STARTER_FREE_ADS = 3;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const RATE_MAX_CODES = 3;

// ---------- password hashing (shared by both implementations) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- file implementation (development) ----------

interface CodeRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  devEcho?: string;
}

interface StoreShape {
  accounts: Record<string, Account>;
  codes: Record<string, CodeRecord>;
  codeRequests: Record<string, number[]>;
  ledgers: Record<string, LedgerEntry[]>;
  emailSubscribers?: Record<string, EmailSubscriber>;
  /** Merged-away member ids → when they retired (not reusable for a year). */
  retiredUserIds?: Record<string, string>;
  /** Open conversational prompts, one per phone (FEATURES item 2). */
  smsContexts?: Record<string, SmsContext>;
  /** Confirmed sales by ad id: who sold to whom (FEATURES item 2). */
  sales?: Record<string, { sellerPhone: string; buyerPhone: string; at: string }>;
  /** Star ratings, one per (ad, rater) (FEATURES item 2). */
  ratings?: {
    adId: number;
    raterPhone: string;
    ratedPhone: string;
    ratedRole: "buyer" | "seller";
    stars: number;
    at: string;
  }[];
  /** Chat threads + messages + per-member read watermarks (FEATURES item 4). */
  chats?: {
    id: number;
    adId: number | null;
    aPhone: string;
    bPhone: string;
    createdAt: string;
    lastMessageAt: string;
  }[];
  chatMessages?: {
    id: number;
    chatId: number;
    fromPhone: string;
    body: string;
    at: string;
    /** Web-uploaded picture URL (item 14) — website only, never rides SMS. */
    photo?: string | null;
    /** Report-a-message state (item 13). */
    reportedAt?: string;
    reportedBy?: string;
    reportResolvedAt?: string;
    reportResolution?: "resolved" | "dismissed";
  }[];
  chatReads?: Record<string, number>; // `${chatId}#${phone}` -> last read message id
  nextChatId?: number;
  /** Number look-up log (item 23): one row per (member phone, ad) — first
   * reveal's timestamp; repeats are free and keep the original row. */
  reveals?: { phone: string; adId: number; at: string }[];
}

const STORE_PATH = join(process.cwd(), ".data", "store.json");

function load(): StoreShape {
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as StoreShape;
    parsed.ledgers ??= {};
    return parsed;
  } catch {
    return { accounts: {}, codes: {}, codeRequests: {}, ledgers: {} };
  }
}

function save(store: StoreShape): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

const file = {
  getAccount(phone: string): Account | null {
    const account = load().accounts[phone];
    if (!account) return null;
    account.freeAds ??= 0;
    return account;
  },

  ensureAccount(phone: string): Account {
    const store = load();
    let account = store.accounts[phone];
    if (!account) {
      // No starter grant here — a bare first contact mints an account but ZERO
      // free-ad passes. The grant is applied lazily on the first AD NEW
      // (grantStarterAdsIfFirst), so numbers that never post cost nothing.
      account = {
        phone,
        createdAt: new Date().toISOString(),
        freeAds: 0,
        starterGrantedAt: null,
      };
      store.accounts[phone] = account;
      save(store);
    }
    account.freeAds ??= 0;
    return account;
  },

  ensureUserId(phone: string): string | null {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return null;
    if (account.userId) return account.userId;
    const taken = new Set(
      Object.values(store.accounts)
        .map((a) => a.userId)
        .filter(Boolean),
    );
    const retired = (store.retiredUserIds ??= {});
    const now = Date.now();
    // Tombstones past their year are reaped — those ids are free again.
    for (const [id, at] of Object.entries(retired)) {
      if (!isRetirementActive(at, now)) delete retired[id];
    }
    for (let i = 0; i < USER_ID_MAX_ATTEMPTS; i++) {
      const candidate = randomUserId();
      if (taken.has(candidate) || retired[candidate]) continue;
      account.userId = candidate;
      save(store);
      return candidate;
    }
    console.error("[user-id] could not draw a unique member id");
    return null;
  },

  getAccountByUserId(userId: string): Account | null {
    return Object.values(load().accounts).find((a) => a.userId === userId) ?? null;
  },

  setSmsContext(phone: string, context: SmsContext): "set" {
    const store = load();
    (store.smsContexts ??= {})[phone] = context;
    save(store);
    return "set";
  },

  getSmsContext(phone: string): SmsContext | null {
    const store = load();
    const context = store.smsContexts?.[phone];
    if (!context) return null;
    if (Date.parse(context.expiresAt) <= Date.now()) {
      delete store.smsContexts![phone];
      save(store);
      return null;
    }
    return context;
  },

  clearSmsContext(phone: string): void {
    const store = load();
    if (store.smsContexts?.[phone]) {
      delete store.smsContexts[phone];
      save(store);
    }
  },

  recordSale(adId: number, sellerPhone: string, buyerPhone: string): "recorded" {
    const store = load();
    // Last answer wins: the seller can correct a mistyped buyer number.
    (store.sales ??= {})[String(adId)] = {
      sellerPhone,
      buyerPhone,
      at: new Date().toISOString(),
    };
    save(store);
    return "recorded";
  },

  addRating(
    adId: number,
    raterPhone: string,
    ratedPhone: string,
    ratedRole: "buyer" | "seller",
    stars: number,
  ): "added" | "duplicate" | "notconfirmed" {
    const store = load();
    const sale = store.sales?.[String(adId)];
    // Confirmed parties only, in the right direction.
    const confirmed =
      sale &&
      ((ratedRole === "buyer" && sale.sellerPhone === raterPhone && sale.buyerPhone === ratedPhone) ||
        (ratedRole === "seller" && sale.buyerPhone === raterPhone && sale.sellerPhone === ratedPhone));
    if (!confirmed) return "notconfirmed";
    const ratings = (store.ratings ??= []);
    if (ratings.some((r) => r.adId === adId && r.raterPhone === raterPhone)) return "duplicate";
    ratings.push({ adId, raterPhone, ratedPhone, ratedRole, stars, at: new Date().toISOString() });
    save(store);
    return "added";
  },

  getRatingSummary(phone: string): RatingSummary {
    const ratings = (load().ratings ?? []).filter((r) => r.ratedPhone === phone);
    const roll = (role: "buyer" | "seller") => {
      const stars = ratings.filter((r) => r.ratedRole === role).map((r) => r.stars);
      return {
        count: stars.length,
        average: stars.length
          ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10
          : null,
      };
    };
    return { asSeller: roll("seller"), asBuyer: roll("buyer") };
  },

  getProfile(phone: string): Profile | null {
    const account = load().accounts[phone];
    if (!account) return null;
    return {
      profilePhoto: account.profilePhoto ?? null,
      pickupAddress: account.pickupAddress ?? null,
    };
  },

  setProfile(phone: string, update: Partial<Profile>): "saved" | "unsupported" {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return "unsupported";
    if (update.profilePhoto !== undefined) account.profilePhoto = update.profilePhoto;
    if (update.pickupAddress !== undefined) account.pickupAddress = update.pickupAddress;
    save(store);
    return "saved";
  },

  ensureChat(adId: number | null, phoneA: string, phoneB: string): number | null {
    const store = load();
    const chats = (store.chats ??= []);
    const pair = [phoneA, phoneB].sort();
    const existing = chats.find(
      (c) => c.aPhone === pair[0] && c.bPhone === pair[1] && (c.adId ?? null) === (adId ?? null),
    );
    if (existing) return existing.id;
    const id = (store.nextChatId ??= 1);
    store.nextChatId = id + 1;
    const now = new Date().toISOString();
    chats.push({ id, adId: adId ?? null, aPhone: pair[0], bPhone: pair[1], createdAt: now, lastMessageAt: now });
    save(store);
    return id;
  },

  chatMember(chatId: number, phone: string): { otherPhone: string } | null {
    const chat = (load().chats ?? []).find((c) => c.id === chatId);
    if (!chat) return null;
    if (chat.aPhone === phone) return { otherPhone: chat.bPhone };
    if (chat.bPhone === phone) return { otherPhone: chat.aPhone };
    return null;
  },

  listChatsFor(phone: string): ChatSummary[] {
    const store = load();
    const mine = (store.chats ?? []).filter((c) => c.aPhone === phone || c.bPhone === phone);
    return mine
      .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
      .map((c) => {
        const otherPhone = c.aPhone === phone ? c.bPhone : c.aPhone;
        const other = store.accounts[otherPhone];
        const lastRead = store.chatReads?.[`${c.id}#${phone}`] ?? 0;
        const unread = (store.chatMessages ?? []).some(
          (m) => m.chatId === c.id && m.fromPhone !== phone && m.id > lastRead,
        );
        return {
          id: c.id,
          adId: c.adId,
          otherMemberId: other?.userId ?? null,
          otherPhoto: other?.profilePhoto ?? null,
          otherVerified: Boolean(other?.verifiedAt),
          lastMessageAt: c.lastMessageAt,
          unread,
        };
      });
  },

  countUnreadChats(phone: string): number {
    const store = load();
    const lastReadByChat = new Map<number, number>(
      (store.chats ?? [])
        .filter((c) => c.aPhone === phone || c.bPhone === phone)
        .map((c) => [c.id, store.chatReads?.[`${c.id}#${phone}`] ?? 0]),
    );
    return unreadChatCount(
      (store.chatMessages ?? []).map((m) => ({
        chatId: m.chatId,
        id: m.id,
        fromOther: m.fromPhone !== phone,
      })),
      lastReadByChat,
    );
  },

  getVerifiedAt(phone: string): string | null {
    return load().accounts[phone]?.verifiedAt ?? null;
  },

  setVerified(phone: string, on: boolean): "saved" | "unsupported" {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return "unsupported";
    account.verifiedAt = on ? new Date().toISOString() : null;
    save(store);
    return "saved";
  },

  listChatMessages(chatId: number, phone: string): ChatMessageView[] | null {
    const store = load();
    if (!file.chatMember(chatId, phone)) return null; // membership is the gate
    return (store.chatMessages ?? [])
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.id - b.id)
      .map((m) => ({
        id: m.id,
        mine: m.fromPhone === phone,
        body: m.body,
        photo: m.photo ?? null,
        reported: Boolean(m.reportedAt),
        at: m.at,
      }));
  },

  flagChatMessage(
    chatId: number,
    messageId: number,
    byPhone: string,
  ): "reported" | "denied" | "unsupported" {
    const store = load();
    if (!file.chatMember(chatId, byPhone)) return "denied";
    const message = (store.chatMessages ?? []).find(
      (m) => m.id === messageId && m.chatId === chatId,
    );
    // You can only report the other party's messages, not your own.
    if (!message || message.fromPhone === byPhone) return "denied";
    message.reportedAt = new Date().toISOString();
    message.reportedBy = byPhone;
    // A re-report reopens a previously resolved one.
    delete message.reportResolvedAt;
    delete message.reportResolution;
    save(store);
    return "reported";
  },

  listChatReports(): ReportedChatMessage[] {
    const store = load();
    return (store.chatMessages ?? [])
      .filter((m) => m.reportedAt && !m.reportResolvedAt)
      .sort((a, b) => Date.parse(b.reportedAt!) - Date.parse(a.reportedAt!))
      .map((m) => {
        const chat = (store.chats ?? []).find((c) => c.id === m.chatId);
        return {
          messageId: m.id,
          chatId: m.chatId,
          adId: chat?.adId ?? null,
          body: m.body,
          photo: m.photo ?? null,
          at: m.at,
          reportedAt: m.reportedAt!,
          senderPhone: m.fromPhone,
          senderMemberId: store.accounts[m.fromPhone]?.userId ?? null,
          reporterPhone: m.reportedBy ?? "",
        };
      });
  },

  resolveChatReport(
    messageId: number,
    resolution: "resolved" | "dismissed",
  ): "resolved" | "unsupported" {
    const store = load();
    const message = (store.chatMessages ?? []).find((m) => m.id === messageId);
    if (!message?.reportedAt) return "resolved"; // nothing open — idempotent
    message.reportResolvedAt = new Date().toISOString();
    message.reportResolution = resolution;
    save(store);
    return "resolved";
  },

  sendChatMessage(
    chatId: number,
    fromPhone: string,
    body: string,
    photo?: string | null,
  ): SendChatResult {
    const store = load();
    const chat = (store.chats ?? []).find((c) => c.id === chatId);
    if (!chat || (chat.aPhone !== fromPhone && chat.bPhone !== fromPhone)) {
      return { outcome: "denied" };
    }
    const messages = (store.chatMessages ??= []);
    // Per-thread picture cap (item 14).
    if (photo && messages.filter((m) => m.chatId === chatId && m.photo).length >= CHAT_PHOTO_CAP) {
      return { outcome: "photocap" };
    }
    const id = (messages[messages.length - 1]?.id ?? 0) + 1;
    const at = new Date().toISOString();
    messages.push({ id, chatId, fromPhone, body, at, ...(photo ? { photo } : {}) });
    chat.lastMessageAt = at;
    // Your own send marks the thread read for you.
    (store.chatReads ??= {})[`${chatId}#${fromPhone}`] = id;
    save(store);
    const otherPhone = chat.aPhone === fromPhone ? chat.bPhone : chat.aPhone;
    return {
      outcome: "sent",
      message: { id, mine: true, body, photo: photo ?? null, reported: false, at },
      otherPhone,
      otherNudgedAt: store.accounts[otherPhone]?.chatNudgedAt ?? null,
      audited: false,
      path: "file",
    };
  },

  /** The thread page's one-stop read: summary + messages, marking it read. */
  openChatThread(chatId: number, phone: string): ChatThreadView | null {
    const store = load();
    const chat = (store.chats ?? []).find((c) => c.id === chatId);
    if (!chat || (chat.aPhone !== phone && chat.bPhone !== phone)) return null;
    const otherPhone = chat.aPhone === phone ? chat.bPhone : chat.aPhone;
    const other = store.accounts[otherPhone];
    const messages = (store.chatMessages ?? [])
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.id - b.id);
    const last = messages[messages.length - 1];
    if (last) {
      (store.chatReads ??= {})[`${chatId}#${phone}`] = last.id;
      save(store);
    }
    return {
      summary: {
        id: chat.id,
        adId: chat.adId,
        otherMemberId: other?.userId ?? null,
        otherPhoto: other?.profilePhoto ?? null,
        otherVerified: Boolean(other?.verifiedAt),
        lastMessageAt: chat.lastMessageAt,
        unread: false, // you're reading it right now
      },
      messages: messages.map((m) => ({
        id: m.id,
        mine: m.fromPhone === phone,
        body: m.body,
        photo: m.photo ?? null,
        reported: Boolean(m.reportedAt),
        at: m.at,
      })),
    };
  },

  setChatNudgedAt(phone: string): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.chatNudgedAt = new Date().toISOString();
    save(store);
  },

  /** Claim-before-send twin of the Supabase conditional UPDATE: stamp the
   * watermark only when the window is open; the stamp is the win token. */
  claimChatNudge(phone: string, windowMs: number): string | null {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return null;
    if (!nudgeWindowOpen(account.chatNudgedAt ?? null, Date.now(), windowMs)) return null;
    const stamped = new Date().toISOString();
    account.chatNudgedAt = stamped;
    save(store);
    return stamped;
  },

  unclaimChatNudge(phone: string, stampedAt: string, previous: string | null): void {
    const store = load();
    const account = store.accounts[phone];
    // Only OUR stamp may be rolled back — a fresh competing claim stands.
    if (!account || account.chatNudgedAt !== stampedAt) return;
    account.chatNudgedAt = previous ?? undefined;
    save(store);
  },

  markChatRead(chatId: number, phone: string): void {
    const store = load();
    if (!file.chatMember(chatId, phone)) return;
    const last = (store.chatMessages ?? []).filter((m) => m.chatId === chatId).pop();
    if (!last) return;
    (store.chatReads ??= {})[`${chatId}#${phone}`] = last.id;
    save(store);
  },

  consumeFreeAd(phone: string): boolean {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return false;
    account.freeAds ??= 0;
    if (account.freeAds <= 0) return false;
    account.freeAds -= 1;
    save(store);
    return true;
  },

  /**
   * Apply the one-time starter free-ad grant if it hasn't been given yet, and
   * return the (updated) account. Idempotent: the second call is a no-op even
   * after the passes are spent, so first-post-only — never on account creation
   * and never again. Writes the "Welcome" ledger note at grant time.
   */
  grantStarterAdsIfFirst(phone: string): Account {
    const store = load();
    const account = store.accounts[phone];
    if (!account) throw new Error(`grantStarterAdsIfFirst: no account for ${phone}`);
    account.freeAds ??= 0;
    if (!account.starterGrantedAt) {
      const at = new Date().toISOString();
      account.freeAds += STARTER_FREE_ADS;
      account.starterGrantedAt = at;
      (store.ledgers[phone] ??= []).push({
        at,
        delta: 0,
        kind: "grant",
        note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
      });
      save(store);
    }
    return account;
  },

  grantFreeAd(phone: string): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.freeAds = (account.freeAds ?? 0) + 1;
    save(store);
  },

  reservePicQuota(
    phone: string,
    dailyAllowance: number,
    bankCap: number,
    today: string,
  ): PicQuotaResult {
    if (dailyAllowance <= 0) return { allowed: true, remaining: -1 }; // quota off
    const store = load();
    const account = store.accounts[phone];
    if (!account) return { allowed: true, remaining: -1 }; // fail-open (defensive)
    const state = accruePicQuota(
      { balance: account.picBalance ?? 0, day: account.picAccrualDay ?? null },
      today,
      dailyAllowance,
      bankCap,
    );
    if (state.balance >= 1) {
      account.picBalance = state.balance - 1;
      account.picAccrualDay = state.day;
      save(store);
      return { allowed: true, remaining: account.picBalance };
    }
    account.picBalance = state.balance;
    account.picAccrualDay = state.day;
    save(store);
    return { allowed: false, remaining: 0 };
  },

  reserveRevealQuota(
    phone: string,
    adId: number,
    dailyAllowance: number,
    bankCap: number,
    today: string,
  ): PicQuotaResult {
    const store = load();
    const reveals = (store.reveals ??= []);
    // Free repeat first: an already-revealed ad never touches the bank.
    if (reveals.some((r) => r.phone === phone && r.adId === adId)) {
      return { allowed: true, remaining: -1 };
    }
    const account = store.accounts[phone];
    // Metering off (dailyAllowance <= 0) and the defensive no-account case
    // both allow without spending — decideReveal handles the precedence; a
    // missing account passes accrued: null (fail-open, the action
    // ensureAccount()s first).
    const accrued =
      dailyAllowance > 0 && account
        ? accruePicQuota(
            { balance: account.revealBalance ?? 0, day: account.revealAccrualDay ?? null },
            today,
            dailyAllowance,
            bankCap,
          )
        : null;
    const decision = decideReveal({
      alreadyRevealed: false,
      revealsPerDay: dailyAllowance,
      accrued,
    });
    if (decision.state && account) {
      account.revealBalance = decision.state.balance;
      account.revealAccrualDay = decision.state.day;
    }
    if (decision.allowed) {
      reveals.push({ phone, adId, at: new Date().toISOString() });
    }
    save(store);
    return { allowed: decision.allowed, remaining: decision.remaining };
  },

  hasRevealed(phone: string, adId: number): boolean {
    return (load().reveals ?? []).some((r) => r.phone === phone && r.adId === adId);
  },

  listRevealsSince(since: string): RevealSince[] {
    const sinceMs = Date.parse(since);
    return (load().reveals ?? []).filter((r) => Date.parse(r.at) >= sinceMs);
  },

  recordOffense(phone: string): number {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return 0;
    account.offenseCount = (account.offenseCount ?? 0) + 1;
    if (account.offenseCount >= OFFENSE_BAN_THRESHOLD && !account.postingBannedAt) {
      account.postingBannedAt = new Date().toISOString();
    }
    save(store);
    return account.offenseCount;
  },

  listSubscriberPhones(): string[] {
    return Object.values(load().accounts)
      .filter((a) => a.subscribedAt && a.phone)
      .map((a) => a.phone);
  },

  getSubscriberCategories(phone: string): string[] | null {
    return load().accounts[phone]?.categories ?? null;
  },

  setSubscriberCategories(phone: string, categories: string[] | null): "saved" {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return "saved"; // parity with the 0-row Supabase update
    account.categories = categories;
    save(store);
    return "saved";
  },

  reserveCategoryConfirm(phone: string, limit: number): ConfirmAction {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return "confirm";
    const decided = decideCategoryConfirm(
      {
        windowStartMs: account.categoryConfirmWindowStart
          ? Date.parse(account.categoryConfirmWindowStart)
          : null,
        count: account.categoryConfirmCount ?? 0,
      },
      Date.now(),
      limit,
    );
    account.categoryConfirmWindowStart =
      decided.state.windowStartMs === null
        ? null
        : new Date(decided.state.windowStartMs).toISOString();
    account.categoryConfirmCount = decided.state.count;
    save(store);
    return decided.action;
  },

  listSubscribersWithCategories(): SubscriberCategories[] {
    return Object.values(load().accounts)
      .filter((a) => a.subscribedAt && a.phone)
      .map((a) => ({ phone: a.phone, categories: a.categories ?? null }));
  },

  listEmailRecipientsWithCategories(): EmailRecipientCategories[] {
    const store = load();
    const rows = new Map<string, EmailRecipientCategories>();
    for (const a of Object.values(store.accounts)) {
      if (a.email && a.emailSubscribedAt) {
        rows.set(a.email.toLowerCase(), {
          email: a.email.toLowerCase(),
          categories: a.categories ?? null,
        });
      }
    }
    // Email-only signups have no account and no prefs — they read as ALL.
    for (const s of Object.values(store.emailSubscribers ?? {})) {
      const key = s.email.toLowerCase();
      if (!rows.has(key)) rows.set(key, { email: key, categories: null });
    }
    return [...rows.values()];
  },

  setEmailEdition(phone: string, on: boolean): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account?.email) return;
    account.emailSubscribedAt = on ? new Date().toISOString() : null;
    save(store);
  },

  /** Returns true if this call newly activated the subscription (was off before). */
  subscribeEmailOnly(email: string): boolean {
    const store = load();
    const key = email.toLowerCase();
    const now = new Date().toISOString();
    // A phone member with this email gets their account flag instead.
    const member = Object.values(store.accounts).find(
      (a) => a.email?.toLowerCase() === key,
    );
    let wasActive: boolean;
    if (member) {
      wasActive = Boolean(member.emailSubscribedAt);
      member.emailSubscribedAt = now;
    } else {
      const subs = (store.emailSubscribers ??= {});
      wasActive = Boolean(subs[key]);
      subs[key] = { email, subscribedAt: now };
    }
    save(store);
    return !wasActive;
  },

  unsubscribeEmail(email: string): void {
    const store = load();
    const key = email.toLowerCase();
    delete store.emailSubscribers?.[key];
    for (const account of Object.values(store.accounts)) {
      if (account.email?.toLowerCase() === key) account.emailSubscribedAt = null;
    }
    save(store);
  },

  listEmailRecipients(): string[] {
    const store = load();
    const fromAccounts = Object.values(store.accounts)
      .filter((a) => a.email && a.emailSubscribedAt)
      .map((a) => a.email!);
    const emailOnly = Object.values(store.emailSubscribers ?? {}).map((s) => s.email);
    return [...new Set([...fromAccounts, ...emailOnly].map((e) => e.toLowerCase()))];
  },

  mergeAccounts(survivorPhone: string, source: string): MergeOutcome {
    const store = load();
    const survivor = store.accounts[survivorPhone];
    if (!survivor) return { ok: false, reason: "No account exists for this phone." };

    const sourcePhone = normalizePhone(source);
    if (sourcePhone) {
      if (sourcePhone === survivorPhone) {
        return { ok: false, reason: "That is this same account." };
      }
      const loser = store.accounts[sourcePhone];
      if (!loser) return { ok: false, reason: `No account exists for ${sourcePhone}.` };
      // The merged-away member id retires for a year (FEATURES item 0).
      if (loser.userId) {
        (store.retiredUserIds ??= {})[loser.userId] = new Date().toISOString();
      }
      survivor.freeAds += loser.freeAds;
      survivor.offenseCount = (survivor.offenseCount ?? 0) + (loser.offenseCount ?? 0);
      survivor.picBalance = (survivor.picBalance ?? 0) + (loser.picBalance ?? 0);
      survivor.subscribedAt ??= loser.subscribedAt;
      survivor.starterGrantedAt ??= loser.starterGrantedAt;
      survivor.postingBannedAt ??= loser.postingBannedAt;
      survivor.stripeCustomerId ??= loser.stripeCustomerId;
      survivor.passwordHash ??= loser.passwordHash;
      if (!survivor.email && loser.email) {
        survivor.email = loser.email;
        survivor.emailSubscribedAt ??= loser.emailSubscribedAt;
      }
      const movedLedger = store.ledgers[sourcePhone] ?? [];
      if (movedLedger.length) (store.ledgers[survivorPhone] ??= []).push(...movedLedger);
      delete store.ledgers[sourcePhone];
      delete store.codes[sourcePhone];
      delete store.accounts[sourcePhone];
      save(store);
      // Ads are phone-keyed in the file store; the caller reassigns them via
      // engine-store.reassignAdOwnership and fills in adsMoved.
      return {
        ok: true,
        kind: "phone",
        loserPhone: sourcePhone,
        adsMoved: 0,
        creditEntriesMoved: movedLedger.length,
      };
    }

    const key = source.trim().toLowerCase();
    if (!key.includes("@")) {
      return { ok: false, reason: "Enter a 10-digit phone number or an email address." };
    }
    const otherOwner = Object.values(store.accounts).find(
      (a) => a.phone !== survivorPhone && a.email?.toLowerCase() === key,
    );
    if (otherOwner) {
      return {
        ok: false,
        reason: `That email belongs to the account for ${otherOwner.phone} — merge that phone number instead.`,
      };
    }
    if (survivor.email && survivor.email.toLowerCase() !== key) {
      return {
        ok: false,
        reason: `This account already has ${survivor.email} — replace it first if that's wrong.`,
      };
    }
    const emailOnly = store.emailSubscribers?.[key];
    survivor.email = key;
    survivor.emailSubscribedAt =
      survivor.emailSubscribedAt ?? emailOnly?.subscribedAt ?? new Date().toISOString();
    if (store.emailSubscribers) delete store.emailSubscribers[key];
    save(store);
    return { ok: true, kind: "email", email: key };
  },

  listSmsSubscribers(): SmsSubscriberEntry[] {
    return Object.values(load().accounts)
      .filter((a) => a.subscribedAt)
      .map((a) => ({ phone: a.phone, subscribedAt: a.subscribedAt! }))
      .sort((a, b) => Date.parse(b.subscribedAt) - Date.parse(a.subscribedAt));
  },

  listEmailSubscribers(): EmailSubscriberEntry[] {
    const store = load();
    const rows = new Map<string, EmailSubscriberEntry>();
    for (const a of Object.values(store.accounts)) {
      if (a.email && a.emailSubscribedAt) {
        rows.set(a.email.toLowerCase(), {
          email: a.email.toLowerCase(),
          subscribedAt: a.emailSubscribedAt,
        });
      }
    }
    for (const s of Object.values(store.emailSubscribers ?? {})) {
      const key = s.email.toLowerCase();
      if (!rows.has(key)) rows.set(key, { email: key, subscribedAt: s.subscribedAt ?? null });
    }
    return [...rows.values()].sort(
      (a, b) => Date.parse(b.subscribedAt ?? "1970") - Date.parse(a.subscribedAt ?? "1970"),
    );
  },

  setPostingBanned(phone: string, banned: boolean): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.postingBannedAt = banned ? new Date().toISOString() : null;
    save(store);
  },

  setOffenseCount(phone: string, count: number): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.offenseCount = Math.max(0, count);
    save(store);
  },

  searchAccounts(q: string, limit = 25): Account[] {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return Object.values(load().accounts)
      .filter((a) => {
        if (!needle) return true;
        return (
          (digits && a.phone.includes(digits)) ||
          a.email?.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map((a) => ({ ...a, freeAds: a.freeAds ?? 0 }));
  },

  upsertAccountPassword(phone: string, passwordHash: string): Account {
    const store = load();
    let account = store.accounts[phone];
    if (!account) {
      // Claiming an account (setting a password) does not grant free ads — like
      // every other creation path, the starter grant waits for the first AD NEW.
      account = {
        phone,
        createdAt: new Date().toISOString(),
        freeAds: 0,
        starterGrantedAt: null,
      };
      store.accounts[phone] = account;
    }
    account.passwordHash = passwordHash;
    save(store);
    return account;
  },

  setEmail(phone: string, email: string | null): boolean {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return true;
    if (email) {
      const taken = Object.values(store.accounts).some(
        (a) => a.phone !== phone && a.email?.toLowerCase() === email.toLowerCase(),
      );
      if (taken) return false;
      account.email = email;
    } else {
      delete account.email;
    }
    save(store);
    return true;
  },

  setSubscribed(phone: string, subscribed: boolean): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.subscribedAt = subscribed ? new Date().toISOString() : null;
    save(store);
  },

  getLedger(phone: string): LedgerEntry[] {
    return [...(load().ledgers[phone] ?? [])].reverse();
  },

  getCreditBalance(phone: string): number {
    return (load().ledgers[phone] ?? []).reduce((sum, entry) => sum + entry.delta, 0);
  },

  listLedgerSince(sinceIso: string): LedgerSince[] {
    const since = Date.parse(sinceIso);
    const out: LedgerSince[] = [];
    for (const [phone, entries] of Object.entries(load().ledgers)) {
      for (const e of entries) {
        if (Date.parse(e.at) >= since) out.push({ phone, delta: e.delta, kind: e.kind, at: e.at });
      }
    }
    return out;
  },

  addLedgerEntry(phone: string, entry: Omit<LedgerEntry, "at">): void {
    const store = load();
    (store.ledgers[phone] ??= []).push({ at: new Date().toISOString(), ...entry });
    save(store);
  },

  spendCredits(phone: string, amount: number, note: string): boolean {
    const store = load();
    const ledger = store.ledgers[phone] ?? [];
    const balance = ledger.reduce((sum, e) => sum + e.delta, 0);
    if (balance < amount) return false;
    (store.ledgers[phone] ??= []).push({
      at: new Date().toISOString(),
      delta: -amount,
      kind: "spend",
      note,
    });
    save(store);
    return true;
  },

  hasLedgerRef(ref: string): boolean {
    return Object.values(load().ledgers).some((entries) =>
      entries.some((entry) => entry.ref === ref),
    );
  },

  setStripeCustomerId(phone: string, customerId: string): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.stripeCustomerId = customerId;
    save(store);
  },

  createCode(phone: string, echoForDev: boolean): CreateCodeResult & { code?: string } {
    const store = load();
    const now = Date.now();
    const recent = (store.codeRequests[phone] ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_CODES) return { ok: false, error: "rate" };

    const code = String(randomInt(100000, 1000000));
    recent.push(now);
    store.codeRequests[phone] = recent;
    store.codes[phone] = {
      codeHash: hashCode(code),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      ...(echoForDev && { devEcho: code }),
    };
    save(store);
    return { ok: true, code, ...(echoForDev && { devEcho: code }) };
  },

  peekDevEcho(phone: string): string | null {
    const record = load().codes[phone];
    if (!record || Date.now() > record.expiresAt) return null;
    return record.devEcho ?? null;
  },

  verifyCode(phone: string, code: string): VerifyCodeResult {
    const store = load();
    const record = store.codes[phone];
    if (!record) return "none";
    if (Date.now() > record.expiresAt) {
      delete store.codes[phone];
      save(store);
      return "expired";
    }
    if (record.attempts >= CODE_MAX_ATTEMPTS) {
      delete store.codes[phone];
      save(store);
      return "attempts";
    }
    record.attempts += 1;
    if (hashCode(code) !== record.codeHash) {
      save(store);
      return record.attempts >= CODE_MAX_ATTEMPTS ? "attempts" : "wrong";
    }
    delete store.codes[phone];
    save(store);
    return "ok";
  },
};

// ---------- public interface (async; picks the implementation) ----------

export async function getAccount(phone: string): Promise<Account | null> {
  return supabaseConfigured ? remote.getAccount(phone) : file.getAccount(phone);
}

/** Create-on-first-contact (spec Q6): any inbound message makes an account. */
export async function ensureAccount(phone: string): Promise<Account> {
  return supabaseConfigured ? remote.ensureAccount(phone) : file.ensureAccount(phone);
}

/**
 * The member's public 6-digit id (FEATURES item 0) — assigned lazily when the
 * account doesn't have one yet. Null when the account doesn't exist or when
 * migration 9986 isn't applied (the feature stays dormant; never a 500).
 */
export async function ensureUserId(phone: string): Promise<string | null> {
  return supabaseConfigured ? remote.ensureUserId(phone) : file.ensureUserId(phone);
}

/** Look a member up by their public id (ratings, chat). */
export async function getAccountByUserId(userId: string): Promise<Account | null> {
  return supabaseConfigured ? remote.getAccountByUserId(userId) : file.getAccountByUserId(userId);
}

/**
 * Open a conversational prompt for a phone (FEATURES item 2). "unsupported" =
 * migration 9984 missing — the caller keeps its plain reply and moves on.
 */
export async function setSmsContext(
  phone: string,
  context: SmsContext,
): Promise<"set" | "unsupported"> {
  return supabaseConfigured
    ? remote.setSmsContext(phone, context)
    : file.setSmsContext(phone, context);
}

/** The phone's open prompt, or null (absent, expired, or migration missing). */
export async function getSmsContext(phone: string): Promise<SmsContext | null> {
  return supabaseConfigured ? remote.getSmsContext(phone) : file.getSmsContext(phone);
}

export async function clearSmsContext(phone: string): Promise<void> {
  return supabaseConfigured ? remote.clearSmsContext(phone) : file.clearSmsContext(phone);
}

/** The seller named the buyer: the sale is confirmed (last answer wins). */
export async function recordSale(
  adId: number,
  sellerPhone: string,
  buyerPhone: string,
): Promise<"recorded" | "unsupported"> {
  return supabaseConfigured
    ? remote.recordSale(adId, sellerPhone, buyerPhone)
    : file.recordSale(adId, sellerPhone, buyerPhone);
}

/**
 * One star rating (1–5), confirmed parties only: the sale row must name the
 * rater and rated in exactly the claimed direction. One rating per person
 * per ad.
 */
export async function addRating(
  adId: number,
  raterPhone: string,
  ratedPhone: string,
  ratedRole: "buyer" | "seller",
  stars: number,
): Promise<"added" | "duplicate" | "notconfirmed" | "unsupported"> {
  return supabaseConfigured
    ? remote.addRating(adId, raterPhone, ratedPhone, ratedRole, stars)
    : file.addRating(adId, raterPhone, ratedPhone, ratedRole, stars);
}

/** Ratings received by a phone's account, split by role. */
export async function getRatingSummary(phone: string): Promise<RatingSummary> {
  return supabaseConfigured ? remote.getRatingSummary(phone) : file.getRatingSummary(phone);
}

/** Profile picture + private pickup address. Null = no account, or the
 * profile columns aren't there yet (migration 9983) — the UI hides itself. */
export async function getProfile(phone: string): Promise<Profile | null> {
  return supabaseConfigured ? remote.getProfile(phone) : file.getProfile(phone);
}

export async function setProfile(
  phone: string,
  update: Partial<Profile>,
): Promise<"saved" | "unsupported"> {
  return supabaseConfigured ? remote.setProfile(phone, update) : file.setProfile(phone, update);
}

/** Open (or find) the thread between two members about an ad (FEATURES item
 * 4). Null = chat isn't available (migration 9983 missing). */
export async function ensureChat(
  adId: number | null,
  phoneA: string,
  phoneB: string,
): Promise<number | null> {
  return supabaseConfigured
    ? remote.ensureChat(adId, phoneA, phoneB)
    : file.ensureChat(adId, phoneA, phoneB);
}

/** All of a member's threads, most recent first. */
export async function listChatsFor(phone: string): Promise<ChatSummary[]> {
  return supabaseConfigured ? remote.listChatsFor(phone) : file.listChatsFor(phone);
}

/** A thread's messages — null unless the phone is one of the two members. */
export async function listChatMessages(
  chatId: number,
  phone: string,
): Promise<ChatMessageView[] | null> {
  return supabaseConfigured
    ? remote.listChatMessages(chatId, phone)
    : file.listChatMessages(chatId, phone);
}

/** Send into a thread (members only). `photo` (item 14) is an already-
 * re-hosted storage URL; "photocap" = the thread is at its picture limit
 * (CHAT_PHOTO_CAP). In prod this is ONE round trip via the send_chat RPC
 * (migration 9980), falling back to the multi-query path until it's pasted. */
export async function sendChatMessage(
  chatId: number,
  fromPhone: string,
  body: string,
  photo?: string | null,
): Promise<SendChatResult> {
  return supabaseConfigured
    ? remote.sendChatMessage(chatId, fromPhone, body, photo)
    : file.sendChatMessage(chatId, fromPhone, body, photo);
}

/**
 * Everything the thread page needs in one call: the single chat's summary
 * (no listChatsFor scan) plus its messages — and it marks the thread read,
 * since rendering it IS reading it. Null = not a member / no such chat.
 */
export async function openChatThread(
  chatId: number,
  phone: string,
): Promise<ChatThreadView | null> {
  return supabaseConfigured
    ? remote.openChatThread(chatId, phone)
    : file.openChatThread(chatId, phone);
}

/** Record that the you-have-a-message SMS just went to this phone (item 15).
 * Best-effort: a no-op before migration 9980. */
export async function setChatNudgedAt(phone: string): Promise<void> {
  return supabaseConfigured ? remote.setChatNudgedAt(phone) : file.setChatNudgedAt(phone);
}

/** Atomically claim the nudge watermark BEFORE dispatching (stamp = win token;
 * null = window closed / lost the race). See lib/chat-actions nudgeOtherParty. */
export async function claimChatNudge(phone: string, windowMs: number): Promise<string | null> {
  return supabaseConfigured
    ? remote.claimChatNudge(phone, windowMs)
    : file.claimChatNudge(phone, windowMs);
}

/** Best-effort rollback of a claim whose dispatch never happened. */
export async function unclaimChatNudge(
  phone: string,
  stampedAt: string,
  previous: string | null,
): Promise<void> {
  return supabaseConfigured
    ? remote.unclaimChatNudge(phone, stampedAt, previous)
    : file.unclaimChatNudge(phone, stampedAt, previous);
}

export async function markChatRead(chatId: number, phone: string): Promise<void> {
  return supabaseConfigured
    ? remote.markChatRead(chatId, phone)
    : file.markChatRead(chatId, phone);
}

/** Number of chats with unread messages — the light count behind the header
 * badge and its ~60s poll (item 12). Unlike listChatsFor it skips the
 * other-member profile lookup. 0 when the chat schema (9983) is missing. */
export async function countUnreadChats(phone: string): Promise<number> {
  return supabaseConfigured ? remote.countUnreadChats(phone) : file.countUnreadChats(phone);
}

/**
 * Report a message in a thread the reporter belongs to (FEATURES item 13).
 * "denied" = not a member, no such message, or it's their own message;
 * "unsupported" = migration 9980 pending (the report UI stays quiet).
 */
export async function flagChatMessage(
  chatId: number,
  messageId: number,
  byPhone: string,
): Promise<"reported" | "denied" | "unsupported"> {
  return supabaseConfigured
    ? remote.flagChatMessage(chatId, messageId, byPhone)
    : file.flagChatMessage(chatId, messageId, byPhone);
}

/** Open (unresolved) member reports for the operator queue; [] pre-9980. */
export async function listChatReports(): Promise<ReportedChatMessage[]> {
  return supabaseConfigured ? remote.listChatReports() : file.listChatReports();
}

/** Operator: clear a report from the queue, recording the outcome. */
export async function resolveChatReport(
  messageId: number,
  resolution: "resolved" | "dismissed",
): Promise<"resolved" | "unsupported"> {
  return supabaseConfigured
    ? remote.resolveChatReport(messageId, resolution)
    : file.resolveChatReport(messageId, resolution);
}

/** When the operator verified this member (FEATURES item 7); null = not
 * verified (or no account, or migration 9981 pending). */
export async function getVerifiedAt(phone: string): Promise<string | null> {
  return supabaseConfigured ? remote.getVerifiedAt(phone) : file.getVerifiedAt(phone);
}

/** Operator-only: grant or revoke the green check. */
export async function setVerified(
  phone: string,
  on: boolean,
): Promise<"saved" | "unsupported"> {
  return supabaseConfigured ? remote.setVerified(phone, on) : file.setVerified(phone, on);
}

/** Spend one starter pass if any remain. */
export async function consumeFreeAd(phone: string): Promise<boolean> {
  return supabaseConfigured ? remote.consumeFreeAd(phone) : file.consumeFreeAd(phone);
}

/**
 * Apply the one-time starter free-ad grant on the seller's first AD NEW (not on
 * account creation). Idempotent — returns the account with the grant applied,
 * or unchanged if it was already granted. Call it in the AD-NEW path only.
 */
export async function grantStarterAdsIfFirst(phone: string): Promise<Account> {
  return supabaseConfigured
    ? remote.grantStarterAdsIfFirst(phone)
    : file.grantStarterAdsIfFirst(phone);
}

/** Return a starter pass (benign rejection refund). */
export async function grantFreeAd(phone: string): Promise<void> {
  return supabaseConfigured ? remote.grantFreeAd(phone) : file.grantFreeAd(phone);
}

/**
 * Atomically accrue the PIC daily allowance / rolling bank and spend one pull.
 * Returns { allowed, remaining } — allowed=false when the bank is empty for the
 * ET day. `today` is the ET calendar day (YYYY-MM-DD); dailyAllowance <= 0 turns
 * the quota off (always allowed, remaining -1). Serialized per user in prod.
 */
export async function reservePicQuota(
  phone: string,
  dailyAllowance: number,
  bankCap: number,
  today: string,
): Promise<PicQuotaResult> {
  return supabaseConfigured
    ? remote.reservePicQuota(phone, dailyAllowance, bankCap, today)
    : file.reservePicQuota(phone, dailyAllowance, bankCap, today);
}

/**
 * Atomically decide one number reveal (FEATURES item 23): free repeat if this
 * member already revealed this ad, else accrue the daily allowance / rolling
 * bank (lib/reveal-quota.ts) and spend one look-up, logging the reveal.
 * `today` is the ET calendar day (YYYY-MM-DD); dailyAllowance <= 0 turns
 * metering off (always allowed, still logged, remaining -1). Serialized per
 * user in prod; degrades to an unmetered allow when migration 9979 is missing.
 */
export async function reserveRevealQuota(
  phone: string,
  adId: number,
  dailyAllowance: number,
  bankCap: number,
  today: string,
): Promise<PicQuotaResult> {
  return supabaseConfigured
    ? remote.reserveRevealQuota(phone, adId, dailyAllowance, bankCap, today)
    : file.reserveRevealQuota(phone, adId, dailyAllowance, bankCap, today);
}

/**
 * Has this member already revealed this ad's number? Persistent — the ad page
 * server-renders revealed numbers from this record. "unsupported" = the
 * reveal log is unavailable (migration 9979 not yet pasted); the page then
 * falls back to the just-revealed redirect param (see app/ad/[id]).
 */
export async function hasRevealed(
  phone: string,
  adId: number,
): Promise<boolean | "unsupported"> {
  return supabaseConfigured ? remote.hasRevealed(phone, adId) : file.hasRevealed(phone, adId);
}

/** Reveal-log rows since an ISO instant — for the Insights excessive-reveal flags. */
export async function listRevealsSince(since: string): Promise<RevealSince[]> {
  return supabaseConfigured ? remote.listRevealsSince(since) : file.listRevealsSince(since);
}

/** Increment strikes; auto-bans posting at the threshold. Returns the new count. */
export async function recordOffense(phone: string): Promise<number> {
  return supabaseConfigured ? remote.recordOffense(phone) : file.recordOffense(phone);
}

export async function listSubscriberPhones(): Promise<string[]> {
  return supabaseConfigured ? remote.listSubscriberPhones() : file.listSubscriberPhones();
}

/**
 * A member's category prefs (items 22/24): null = ALL (the default and the
 * grandfather state), [] = none, else lowercase keys. "unsupported" =
 * migration 9976 not applied — category commands/UI stay dormant.
 */
export async function getSubscriberCategories(
  phone: string,
): Promise<string[] | null | "unsupported"> {
  return supabaseConfigured
    ? remote.getSubscriberCategories(phone)
    : file.getSubscriberCategories(phone);
}

/** Save category prefs (null resets to ALL). Shared by the SMS toggles and
 * the /account checkboxes — either side's change shows on the other. */
export async function setSubscriberCategories(
  phone: string,
  categories: string[] | null,
): Promise<"saved" | "unsupported"> {
  return supabaseConfigured
    ? remote.setSubscriberCategories(phone, categories)
    : file.setSubscriberCategories(phone, categories);
}

/**
 * Count one category/LIST confirmation against the per-number hourly throttle
 * (item 24 spam guard; watermark + counter on the user row, migration 9976).
 * "confirm" = send the normal confirmation; "notice" = send the ONE "changes
 * still apply" notice; "silent" = send nothing (the toggle still applied).
 */
export async function reserveCategoryConfirm(
  phone: string,
  limit: number,
): Promise<ConfirmAction> {
  return supabaseConfigured
    ? remote.reserveCategoryConfirm(phone, limit)
    : file.reserveCategoryConfirm(phone, limit);
}

/** Every subscriber with their category prefs — the digest composer groups
 * these by effective set. Pre-9976, categories read as null (= ALL). */
export async function listSubscribersWithCategories(): Promise<SubscriberCategories[]> {
  return supabaseConfigured
    ? remote.listSubscribersWithCategories()
    : file.listSubscribersWithCategories();
}

/** Email-edition recipients with category prefs (null = ALL) — the email
 * mirror filters per recipient with these. */
export async function listEmailRecipientsWithCategories(): Promise<
  EmailRecipientCategories[]
> {
  return supabaseConfigured
    ? remote.listEmailRecipientsWithCategories()
    : file.listEmailRecipientsWithCategories();
}

/** Whether the category system's schema (migration 9976) is available — pages
 * use this to HIDE category UI instead of failing. Always true in dev. */
export async function categoriesSupported(): Promise<boolean> {
  return supabaseConfigured ? remote.categoriesSupported() : true;
}

/** Toggle the email edition for a phone member (requires a saved email). */
export async function setEmailEdition(phone: string, on: boolean): Promise<void> {
  return supabaseConfigured ? remote.setEmailEdition(phone, on) : file.setEmailEdition(phone, on);
}

/**
 * Confirmed email-only signup (or flags a member whose email matches).
 * Returns true when this call newly activated the subscription (it was off
 * before) — the inbound-email handler uses that to welcome only new sign-ups.
 */
export async function subscribeEmailOnly(email: string): Promise<boolean> {
  return supabaseConfigured ? remote.subscribeEmailOnly(email) : file.subscribeEmailOnly(email);
}

/** One-click unsubscribe — both populations, effective immediately. */
export async function unsubscribeEmail(email: string): Promise<void> {
  return supabaseConfigured ? remote.unsubscribeEmail(email) : file.unsubscribeEmail(email);
}

export async function listEmailRecipients(): Promise<string[]> {
  return supabaseConfigured ? remote.listEmailRecipients() : file.listEmailRecipients();
}

/**
 * Merge one identity into a phone account. `source` may be a phone number
 * (FULL merge: ads, credits, passes, strikes, saved card move to the survivor
 * and the other account is deleted; the message audit log is history and is
 * never rewritten) or an email address (links the email + its subscription to
 * this account — the person is then subscribed to both editions).
 */
export async function mergeAccounts(survivorPhone: string, source: string): Promise<MergeOutcome> {
  return supabaseConfigured
    ? remote.mergeAccounts(survivorPhone, source)
    : file.mergeAccounts(survivorPhone, source);
}

/** All current SMS subscribers with their subscribe time, newest first. */
export async function listSmsSubscribers(): Promise<SmsSubscriberEntry[]> {
  return supabaseConfigured ? remote.listSmsSubscribers() : file.listSmsSubscribers();
}

/** All current email-edition subscribers with their subscribe time, newest first. */
export async function listEmailSubscribers(): Promise<EmailSubscriberEntry[]> {
  return supabaseConfigured ? remote.listEmailSubscribers() : file.listEmailSubscribers();
}

export async function setPostingBanned(phone: string, banned: boolean): Promise<void> {
  return supabaseConfigured
    ? remote.setPostingBanned(phone, banned)
    : file.setPostingBanned(phone, banned);
}

export async function setOffenseCount(phone: string, count: number): Promise<void> {
  return supabaseConfigured
    ? remote.setOffenseCount(phone, count)
    : file.setOffenseCount(phone, count);
}

export async function searchAccounts(q: string, limit = 25): Promise<Account[]> {
  return supabaseConfigured ? remote.searchAccounts(q, limit) : file.searchAccounts(q, limit);
}

export async function upsertAccountPassword(
  phone: string,
  passwordHash: string,
): Promise<Account> {
  return supabaseConfigured
    ? remote.upsertAccountPassword(phone, passwordHash)
    : file.upsertAccountPassword(phone, passwordHash);
}

/** Returns false when the email is already on another account. */
export async function setEmail(phone: string, email: string | null): Promise<boolean> {
  return supabaseConfigured ? remote.setEmail(phone, email) : file.setEmail(phone, email);
}

export async function setSubscribed(phone: string, subscribed: boolean): Promise<void> {
  return supabaseConfigured
    ? remote.setSubscribed(phone, subscribed)
    : file.setSubscribed(phone, subscribed);
}

export async function getLedger(phone: string): Promise<LedgerEntry[]> {
  return supabaseConfigured ? remote.getLedger(phone) : file.getLedger(phone);
}

/** All ledger entries since a moment, tagged with owner phone — spend/revenue insights. */
export async function listLedgerSince(sinceIso: string): Promise<LedgerSince[]> {
  return supabaseConfigured ? remote.listLedgerSince(sinceIso) : file.listLedgerSince(sinceIso);
}

export async function getCreditBalance(phone: string): Promise<number> {
  return supabaseConfigured ? remote.getCreditBalance(phone) : file.getCreditBalance(phone);
}

export async function addLedgerEntry(
  phone: string,
  entry: Omit<LedgerEntry, "at">,
): Promise<void> {
  return supabaseConfigured
    ? remote.addLedgerEntry(phone, entry)
    : file.addLedgerEntry(phone, entry);
}

/** True when a ledger entry with this external ref already exists (webhook replay guard). */
export async function hasLedgerRef(ref: string): Promise<boolean> {
  return supabaseConfigured ? remote.hasLedgerRef(ref) : file.hasLedgerRef(ref);
}

/** Atomically debit credits; false if the balance doesn't cover the amount. */
export async function spendCredits(
  phone: string,
  amount: number,
  note: string,
): Promise<boolean> {
  return supabaseConfigured
    ? remote.spendCredits(phone, amount, note)
    : file.spendCredits(phone, amount, note);
}

export async function setStripeCustomerId(phone: string, customerId: string): Promise<void> {
  return supabaseConfigured
    ? remote.setStripeCustomerId(phone, customerId)
    : file.setStripeCustomerId(phone, customerId);
}

export async function createCode(
  phone: string,
  echoForDev: boolean,
): Promise<CreateCodeResult & { code?: string }> {
  return supabaseConfigured
    ? remote.createCode(phone, echoForDev)
    : file.createCode(phone, echoForDev);
}

export async function peekDevEcho(phone: string): Promise<string | null> {
  return supabaseConfigured ? remote.peekDevEcho(phone) : file.peekDevEcho(phone);
}

export async function verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
  return supabaseConfigured ? remote.verifyCode(phone, code) : file.verifyCode(phone, code);
}
