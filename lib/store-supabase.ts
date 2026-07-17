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
  type EmailRecipientCategories,
  type EmailSubscriberEntry,
  type ChatMessageView,
  type ChatSummary,
  type ChatThreadView,
  type SendChatResult,
  type LedgerEntry,
  type LedgerSince,
  type MergeOutcome,
  type PicQuotaResult,
  type Profile,
  type RevealSince,
  type RatingSummary,
  type ReportedChatMessage,
  type SmsContext,
  type SmsSubscriberEntry,
  type SubscriberCategories,
  type VerifyCodeResult,
} from "@/lib/store";
import { decideCategoryConfirm, type ConfirmAction } from "@/lib/categories";
import { normalizePhone } from "@/lib/phone";
import { unreadChatCount } from "@/lib/unread";
import { CHAT_PHOTO_CAP } from "@/lib/chat";
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

/** Missing user_id column / retired_user_ids table = migration 9986 not
 * applied yet. The member-id feature stays dormant instead of 500ing (the
 * 9989/9988 drift lesson) — every caller treats null as "no id yet". */
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

/** Missing 9984 tables (sms_contexts / sales / ratings) → feature dormant. */
function ratingsSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

export async function setSmsContext(
  phone: string,
  context: SmsContext,
): Promise<"set" | "unsupported"> {
  const { error } = await db()
    .from("sms_contexts")
    .upsert({
      phone,
      kind: context.kind,
      ad_id: context.adId,
      other_phone: context.otherPhone ?? null,
      rated_role: context.ratedRole ?? null,
      expires_at: context.expiresAt,
    });
  if (error) {
    if (ratingsSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "set";
}

export async function getSmsContext(phone: string): Promise<SmsContext | null> {
  const { data, error } = await db()
    .from("sms_contexts")
    .select("kind, ad_id, other_phone, rated_role, expires_at")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (ratingsSchemaMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  if (Date.parse(data.expires_at as string) <= Date.now()) {
    await db().from("sms_contexts").delete().eq("phone", phone);
    return null;
  }
  return {
    kind: data.kind as SmsContext["kind"],
    adId: data.ad_id as number,
    otherPhone: (data.other_phone as string | null) ?? undefined,
    ratedRole: (data.rated_role as SmsContext["ratedRole"]) ?? undefined,
    expiresAt: data.expires_at as string,
  };
}

export async function clearSmsContext(phone: string): Promise<void> {
  const { error } = await db().from("sms_contexts").delete().eq("phone", phone);
  if (error && !ratingsSchemaMissing(error)) throw error;
}

export async function recordSale(
  adId: number,
  sellerPhone: string,
  buyerPhone: string,
): Promise<"recorded" | "unsupported"> {
  const seller = await userByPhone(sellerPhone);
  const buyer = await userByPhone(buyerPhone);
  if (!seller || !buyer) return "unsupported";
  // Upsert on the ad-id key: the seller can correct a mistyped buyer number.
  const { error } = await db()
    .from("sales")
    .upsert({ ad_id: adId, seller_user_id: seller.id, buyer_user_id: buyer.id });
  if (error) {
    if (ratingsSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "recorded";
}

export async function addRating(
  adId: number,
  raterPhone: string,
  ratedPhone: string,
  ratedRole: "buyer" | "seller",
  stars: number,
): Promise<"added" | "duplicate" | "notconfirmed" | "unsupported"> {
  const rater = await userByPhone(raterPhone);
  const rated = await userByPhone(ratedPhone);
  if (!rater || !rated) return "notconfirmed";
  const { data: sale, error: saleError } = await db()
    .from("sales")
    .select("seller_user_id, buyer_user_id")
    .eq("ad_id", adId)
    .maybeSingle();
  if (saleError) {
    if (ratingsSchemaMissing(saleError)) return "unsupported";
    throw saleError;
  }
  // Confirmed parties only, in the claimed direction.
  const confirmed =
    sale &&
    ((ratedRole === "buyer" && sale.seller_user_id === rater.id && sale.buyer_user_id === rated.id) ||
      (ratedRole === "seller" && sale.buyer_user_id === rater.id && sale.seller_user_id === rated.id));
  if (!confirmed) return "notconfirmed";
  const { error } = await db().from("ratings").insert({
    ad_id: adId,
    rater_user_id: rater.id,
    rated_user_id: rated.id,
    rated_role: ratedRole,
    stars,
  });
  if (error) {
    if (error.code === "23505") return "duplicate";
    if (ratingsSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "added";
}

export async function getRatingSummary(phone: string): Promise<RatingSummary> {
  const empty = { count: 0, average: null };
  const user = await userByPhone(phone);
  if (!user) return { asSeller: empty, asBuyer: empty };
  const { data, error } = await db()
    .from("ratings")
    .select("rated_role, stars")
    .eq("rated_user_id", user.id)
    .limit(PAGE);
  if (error) {
    if (ratingsSchemaMissing(error)) return { asSeller: empty, asBuyer: empty };
    throw error;
  }
  const roll = (role: "buyer" | "seller") => {
    const stars = (data ?? []).filter((r) => r.rated_role === role).map((r) => r.stars as number);
    return {
      count: stars.length,
      average: stars.length
        ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10
        : null,
    };
  };
  return { asSeller: roll("seller"), asBuyer: roll("buyer") };
}

/** Missing 9983 schema (profile columns / chat tables) → feature dormant. */
function chatSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "42703";
}

export async function getProfile(phone: string): Promise<Profile | null> {
  const { data, error } = await db()
    .from("users")
    .select("profile_photo, pickup_address")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (chatSchemaMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  return {
    profilePhoto: (data.profile_photo as string | null) ?? null,
    pickupAddress: (data.pickup_address as string | null) ?? null,
  };
}

export async function setProfile(
  phone: string,
  update: Partial<Profile>,
): Promise<"saved" | "unsupported"> {
  const fields: Record<string, string | null> = {};
  if (update.profilePhoto !== undefined) fields.profile_photo = update.profilePhoto;
  if (update.pickupAddress !== undefined) fields.pickup_address = update.pickupAddress;
  if (!Object.keys(fields).length) return "saved";
  const { error } = await db().from("users").update(fields).eq("phone", phone);
  if (error) {
    if (chatSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "saved";
}

interface ChatRow {
  id: number;
  ad_id: number | null;
  a_user_id: string;
  b_user_id: string;
  last_message_at: string;
}

export async function ensureChat(
  adId: number | null,
  phoneA: string,
  phoneB: string,
): Promise<number | null> {
  const a = await userByPhone(phoneA);
  const b = await userByPhone(phoneB);
  if (!a || !b) return null;
  const [first, second] = [a.id, b.id].sort();
  let query = db()
    .from("chats")
    .select("id")
    .eq("a_user_id", first)
    .eq("b_user_id", second);
  query = adId === null ? query.is("ad_id", null) : query.eq("ad_id", adId);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) {
    if (chatSchemaMissing(findError)) return null;
    throw findError;
  }
  if (existing) return existing.id as number;
  const { data: created, error: insertError } = await db()
    .from("chats")
    .insert({ ad_id: adId, a_user_id: first, b_user_id: second })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      // Concurrent open — the other insert won; read it back.
      const { data: raced } = await query.maybeSingle();
      return (raced?.id as number | undefined) ?? null;
    }
    if (chatSchemaMissing(insertError)) return null;
    throw insertError;
  }
  return created.id as number;
}

/** The chat row, only if this phone's account is one of the two members. */
async function chatForMember(
  chatId: number,
  phone: string,
): Promise<{ chat: ChatRow; userId: string } | null> {
  const user = await userByPhone(phone);
  if (!user) return null;
  const { data, error } = await db()
    .from("chats")
    .select("id, ad_id, a_user_id, b_user_id, last_message_at")
    .eq("id", chatId)
    .maybeSingle();
  if (error) {
    if (chatSchemaMissing(error)) return null;
    throw error;
  }
  const chat = data as ChatRow | null;
  if (!chat || (chat.a_user_id !== user.id && chat.b_user_id !== user.id)) return null;
  return { chat, userId: user.id };
}

export async function listChatsFor(phone: string): Promise<ChatSummary[]> {
  const user = await userByPhone(phone);
  if (!user) return [];
  const { data, error } = await db()
    .from("chats")
    .select("id, ad_id, a_user_id, b_user_id, last_message_at")
    .or(`a_user_id.eq.${user.id},b_user_id.eq.${user.id}`)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (error) {
    if (chatSchemaMissing(error)) return [];
    throw error;
  }
  const chats = (data ?? []) as ChatRow[];
  if (!chats.length) return [];

  const otherIds = [...new Set(chats.map((c) => (c.a_user_id === user.id ? c.b_user_id : c.a_user_id)))];
  const others = new Map<
    string,
    { memberId: string | null; photo: string | null; verified: boolean }
  >();
  // verified_at is migration 9981 — retry without it so the chat list keeps
  // its member ids/photos while that paste is pending.
  const fetchOthers = (columns: string) => db().from("users").select(columns).in("id", otherIds);
  let { data: otherRows, error: othersError } = await fetchOthers(
    "id, user_id, profile_photo, verified_at",
  );
  if (othersError?.code === "42703") {
    ({ data: otherRows, error: othersError } = await fetchOthers("id, user_id, profile_photo"));
  }
  if (!othersError) {
    for (const row of (otherRows ?? []) as unknown as Record<string, unknown>[]) {
      others.set(row.id as string, {
        memberId: (row.user_id as string | null) ?? null,
        photo: (row.profile_photo as string | null) ?? null,
        verified: Boolean(row.verified_at),
      });
    }
  }

  const chatIds = chats.map((c) => c.id);
  const { data: reads } = await db()
    .from("chat_reads")
    .select("chat_id, last_read_message_id")
    .eq("user_id", user.id)
    .in("chat_id", chatIds);
  const readMap = new Map<number, number>(
    (reads ?? []).map((r) => [r.chat_id as number, r.last_read_message_id as number]),
  );
  const { data: lastMsgs } = await db()
    .from("chat_messages")
    .select("chat_id, id, from_user_id")
    .in("chat_id", chatIds)
    .order("id", { ascending: false })
    .limit(500);
  const unreadSet = new Set<number>();
  for (const m of lastMsgs ?? []) {
    const cid = m.chat_id as number;
    if (m.from_user_id !== user.id && (m.id as number) > (readMap.get(cid) ?? 0)) {
      unreadSet.add(cid);
    }
  }

  return chats.map((c) => {
    const otherId = c.a_user_id === user.id ? c.b_user_id : c.a_user_id;
    const other = others.get(otherId);
    return {
      id: c.id,
      adId: c.ad_id,
      otherMemberId: other?.memberId ?? null,
      otherPhoto: other?.photo ?? null,
      otherVerified: other?.verified ?? false,
      lastMessageAt: c.last_message_at,
      unread: unreadSet.has(c.id),
    };
  });
}

/**
 * Lean unread-chat count for the header badge and its ~60s poll (item 12).
 * Deliberately NOT listChatsFor: no other-member profile lookup, chat ids
 * only — userByPhone → chat ids → chat_reads → recent chat_messages.
 * Degrades to 0 when the chat schema (migration 9983) is missing.
 */
export async function countUnreadChats(phone: string): Promise<number> {
  const user = await userByPhone(phone);
  if (!user) return 0;
  const { data: chats, error: chatsError } = await db()
    .from("chats")
    .select("id")
    .or(`a_user_id.eq.${user.id},b_user_id.eq.${user.id}`)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (chatsError) {
    if (chatSchemaMissing(chatsError)) return 0;
    throw chatsError;
  }
  const chatIds = (chats ?? []).map((c) => c.id as number);
  if (!chatIds.length) return 0;

  // Watermark per chat; no chat_reads row = never read (0).
  const lastReadByChat = new Map<number, number>(chatIds.map((id) => [id, 0]));
  const { data: reads, error: readsError } = await db()
    .from("chat_reads")
    .select("chat_id, last_read_message_id")
    .eq("user_id", user.id)
    .in("chat_id", chatIds);
  if (readsError) {
    if (chatSchemaMissing(readsError)) return 0;
    throw readsError;
  }
  for (const r of reads ?? []) {
    lastReadByChat.set(r.chat_id as number, r.last_read_message_id as number);
  }

  const { data: msgs, error: msgsError } = await db()
    .from("chat_messages")
    .select("chat_id, id, from_user_id")
    .in("chat_id", chatIds)
    .order("id", { ascending: false })
    .limit(500);
  if (msgsError) {
    if (chatSchemaMissing(msgsError)) return 0;
    throw msgsError;
  }
  return unreadChatCount(
    (msgs ?? []).map((m) => ({
      chatId: m.chat_id as number,
      id: m.id as number,
      fromOther: m.from_user_id !== user.id,
    })),
    lastReadByChat,
  );
}

export async function getVerifiedAt(phone: string): Promise<string | null> {
  const { data, error } = await db()
    .from("users")
    .select("verified_at")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") return null; // migration 9981 pending
    throw error;
  }
  return (data?.verified_at as string | null) ?? null;
}

export async function setVerified(
  phone: string,
  on: boolean,
): Promise<"saved" | "unsupported"> {
  const { data, error } = await db()
    .from("users")
    .update({ verified_at: on ? new Date().toISOString() : null })
    .eq("phone", phone)
    .select("id");
  if (error) {
    if (error.code === "42703") return "unsupported";
    throw error;
  }
  return data?.length ? "saved" : "unsupported";
}

/** The thread's rows, newest-migration columns first with a 42703 retry so the
 * page keeps working while the 9980 paste is pending. */
async function chatMessageRows(chatId: number): Promise<
  { rows: Record<string, unknown>[] } | { error: { code?: string } }
> {
  const fetchRows = (columns: string) =>
    db()
      .from("chat_messages")
      .select(columns)
      .eq("chat_id", chatId)
      .order("id", { ascending: true })
      .limit(500);
  let { data, error } = await fetchRows(
    "id, from_user_id, body, photo, reported_at, created_at",
  );
  if (error?.code === "42703") {
    ({ data, error } = await fetchRows("id, from_user_id, body, created_at"));
  }
  if (error) return { error };
  return { rows: (data ?? []) as unknown as Record<string, unknown>[] };
}

function toChatMessageView(row: Record<string, unknown>, meUserId: string): ChatMessageView {
  return {
    id: row.id as number,
    mine: row.from_user_id === meUserId,
    body: row.body as string,
    ...(row.photo !== undefined && { photo: (row.photo as string | null) ?? null }),
    reported: Boolean(row.reported_at),
    at: row.created_at as string,
  };
}

export async function listChatMessages(
  chatId: number,
  phone: string,
): Promise<ChatMessageView[] | null> {
  const membership = await chatForMember(chatId, phone);
  if (!membership) return null;
  const result = await chatMessageRows(chatId);
  if ("error" in result) {
    if (chatSchemaMissing(result.error)) return null;
    throw result.error;
  }
  return result.rows.map((m) => toChatMessageView(m, membership.userId));
}

export async function flagChatMessage(
  chatId: number,
  messageId: number,
  byPhone: string,
): Promise<"reported" | "denied" | "unsupported"> {
  const membership = await chatForMember(chatId, byPhone);
  if (!membership) return "denied";
  // Only the other party's messages are reportable; a re-report reopens a
  // resolved one.
  const { data, error } = await db()
    .from("chat_messages")
    .update({
      reported_at: new Date().toISOString(),
      reported_by: membership.userId,
      report_resolved_at: null,
      report_resolution: null,
    })
    .eq("id", messageId)
    .eq("chat_id", chatId)
    .neq("from_user_id", membership.userId)
    .select("id");
  if (error) {
    if (chatSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return data?.length ? "reported" : "denied";
}

export async function listChatReports(): Promise<ReportedChatMessage[]> {
  const { data, error } = await db()
    .from("chat_messages")
    .select("id, chat_id, from_user_id, body, photo, reported_at, reported_by, created_at")
    .not("reported_at", "is", null)
    .is("report_resolved_at", null)
    .order("reported_at", { ascending: false })
    .limit(100);
  if (error) {
    if (chatSchemaMissing(error)) return []; // 9980 pending — queue stays hidden
    throw error;
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];

  const chatIds = [...new Set(rows.map((r) => r.chat_id as number))];
  const { data: chatRows } = await db().from("chats").select("id, ad_id").in("id", chatIds);
  const adByChat = new Map<number, number | null>(
    (chatRows ?? []).map((c) => [c.id as number, (c.ad_id as number | null) ?? null]),
  );

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.from_user_id, r.reported_by]).filter(Boolean)),
  ] as string[];
  // user_id is migration 9986 — retry without it if that paste is pending.
  const fetchUsers = (columns: string) => db().from("users").select(columns).in("id", userIds);
  let { data: userRows, error: usersError } = await fetchUsers("id, phone, user_id");
  if (usersError?.code === "42703") {
    ({ data: userRows, error: usersError } = await fetchUsers("id, phone"));
  }
  const users = new Map<string, { phone: string; memberId: string | null }>();
  if (!usersError) {
    for (const u of (userRows ?? []) as unknown as Record<string, unknown>[]) {
      users.set(u.id as string, {
        phone: (u.phone as string | null) ?? "",
        memberId: (u.user_id as string | null) ?? null,
      });
    }
  }

  return rows.map((r) => ({
    messageId: r.id as number,
    chatId: r.chat_id as number,
    adId: adByChat.get(r.chat_id as number) ?? null,
    body: r.body as string,
    photo: (r.photo as string | null) ?? null,
    at: r.created_at as string,
    reportedAt: r.reported_at as string,
    senderPhone: users.get(r.from_user_id as string)?.phone ?? "",
    senderMemberId: users.get(r.from_user_id as string)?.memberId ?? null,
    reporterPhone: users.get(r.reported_by as string)?.phone ?? "",
  }));
}

export async function resolveChatReport(
  messageId: number,
  resolution: "resolved" | "dismissed",
): Promise<"resolved" | "unsupported"> {
  const { error } = await db()
    .from("chat_messages")
    .update({
      report_resolved_at: new Date().toISOString(),
      report_resolution: resolution,
    })
    .eq("id", messageId);
  if (error) {
    if (chatSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "resolved";
}

/** PostgREST couldn't find the function — migration 9980 not pasted yet. */
function rpcMissing(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export async function sendChatMessage(
  chatId: number,
  fromPhone: string,
  body: string,
  photo?: string | null,
): Promise<SendChatResult> {
  // Fast path (item 15): the whole send — membership check, insert, thread
  // bump, own-read watermark, other-party lookup, audit copy — in ONE round
  // trip via send_chat (migration 9980).
  const { data, error } = await db().rpc("send_chat", {
    p_chat_id: chatId,
    p_phone: fromPhone,
    p_body: body,
    p_photo: photo ?? null,
    p_photo_cap: CHAT_PHOTO_CAP,
  });
  if (!error) {
    const row = (data ?? {}) as {
      outcome?: string;
      id?: number;
      at?: string;
      other_phone?: string;
      other_nudged_at?: string | null;
    };
    if (row.outcome === "sent") {
      return {
        outcome: "sent",
        message: {
          id: row.id ?? 0,
          mine: true,
          body,
          photo: photo ?? null,
          reported: false,
          at: row.at ?? new Date().toISOString(),
        },
        otherPhone: row.other_phone ?? "",
        otherNudgedAt: row.other_nudged_at ?? null,
        audited: true,
        path: "rpc",
      };
    }
    if (row.outcome === "photocap") return { outcome: "photocap" };
    return { outcome: "denied" };
  }
  if (!rpcMissing(error)) {
    if (chatSchemaMissing(error)) return { outcome: "unsupported" };
    throw error;
  }

  // 9980 not applied yet — the original multi-query path.
  const membership = await chatForMember(chatId, fromPhone);
  if (!membership) return { outcome: "denied" };
  const { chat, userId } = membership;
  if (photo) {
    // Per-thread picture cap (item 14). Pre-9980 the photo column doesn't
    // exist — picture sends degrade to "unsupported", text keeps working.
    const { count, error: capError } = await db()
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .not("photo", "is", null);
    if (capError) {
      if (chatSchemaMissing(capError)) return { outcome: "unsupported" };
      throw capError;
    }
    if ((count ?? 0) >= CHAT_PHOTO_CAP) return { outcome: "photocap" };
  }
  const { data: inserted, error: insertError } = await db()
    .from("chat_messages")
    .insert({ chat_id: chatId, from_user_id: userId, body, ...(photo ? { photo } : {}) })
    .select("id, created_at")
    .single();
  if (insertError) {
    if (chatSchemaMissing(insertError)) return { outcome: "unsupported" };
    throw insertError;
  }
  await db().from("chats").update({ last_message_at: new Date().toISOString() }).eq("id", chatId);
  // Your own send marks the thread read for you.
  await db()
    .from("chat_reads")
    .upsert({ chat_id: chatId, user_id: userId, last_read_message_id: inserted.id as number });
  const otherId = chat.a_user_id === userId ? chat.b_user_id : chat.a_user_id;
  const { data: other } = await db().from("users").select("phone").eq("id", otherId).maybeSingle();
  return {
    outcome: "sent",
    message: {
      id: inserted.id as number,
      mine: true,
      body,
      photo: photo ?? null,
      reported: false,
      at: (inserted.created_at as string | null) ?? new Date().toISOString(),
    },
    otherPhone: (other?.phone as string | null) ?? "",
    otherNudgedAt: undefined, // unknown pre-9980 — the nudge falls back to the log scan
    audited: false,
    path: "fallback",
  };
}

/**
 * The thread page's one-stop read (item 15): membership + messages + the
 * OTHER member's header info in ~4 round trips (vs listChatMessages +
 * markChatRead + a full listChatsFor scan ≈ 12), marking the thread read
 * with the newest id it just fetched.
 */
export async function openChatThread(
  chatId: number,
  phone: string,
): Promise<ChatThreadView | null> {
  const membership = await chatForMember(chatId, phone);
  if (!membership) return null;
  const { chat, userId } = membership;
  const otherId = chat.a_user_id === userId ? chat.b_user_id : chat.a_user_id;

  // verified_at is migration 9981 — same retry-without as listChatsFor.
  const fetchOther = (columns: string) =>
    db().from("users").select(columns).eq("id", otherId).maybeSingle();
  const [rowsResult, otherResult] = await Promise.all([
    chatMessageRows(chatId),
    (async () => {
      let { data, error } = await fetchOther("user_id, profile_photo, verified_at");
      if (error?.code === "42703") {
        ({ data, error } = await fetchOther("user_id, profile_photo"));
      }
      return error ? null : ((data as Record<string, unknown> | null) ?? null);
    })(),
  ]);
  if ("error" in rowsResult) {
    if (chatSchemaMissing(rowsResult.error)) return null;
    throw rowsResult.error;
  }
  const messages = rowsResult.rows.map((m) => toChatMessageView(m, userId));
  const last = messages[messages.length - 1];
  if (last) {
    const { error: readError } = await db()
      .from("chat_reads")
      .upsert({ chat_id: chatId, user_id: userId, last_read_message_id: last.id });
    if (readError && !chatSchemaMissing(readError)) throw readError;
  }
  return {
    summary: {
      id: chat.id,
      adId: chat.ad_id,
      otherMemberId: (otherResult?.user_id as string | null) ?? null,
      otherPhoto: (otherResult?.profile_photo as string | null) ?? null,
      otherVerified: Boolean(otherResult?.verified_at),
      lastMessageAt: chat.last_message_at,
      unread: false, // you're reading it right now
    },
    messages,
  };
}

/** Nudge watermark (item 15) — best-effort, a silent no-op before 9980. */
export async function setChatNudgedAt(phone: string): Promise<void> {
  const { error } = await db()
    .from("users")
    .update({ chat_nudged_at: new Date().toISOString() })
    .eq("phone", phone);
  if (error && error.code !== "42703") throw error;
}

export async function markChatRead(chatId: number, phone: string): Promise<void> {
  const membership = await chatForMember(chatId, phone);
  if (!membership) return;
  const { data: last } = await db()
    .from("chat_messages")
    .select("id")
    .eq("chat_id", chatId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return;
  const { error } = await db()
    .from("chat_reads")
    .upsert({ chat_id: chatId, user_id: membership.userId, last_read_message_id: last.id as number });
  if (error && !chatSchemaMissing(error)) throw error;
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

/** Atomically accrue + spend one PIC pull (migration 9989 reserve_pic_quota). */
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

/**
 * Atomically check-log-accrue-spend one number reveal (migration 9979
 * reserve_reveal_quota — item 23). Pre-migration degrade, stated tradeoff:
 * the reveal must never 500, so if the RPC is missing the reveal button
 * still WORKS but unmetered — the quota falls back to a per-request in-memory
 * noop (allow, remaining -1) and the log write silently doesn't happen (no
 * reveal_log yet to write to). Until 9979 is pasted there is no metering, no
 * abuse flagging, and no persistent reveal record — the accepted cost of
 * never breaking the member-facing page on schema drift.
 */
export async function reserveRevealQuota(
  phone: string,
  adId: number,
  dailyAllowance: number,
  bankCap: number,
  today: string,
): Promise<PicQuotaResult> {
  try {
    const { data, error } = await db().rpc("reserve_reveal_quota", {
      p_phone: phone,
      p_ad_id: adId,
      p_daily: dailyAllowance,
      p_cap: bankCap,
      p_today: today,
    });
    if (error) throw error;
    const row = (data ?? {}) as { allowed?: boolean; remaining?: number };
    // Fail-open on an unexpected shape — never wrongly lock a member out.
    return { allowed: row.allowed !== false, remaining: row.remaining ?? -1 };
  } catch (e) {
    console.error("[reveal] reserve_reveal_quota failed (migration 9979 pasted?):", e);
    return { allowed: true, remaining: -1 };
  }
}

/**
 * Persistent already-revealed check (reveal_log, migration 9979).
 * "unsupported" = table missing — the ad page then honors the just-revealed
 * redirect param instead (matching the unmetered pre-migration degrade above).
 */
export async function hasRevealed(
  phone: string,
  adId: number,
): Promise<boolean | "unsupported"> {
  const { data, error } = await db()
    .from("reveal_log")
    .select("id")
    .eq("phone", phone)
    .eq("ad_id", adId)
    .limit(1);
  if (error) return "unsupported";
  return (data ?? []).length > 0;
}

/** Reveal-log rows since an instant, newest first (bounded) — for Insights. */
export async function listRevealsSince(since: string): Promise<RevealSince[]> {
  const { data, error } = await db()
    .from("reveal_log")
    .select("phone, ad_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return []; // pre-9979: the Insights block simply shows empty
  return (data ?? []).map((row) => ({
    phone: row.phone as string,
    adId: Number(row.ad_id),
    at: row.created_at as string,
  }));
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
  // Ratings/sales (migration 9984) reference users too — they must follow the
  // merge or the loser's delete hits their FKs. Absent pre-migration: skipped.
  for (const [table, column] of [
    ["sales", "seller_user_id"],
    ["sales", "buyer_user_id"],
    ["ratings", "rater_user_id"],
    ["ratings", "rated_user_id"],
    ["chats", "a_user_id"],
    ["chats", "b_user_id"],
    ["chat_messages", "from_user_id"],
    ["chat_reads", "user_id"],
  ] as const) {
    const { error } = await db().from(table).update({ [column]: toId }).eq(column, fromId);
    if (error?.code === "23505") {
      // A uniqueness collision (both accounts rated the same ad; both chatted
      // with the same person; duplicate read rows): the survivor's row stands
      // and the loser's duplicate is dropped.
      const { error: dropError } = await db().from(table).delete().eq(column, fromId);
      if (dropError) throw dropError;
    } else if (error && error.code !== "42P01") {
      throw error;
    }
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
    // 9986 — pre-migration this select errors and the retirement is skipped.
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

// ---------- categories (items 22/24, migration 9976) ----------

/** Missing categories / throttle columns = migration 9976 not applied yet —
 * the category system stays dormant instead of 500ing (the 9989/9988 lesson). */
function categoriesSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

export async function getSubscriberCategories(
  phone: string,
): Promise<string[] | null | "unsupported"> {
  const { data, error } = await db()
    .from("users")
    .select("categories")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (categoriesSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return ((data?.categories as string[] | null | undefined) ?? null);
}

export async function setSubscriberCategories(
  phone: string,
  categories: string[] | null,
): Promise<"saved" | "unsupported"> {
  const { error } = await db().from("users").update({ categories }).eq("phone", phone);
  if (error) {
    if (categoriesSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "saved";
}

export async function reserveCategoryConfirm(
  phone: string,
  limit: number,
): Promise<ConfirmAction> {
  // Read-modify-write on the watermark + counter columns (migration 9976).
  // A lost race costs at most one extra confirmation SMS, still bounded by
  // reserve_sms — never a wrong toggle (state is written elsewhere).
  const { data, error } = await db()
    .from("users")
    .select("id, category_confirm_window_start, category_confirm_count")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    if (categoriesSchemaMissing(error)) return "confirm";
    throw error;
  }
  if (!data) return "confirm";
  const decided = decideCategoryConfirm(
    {
      windowStartMs: data.category_confirm_window_start
        ? Date.parse(data.category_confirm_window_start as string)
        : null,
      count: (data.category_confirm_count as number | null) ?? 0,
    },
    Date.now(),
    limit,
  );
  const { error: writeError } = await db()
    .from("users")
    .update({
      category_confirm_window_start:
        decided.state.windowStartMs === null
          ? null
          : new Date(decided.state.windowStartMs).toISOString(),
      category_confirm_count: decided.state.count,
    })
    .eq("id", data.id as string);
  if (writeError) throw writeError;
  return decided.action;
}

export async function listSubscribersWithCategories(): Promise<SubscriberCategories[]> {
  const rows: SubscriberCategories[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("phone, categories")
      .not("subscribed_at", "is", null)
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      // Pre-9976: every subscriber reads as ALL — digests exactly as today.
      if (categoriesSchemaMissing(error)) {
        return (await listSubscriberPhones()).map((phone) => ({ phone, categories: null }));
      }
      throw error;
    }
    for (const row of data ?? []) {
      rows.push({
        phone: row.phone as string,
        categories: (row.categories as string[] | null) ?? null,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function listEmailRecipientsWithCategories(): Promise<
  EmailRecipientCategories[]
> {
  const rows = new Map<string, EmailRecipientCategories>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("users")
      .select("email, categories")
      .not("email", "is", null)
      .not("email_subscribed_at", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      if (categoriesSchemaMissing(error)) {
        return (await listEmailRecipients()).map((email) => ({ email, categories: null }));
      }
      throw error;
    }
    for (const row of data ?? []) {
      const email = (row.email as string).toLowerCase();
      if (!rows.has(email)) {
        rows.set(email, { email, categories: (row.categories as string[] | null) ?? null });
      }
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return [...rows.values()];
}

// Once the migration is seen applied it can't un-apply — cache the positive
// probe so per-request UI gating (homepage, /account) costs one query ever.
let categoriesProbedTrue = false;

export async function categoriesSupported(): Promise<boolean> {
  if (categoriesProbedTrue) return true;
  const { error } = await db()
    .from("users")
    .select("categories", { count: "exact", head: true });
  if (error) {
    if (categoriesSchemaMissing(error)) return false;
    throw error;
  }
  categoriesProbedTrue = true;
  return true;
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
  // A duplicate ref (unique index, migration 9997) means this grant was
  // already recorded by a concurrent/replayed webhook — idempotent, not an
  // error.
  if (error && error.code !== "23505") throw error;
}

/** Atomically debit credits if the balance covers it (migration 9995). */
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
  // Atomic check-and-burn under a row lock (migration 9991). The old
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
