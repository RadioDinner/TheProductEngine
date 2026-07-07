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
  offense_count: number;
  posting_banned_at: string | null;
  stripe_customer_id: string | null;
}

const USER_SELECT =
  "id, phone, email, password_hash, created_at, subscribed_at, email_subscribed_at, free_ads, offense_count, posting_banned_at, stripe_customer_id";

function toAccount(row: UserRow): Account {
  return {
    phone: row.phone ?? "",
    passwordHash: row.password_hash ?? undefined,
    createdAt: row.created_at,
    email: row.email ?? undefined,
    subscribedAt: row.subscribed_at,
    emailSubscribedAt: row.email_subscribed_at,
    freeAds: row.free_ads,
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
  const { data, error } = await db()
    .from("users")
    .insert({ phone, password_hash: passwordHash })
    .select(USER_SELECT)
    .single();
  if (error) throw error;
  const row = data as UserRow;
  const { error: ledgerError } = await db().from("credit_ledger").insert({
    user_id: row.id,
    delta: 0,
    kind: "grant",
    note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
  });
  if (ledgerError) throw ledgerError;
  return toAccount(row);
}

export async function ensureAccount(phone: string): Promise<Account> {
  const existing = await userByPhone(phone);
  if (existing) return toAccount(existing);
  const { data, error } = await db()
    .from("users")
    .insert({ phone })
    .select(USER_SELECT)
    .single();
  if (error) throw error;
  const row = data as UserRow;
  const { error: ledgerError } = await db().from("credit_ledger").insert({
    user_id: row.id,
    delta: 0,
    kind: "grant",
    note: `Welcome — ${STARTER_FREE_ADS} free ads, picture or plain`,
  });
  if (ledgerError) throw ledgerError;
  return toAccount(row);
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

export async function subscribeEmailOnly(email: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("users")
    .update({ email_subscribed_at: now })
    .ilike("email", email)
    .select("id");
  if (error) throw error;
  if (data?.length) return; // matched an existing member
  const { error: insertError } = await db()
    .from("users")
    .insert({ email, email_subscribed_at: now });
  if (insertError && insertError.code !== "23505") throw insertError;
}

export async function unsubscribeEmail(email: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ email_subscribed_at: null })
    .ilike("email", email);
  if (error) throw error;
}

export async function listEmailRecipients(): Promise<string[]> {
  const { data, error } = await db()
    .from("users")
    .select("email")
    .not("email", "is", null)
    .not("email_subscribed_at", "is", null);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => (row.email as string).toLowerCase()))];
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
  const { data, error } = await db()
    .from("users")
    .select("phone")
    .not("subscribed_at", "is", null)
    .not("phone", "is", null);
  if (error) throw error;
  return (data ?? []).map((row) => row.phone as string);
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
  const { data, error } = await db()
    .from("credit_ledger")
    .select("created_at, delta, kind, note")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    at: row.created_at as string,
    delta: row.delta as number,
    kind: row.kind as LedgerEntry["kind"],
    note: row.note as string,
  }));
}

export async function getCreditBalance(phone: string): Promise<number> {
  const user = await userByPhone(phone);
  if (!user) return 0;
  const { data, error } = await db()
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.delta as number), 0);
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
  const { data, error } = await db()
    .from("verification_codes")
    .select("code_hash, expires_at, attempts")
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "none";

  const remove = () => db().from("verification_codes").delete().eq("phone", phone);

  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await remove();
    return "expired";
  }
  if ((data.attempts as number) >= CODE_MAX_ATTEMPTS) {
    await remove();
    return "attempts";
  }
  const attempts = (data.attempts as number) + 1;
  if (hashCode(code) !== data.code_hash) {
    const { error: updateError } = await db()
      .from("verification_codes")
      .update({ attempts })
      .eq("phone", phone);
    if (updateError) throw updateError;
    return attempts >= CODE_MAX_ATTEMPTS ? "attempts" : "wrong";
  }
  await remove();
  return "ok";
}
