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

// ---------- shared types & rules ----------

export interface Account {
  phone: string; // 10 digits
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
  offenseCount?: number;
  postingBannedAt?: string | null;
}

/** Email-only subscriber (no phone account) — spec Q11. */
export interface EmailSubscriber {
  email: string;
  subscribedAt: string;
}

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
    account.freeAds ??= STARTER_FREE_ADS;
    return account;
  },

  ensureAccount(phone: string): Account {
    const store = load();
    let account = store.accounts[phone];
    if (!account) {
      account = { phone, createdAt: new Date().toISOString(), freeAds: STARTER_FREE_ADS };
      store.accounts[phone] = account;
      (store.ledgers[phone] ??= []).push({
        at: account.createdAt,
        delta: 0,
        kind: "grant",
        note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
      });
      save(store);
    }
    account.freeAds ??= STARTER_FREE_ADS;
    return account;
  },

  consumeFreeAd(phone: string): boolean {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return false;
    account.freeAds ??= STARTER_FREE_ADS;
    if (account.freeAds <= 0) return false;
    account.freeAds -= 1;
    save(store);
    return true;
  },

  grantFreeAd(phone: string): void {
    const store = load();
    const account = store.accounts[phone];
    if (!account) return;
    account.freeAds = (account.freeAds ?? 0) + 1;
    save(store);
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
      .map((a) => ({ ...a, freeAds: a.freeAds ?? STARTER_FREE_ADS }));
  },

  upsertAccountPassword(phone: string, passwordHash: string): Account {
    const store = load();
    let account = store.accounts[phone];
    if (!account) {
      account = {
        phone,
        createdAt: new Date().toISOString(),
        freeAds: STARTER_FREE_ADS,
      };
      store.accounts[phone] = account;
      (store.ledgers[phone] ??= []).push({
        at: account.createdAt,
        delta: 0,
        kind: "grant",
        note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
      });
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

/** Spend one starter pass if any remain. */
export async function consumeFreeAd(phone: string): Promise<boolean> {
  return supabaseConfigured ? remote.consumeFreeAd(phone) : file.consumeFreeAd(phone);
}

/** Return a starter pass (benign rejection refund). */
export async function grantFreeAd(phone: string): Promise<void> {
  return supabaseConfigured ? remote.grantFreeAd(phone) : file.grantFreeAd(phone);
}

/** Increment strikes; auto-bans posting at the threshold. Returns the new count. */
export async function recordOffense(phone: string): Promise<number> {
  return supabaseConfigured ? remote.recordOffense(phone) : file.recordOffense(phone);
}

export async function listSubscriberPhones(): Promise<string[]> {
  return supabaseConfigured ? remote.listSubscriberPhones() : file.listSubscriberPhones();
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
