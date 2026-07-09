/**
 * Supabase implementation of the account/credits/codes store
 * (see lib/store.ts for shared types, rules, and the file implementation).
 */
import { createHash, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  OFFENSE_BAN_THRESHOLD,
  RATE_MAX_CODES,
  RATE_WINDOW_MS,
  STARTER_FREE_ADS,
  type Account,
  type CreateCodeResult,
  type LedgerEntry,
  type LedgerSince,
  type VerifyCodeResult,
} from "@/lib/store";

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  password_hash: string | null;
  created_at: string;
  subscribed_at: string | null;
  email_subscribed_at: string | null;
  free_ads: number;
  starter_granted_at: string | null;
  offense_count: number;
  posting_banned_at: string | null;
  stripe_customer_id: string | null;
}

const USER_SELECT =
  "id, phone, email, password_hash, created_at, subscribed_at, email_subscribed_at, free_ads, starter_granted_at, offense_count, posting_banned_at, stripe_customer_id";

function toAccount(row: UserRow): Account {
  return {
    phone: row.phone ?? "",
    passwordHash: row.password_hash ?? undefined,
    createdAt: row.created_at,
    email: row.email ?? undefined,
    subscribedAt: row.subscribed_at,
    emailSubscribedAt: row.email_subscribed_at,
    freeAds: row.free_ads,
    starterGrantedAt: row.starter_granted_at,
    offenseCount: row.offense_count,
    postingBannedAt: row.posting_banned_at,
    stripeCustomerId: row.stripe_customer_id,
  };
}

async function userByPhone(phone: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from("users")
    .select(USER_SELECT)
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  return (data as UserRow | null) ?? null;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function getAccount(phone: string): Promise<Account | null> {
  const row = await userByPhone(phone);
  return row ? toAccount(row) : null;
}

export async function upsertAccountPassword(
  phone: string,
  passwordHash: string,
): Promise<Account> {
  const existing = await userByPhone(phone);
  if (existing) {
    const { error } = await db()
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", existing.id);
    if (error) throw error;
    return toAccount({ ...existing, password_hash: passwordHash });
  }
  // Claiming an account (setting a password) grants NO free ads — the starter
  // grant is deferred to the first AD NEW like every other creation path.
  const { data, error } = await db()
    .from("users")
    .insert({ phone, password_hash: passwordHash, free_ads: 0 })
    .select(USER_SELECT)
    .single();
  if (error) throw error;
  return toAccount(data as UserRow);
}

export async function ensureAccount(phone: string): Promise<Account> {
  const existing = await userByPhone(phone);
  if (existing) return toAccount(existing);
  // First contact mints the account with ZERO free-ad passes and no welcome
  // ledger entry; the starter grant fires lazily on the first AD NEW
  // (grantStarterAdsIfFirst), so a number that never posts costs nothing.
  const { data, error } = await db()
    .from("users")
    .insert({ phone, free_ads: 0 })
    .select(USER_SELECT)
    .single();
  if (error) throw error;
  return toAccount(data as UserRow);
}

export async function consumeFreeAd(phone: string): Promise<boolean> {
  const user = await userByPhone(phone);
  if (!user || user.free_ads <= 0) return false;
  // Conditional decrement; the row count tells us whether WE won the race.
  // A concurrent request that already spent the last pass leaves 0 rows
  // matched — previously this returned true anyway, double-spending the pass.
  const { data, error } = await db()
    .from("users")
    .update({ free_ads: user.free_ads - 1 })
    .eq("id", user.id)
    .eq("free_ads", user.free_ads)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function grantStarterAdsIfFirst(phone: string): Promise<Account> {
  const user = await userByPhone(phone);
  if (!user) throw new Error(`grantStarterAdsIfFirst: no account for ${phone}`);
  if (user.starter_granted_at) return toAccount(user);
  const at = new Date().toISOString();
  // Conditional update guarded on starter_granted_at IS NULL: only the caller
  // that flips it from NULL wins the grant, so a concurrent double AD NEW can't
  // grant the passes twice (the loser matches 0 rows).
  const { data, error } = await db()
    .from("users")
    .update({ free_ads: user.free_ads + STARTER_FREE_ADS, starter_granted_at: at })
    .eq("id", user.id)
    .is("starter_granted_at", null)
    .select(USER_SELECT);
  if (error) throw error;
  if ((data?.length ?? 0) > 0) {
    const { error: ledgerError } = await db().from("credit_ledger").insert({
      user_id: user.id,
      delta: 0,
      kind: "grant",
      note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
    });
    if (ledgerError) throw ledgerError;
    return toAccount(data![0] as UserRow);
  }
  // Lost the race — a concurrent AD NEW granted first; return the fresh state.
  const fresh = await userByPhone(phone);
  return toAccount((fresh ?? user) as UserRow);
}

export async function grantFreeAd(phone: string): Promise<void> {
  const user = await userByPhone(phone);
  if (!user) return;
  const { error } = await db()
    .from("users")
    .update({ free_ads: user.free_ads + 1 })
    .eq("id", user.id);
  if (error) throw error;
}

export async function recordOffense(phone: string): Promise<number> {
  const user = await userByPhone(phone);
  if (!user) return 0;
  const count = user.offense_count + 1;
  const update: Record<string, unknown> = { offense_count: count };
  if (count >= OFFENSE_BAN_THRESHOLD && !user.posting_banned_at) {
    update.posting_banned_at = new Date().toISOString();
  }
  const { error } = await db().from("users").update(update).eq("id", user.id);
  if (error) throw error;
  return count;
}

export async function setEmailEdition(phone: string, on: boolean): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ email_subscribed_at: on ? new Date().toISOString() : null })
    .eq("phone", phone)
    .not("email", "is", null);
  if (error) throw error;
}

/** Returns true if this call newly activated the subscription (was off before). */
export async function subscribeEmailOnly(email: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: existing, error: findError } = await db()
    .from("users")
    .select("id, email_subscribed_at")
    // eq, not ilike: emails are stored lowercased, and ilike would treat % / _
    // in a crafted address as wildcards (matching unrelated subscribers).
    .eq("email", email)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) {
    const wasActive = existing.email_subscribed_at != null;
    const { error } = await db()
      .from("users")
      .update({ email_subscribed_at: now })
      .eq("id", existing.id as string);
    if (error) throw error;
    return !wasActive;
  }
  const { error: insertError } = await db()
    .from("users")
    .insert({ email, email_subscribed_at: now });
  if (insertError) {
    // A concurrent insert of the same email (unique) — already a member now.
    if (insertError.code === "23505") return false;
    throw insertError;
  }
  return true;
}

export async function unsubscribeEmail(email: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ email_subscribed_at: null })
    // eq, not ilike: a crafted address with % / _ must not unsubscribe others.
    .eq("email", email);
  if (error) throw error;
}

/**
 * PostgREST caps un-ranged selects at ~1000 rows — silently. Every full-list
 * read (subscribers, email recipients, a busy ledger) must page, or people
 * past row 1000 just never get digests.
 */
const PAGE = 1000;

export async function listEmailRecipients(): Promise<string[]> {
  const emails = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("email")
      .not("email", "is", null)
      .not("email_subscribed_at", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) emails.add((row.email as string).toLowerCase());
    if ((data?.length ?? 0) < PAGE) break;
  }
  return [...emails];
}

export async function setPostingBanned(phone: string, banned: boolean): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ posting_banned_at: banned ? new Date().toISOString() : null })
    .eq("phone", phone);
  if (error) throw error;
}

export async function setOffenseCount(phone: string, count: number): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ offense_count: Math.max(0, count) })
    .eq("phone", phone);
  if (error) throw error;
}

export async function searchAccounts(q: string, limit = 25): Promise<Account[]> {
  let query = db()
    .from("users")
    .select(USER_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  const needle = q.trim();
  if (needle) {
    const digits = needle.replace(/\D/g, "");
    query = digits
      ? query.ilike("phone", `%${digits}%`)
      : query.ilike("email", `%${needle}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as UserRow[]).map(toAccount);
}

export async function listSubscriberPhones(): Promise<string[]> {
  const phones: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("phone")
      .not("subscribed_at", "is", null)
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    phones.push(...(data ?? []).map((row) => row.phone as string));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return phones;
}

/** Returns false when the email is already on another account. */
export async function setEmail(phone: string, email: string | null): Promise<boolean> {
  const { error } = await db().from("users").update({ email }).eq("phone", phone);
  if (error) {
    if (error.code === "23505") return false; // unique_violation
    throw error;
  }
  return true;
}

export async function setSubscribed(phone: string, subscribed: boolean): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ subscribed_at: subscribed ? new Date().toISOString() : null })
    .eq("phone", phone);
  if (error) throw error;
}

export async function getLedger(phone: string): Promise<LedgerEntry[]> {
  const user = await userByPhone(phone);
  if (!user) return [];
  // Paged: a busy account past 1000 rows would otherwise return only the
  // newest 1000. This feeds the benign-rejection refund match (lib/moderation),
  // so a truncated history could silently downgrade a credit refund to a
  // free-ad grant when the original charge scrolled off.
  const entries: LedgerEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("credit_ledger")
      .select("created_at, delta, kind, note")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      entries.push({
        at: row.created_at as string,
        delta: row.delta as number,
        kind: row.kind as LedgerEntry["kind"],
        note: row.note as string,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return entries;
}

export async function getCreditBalance(phone: string): Promise<number> {
  const user = await userByPhone(phone);
  if (!user) return 0;
  // Paged: a busy account past 1000 ledger rows would otherwise be summed
  // from a silent 1000-row prefix — a wrong balance, not an error.
  let balance = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("credit_ledger")
      .select("delta")
      .eq("user_id", user.id)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    balance += (data ?? []).reduce((sum, row) => sum + (row.delta as number), 0);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return balance;
}

export async function addLedgerEntry(
  phone: string,
  entry: Omit<LedgerEntry, "at">,
): Promise<void> {
  const user = await userByPhone(phone);
  if (!user) return;
  const { error } = await db().from("credit_ledger").insert({
    user_id: user.id,
    delta: entry.delta,
    kind: entry.kind,
    note: entry.note,
    ref: entry.ref ?? null,
  });
  // A duplicate ref (unique index, migration 0003) means this grant was
  // already recorded by a concurrent/replayed webhook — idempotent, not an
  // error.
  if (error && error.code !== "23505") throw error;
}

/** Atomically debit credits if the balance covers it (migration 0005). */
export async function spendCredits(
  phone: string,
  amount: number,
  note: string,
): Promise<boolean> {
  const { data, error } = await db().rpc("spend_credits", {
    p_phone: phone,
    p_amount: amount,
    p_kind: "spend",
    p_note: note,
  });
  if (error) throw error;
  return data === true;
}

export async function listLedgerSince(sinceIso: string): Promise<LedgerSince[]> {
  const rows: LedgerSince[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("credit_ledger")
      .select("delta, kind, created_at, users!inner(phone)")
      .gte("created_at", sinceIso)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      // to-one embed comes back as an object at runtime; cast through unknown.
      const phone = (r.users as unknown as { phone: string | null } | null)?.phone ?? "";
      rows.push({
        phone,
        delta: r.delta as number,
        kind: r.kind as LedgerSince["kind"],
        at: r.created_at as string,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function hasLedgerRef(ref: string): Promise<boolean> {
  const { count, error } = await db()
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("ref", ref);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function setStripeCustomerId(phone: string, customerId: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ stripe_customer_id: customerId })
    .eq("phone", phone);
  if (error) throw error;
}

export async function createCode(
  phone: string,
  echoForDev: boolean,
): Promise<CreateCodeResult & { code?: string }> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await db()
    .from("code_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("requested_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= RATE_MAX_CODES) return { ok: false, error: "rate" };

  const code = String(randomInt(100000, 1000000));
  const { error: reqError } = await db().from("code_requests").insert({ phone });
  if (reqError) throw reqError;
  const { error: codeError } = await db()
    .from("verification_codes")
    .upsert({
      phone,
      code_hash: hashCode(code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      attempts: 0,
      dev_echo: echoForDev ? code : null,
    });
  if (codeError) throw codeError;
  return { ok: true, code, ...(echoForDev && { devEcho: code }) };
}

export async function peekDevEcho(phone: string): Promise<string | null> {
  const { data, error } = await db()
    .from("verification_codes")
    .select("dev_echo, expires_at")
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return (data.dev_echo as string | null) ?? null;
}

export async function verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
  // Atomic check-and-burn under a row lock (migration 0009). The old
  // read-then-write was a TOCTOU: concurrent wrong-code guesses all read
  // attempts < max and proceeded, amplifying brute-force of the 6-digit code.
  const { data, error } = await db().rpc("verify_login_code", {
    p_phone: phone,
    p_code_hash: hashCode(code),
    p_max_attempts: CODE_MAX_ATTEMPTS,
  });
  if (error) throw error;
  return (data as VerifyCodeResult) ?? "none";
}
