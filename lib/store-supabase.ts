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
  type EmailSubscriberEntry,
  type LedgerEntry,
  type LedgerSince,
  type MergeOutcome,
  type PicQuotaResult,
  type SmsSubscriberEntry,
  type VerifyCodeResult,
} from "@/lib/store";
import { normalizePhone } from "@/lib/phone";
import { USER_ID_MAX_ATTEMPTS, isRetirementActive, randomUserId } from "@/lib/user-id";

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
  pic_balance: number;
  pic_accrual_day: string | null;
}

const USER_SELECT =
  "id, phone, email, password_hash, created_at, subscribed_at, email_subscribed_at, free_ads, starter_granted_at, offense_count, posting_banned_at, stripe_customer_id, pic_balance, pic_accrual_day";

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
    picBalance: row.pic_balance ?? 0,
    picAccrualDay: row.pic_accrual_day,
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

/** Missing user_id column / retired_user_ids table = migration 0014 not
 * applied yet. The member-id feature stays dormant instead of 500ing (the
 * 0011/0012 drift lesson) — every caller treats null as "no id yet". */
function userIdSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "42P01";
}

export async function ensureUserId(phone: string): Promise<string | null> {
  const { data, error } = await db()
    .from("users")
    .select("id, user_id")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (userIdSchemaMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  if (data.user_id) return data.user_id as string;

  for (let attempt = 0; attempt < USER_ID_MAX_ATTEMPTS; attempt++) {
    const candidate = randomUserId();
    const { data: tombstone, error: retiredError } = await db()
      .from("retired_user_ids")
      .select("user_id, retired_at")
      .eq("user_id", candidate)
      .maybeSingle();
    if (retiredError) {
      if (userIdSchemaMissing(retiredError)) return null;
      throw retiredError;
    }
    if (tombstone) {
      if (isRetirementActive(tombstone.retired_at as string, Date.now())) continue;
      // A year has passed — reap the tombstone so the id can live again.
      await db().from("retired_user_ids").delete().eq("user_id", candidate);
    }
    const { data: updated, error: assignError } = await db()
      .from("users")
      .update({ user_id: candidate })
      .eq("id", data.id)
      .is("user_id", null)
      .select("user_id");
    if (assignError) {
      if (assignError.code === "23505") continue; // another member drew this id — again
      if (userIdSchemaMissing(assignError)) return null;
      throw assignError;
    }
    // 0 rows = a concurrent call assigned this account first; read what won.
    if (!updated?.length) {
      const { data: raced } = await db()
        .from("users")
        .select("user_id")
        .eq("id", data.id)
        .maybeSingle();
      return (raced?.user_id as string | null) ?? null;
    }
    return candidate;
  }
  console.error("[user-id] could not draw a unique member id");
  return null;
}

export async function getAccountByUserId(userId: string): Promise<Account | null> {
  const { data, error } = await db()
    .from("users")
    .select(`${USER_SELECT}, user_id`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (userIdSchemaMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  const account = toAccount(data as unknown as UserRow);
  account.userId = (data as { user_id?: string | null }).user_id ?? null;
  return account;
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

/** Atomically accrue + spend one PIC pull (migration 0011 reserve_pic_quota). */
export async function reservePicQuota(
  phone: string,
  dailyAllowance: number,
  bankCap: number,
  today: string,
): Promise<PicQuotaResult> {
  const { data, error } = await db().rpc("reserve_pic_quota", {
    p_phone: phone,
    p_daily: dailyAllowance,
    p_cap: bankCap,
    p_today: today,
  });
  if (error) throw error;
  const row = (data ?? {}) as { allowed?: boolean; remaining?: number };
  // Fail-open on an unexpected shape — never wrongly deny a paid-for photo.
  return { allowed: row.allowed !== false, remaining: row.remaining ?? -1 };
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

const MERGE_SELECT =
  "id, phone, email, password_hash, subscribed_at, email_subscribed_at, free_ads, " +
  "starter_granted_at, offense_count, posting_banned_at, full_blocked_at, " +
  "stripe_customer_id, pic_balance";

interface MergeRow {
  id: string;
  phone: string | null;
  email: string | null;
  password_hash: string | null;
  subscribed_at: string | null;
  email_subscribed_at: string | null;
  free_ads: number;
  starter_granted_at: string | null;
  offense_count: number;
  posting_banned_at: string | null;
  full_blocked_at: string | null;
  stripe_customer_id: string | null;
  pic_balance: number | null;
}

/** Move every users-FK row from one account to another (ads, ledger,
 * messages, offenses) — idempotent, safe to re-run after a partial failure. */
async function reassignUserRows(fromId: string, toId: string): Promise<void> {
  for (const table of ["ads", "credit_ledger", "messages", "offenses"]) {
    const { error } = await db().from(table).update({ user_id: toId }).eq("user_id", fromId);
    if (error) throw error;
  }
}

export async function mergeAccounts(survivorPhone: string, source: string): Promise<MergeOutcome> {
  const { data: a, error: aError } = await db()
    .from("users")
    .select(MERGE_SELECT)
    .eq("phone", survivorPhone)
    .maybeSingle();
  if (aError) throw aError;
  if (!a) return { ok: false, reason: "No account exists for this phone." };
  const survivor = a as unknown as MergeRow;

  const sourcePhone = normalizePhone(source);
  if (sourcePhone) {
    if (sourcePhone === survivorPhone) return { ok: false, reason: "That is this same account." };
    const { data: b, error: bError } = await db()
      .from("users")
      .select(MERGE_SELECT)
      .eq("phone", sourcePhone)
      .maybeSingle();
    if (bError) throw bError;
    if (!b) return { ok: false, reason: `No account exists for ${sourcePhone}.` };
    const loser = b as unknown as MergeRow;

    const [adsMoved, creditEntriesMoved] = await Promise.all([
      db().from("ads").select("id", { count: "exact", head: true }).eq("user_id", loser.id),
      db().from("credit_ledger").select("id", { count: "exact", head: true }).eq("user_id", loser.id),
    ]).then((results) => {
      for (const r of results) if (r.error) throw r.error;
      return results.map((r) => r.count ?? 0);
    });

    // Order matters for crash-safety: (1) move children (idempotent), (2) strip
    // the loser's transferable values so a retry can't double-count, (3) add
    // them to the survivor, (4) delete the loser.
    await reassignUserRows(loser.id, survivor.id);
    const { error: stripError } = await db()
      .from("users")
      .update({ free_ads: 0, offense_count: 0, pic_balance: 0, email: null, stripe_customer_id: null })
      .eq("id", loser.id);
    if (stripError) throw stripError;
    const takeEmail = !survivor.email && loser.email;
    const { error: updateError } = await db()
      .from("users")
      .update({
        free_ads: survivor.free_ads + loser.free_ads,
        offense_count: survivor.offense_count + loser.offense_count,
        pic_balance: (survivor.pic_balance ?? 0) + (loser.pic_balance ?? 0),
        subscribed_at: survivor.subscribed_at ?? loser.subscribed_at,
        starter_granted_at: survivor.starter_granted_at ?? loser.starter_granted_at,
        posting_banned_at: survivor.posting_banned_at ?? loser.posting_banned_at,
        full_blocked_at: survivor.full_blocked_at ?? loser.full_blocked_at,
        stripe_customer_id: survivor.stripe_customer_id ?? loser.stripe_customer_id,
        password_hash: survivor.password_hash ?? loser.password_hash,
        ...(takeEmail && {
          email: loser.email,
          email_subscribed_at: survivor.email_subscribed_at ?? loser.email_subscribed_at,
        }),
      })
      .eq("id", survivor.id);
    if (updateError) throw updateError;
    // The merged-away member id retires for a year (FEATURES item 0). Read it
    // with a dedicated query so the merge itself never depends on migration
    // 0014 — pre-migration this select errors and the retirement is skipped.
    const { data: loserIdRow } = await db()
      .from("users")
      .select("user_id")
      .eq("id", loser.id)
      .maybeSingle();
    const loserUserId = (loserIdRow as { user_id?: string | null } | null)?.user_id ?? null;
    const { error: deleteError } = await db().from("users").delete().eq("id", loser.id);
    if (deleteError) throw deleteError;
    if (loserUserId) {
      const { error: retireError } = await db()
        .from("retired_user_ids")
        .upsert({ user_id: loserUserId, retired_at: new Date().toISOString() });
      if (retireError && !userIdSchemaMissing(retireError)) throw retireError;
    }
    const { error: codesError } = await db()
      .from("verification_codes")
      .delete()
      .eq("phone", sourcePhone);
    if (codesError) throw codesError;
    return { ok: true, kind: "phone", loserPhone: sourcePhone, adsMoved, creditEntriesMoved };
  }

  const key = source.trim().toLowerCase();
  if (!key.includes("@")) {
    return { ok: false, reason: "Enter a 10-digit phone number or an email address." };
  }
  const { data: owner, error: ownerError } = await db()
    .from("users")
    .select(MERGE_SELECT)
    .eq("email", key)
    .maybeSingle();
  if (ownerError) throw ownerError;
  const ownerRow = owner as unknown as MergeRow | null;
  if (ownerRow && ownerRow.id !== survivor.id && ownerRow.phone) {
    return {
      ok: false,
      reason: `That email belongs to the account for ${ownerRow.phone} — merge that phone number instead.`,
    };
  }
  if (survivor.email && survivor.email.toLowerCase() !== key) {
    return {
      ok: false,
      reason: `This account already has ${survivor.email} — replace it first if that's wrong.`,
    };
  }
  let inheritedSubscribedAt: string | null = null;
  if (ownerRow && !ownerRow.phone) {
    // Email-only signup: absorb it — move any stray children, capture the
    // subscription time, delete the row so the unique email frees up.
    inheritedSubscribedAt = ownerRow.email_subscribed_at;
    await reassignUserRows(ownerRow.id, survivor.id);
    const { error: deleteError } = await db().from("users").delete().eq("id", ownerRow.id);
    if (deleteError) throw deleteError;
  }
  const { error: linkError } = await db()
    .from("users")
    .update({
      email: key,
      email_subscribed_at:
        survivor.email_subscribed_at ?? inheritedSubscribedAt ?? new Date().toISOString(),
    })
    .eq("id", survivor.id);
  if (linkError) throw linkError;
  return { ok: true, kind: "email", email: key };
}

export async function listSmsSubscribers(): Promise<SmsSubscriberEntry[]> {
  const rows: SmsSubscriberEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("phone, subscribed_at")
      .not("subscribed_at", "is", null)
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(
      ...(data ?? []).map((r) => ({
        phone: r.phone as string,
        subscribedAt: r.subscribed_at as string,
      })),
    );
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows.sort((a, b) => Date.parse(b.subscribedAt) - Date.parse(a.subscribedAt));
}

export async function listEmailSubscribers(): Promise<EmailSubscriberEntry[]> {
  // Email-only signups also live in users (null phone), so one paged read
  // covers both member emails and email-in subscribers.
  const byEmail = new Map<string, EmailSubscriberEntry>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("email, email_subscribed_at")
      .not("email", "is", null)
      .not("email_subscribed_at", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      const email = (r.email as string).toLowerCase();
      if (!byEmail.has(email)) {
        byEmail.set(email, { email, subscribedAt: (r.email_subscribed_at as string) ?? null });
      }
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return [...byEmail.values()].sort(
    (a, b) => Date.parse(b.subscribedAt ?? "1970") - Date.parse(a.subscribedAt ?? "1970"),
  );
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
    // A PURELY numeric query (phone, with optional spaces/dashes) searches by
    // phone; anything with a letter searches by email. The old test — "any
    // digit -> phone only" — sent alphanumeric queries like "john5" to phone
    // and never matched the email the admin was looking for.
    const numericOnly = digits.length > 0 && digits === needle.replace(/[\s()+-]/g, "");
    query = numericOnly
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
