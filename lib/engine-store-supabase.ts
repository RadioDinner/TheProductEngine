/**
 * Supabase implementation of the engine store (see lib/engine-store.ts).
 * Written against supabase/migrations/0001_init.sql; unexecuted until the
 * project exists.
 */
import { db } from "@/lib/db";
import { AD_TTL_DAYS } from "@/lib/ads";
import type {
  BumpRecord,
  CreateAdOptions,
  MessageRecord,
  NewAdInput,
  StoredAd,
  StoredAdStatus,
} from "@/lib/engine-store";

interface AdRow {
  id: number;
  original_body: string;
  body: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  expires_at: string | null;
  sold_at: string | null;
  flagged: boolean;
  rejected_reason: string | null;
  rejection_kind: string | null;
  users: { phone: string | null } | null;
  ad_photos: { src: string; alt: string | null; width: number | null; height: number | null }[];
  digest_items?: { digest_id: number }[];
}

const AD_SELECT =
  "id, original_body, body, status, created_at, approved_at, expires_at, sold_at, flagged, rejected_reason, rejection_kind, users!inner(phone), ad_photos(src, alt, width, height)";

function toStored(row: AdRow): StoredAd {
  const photo = row.ad_photos?.[0];
  return {
    id: row.id,
    ownerPhone: row.users?.phone ?? "",
    originalBody: row.original_body,
    body: row.body,
    status: row.status as StoredAdStatus,
    createdAt: row.created_at,
    approvedAt: row.approved_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    soldAt: row.sold_at ?? undefined,
    broadcastAt: row.digest_items?.length ? row.created_at : undefined,
    flagged: row.flagged,
    rejectedReason: row.rejected_reason ?? undefined,
    rejectionKind: (row.rejection_kind as StoredAd["rejectionKind"]) ?? undefined,
    ...(photo && {
      photo: {
        src: photo.src,
        alt: photo.alt ?? "",
        width: photo.width ?? 800,
        height: photo.height ?? 600,
      },
    }),
  };
}

async function userIdByPhone(phone: string): Promise<string | null> {
  const { data, error } = await db().from("users").select("id").eq("phone", phone).maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

export async function createAd(input: NewAdInput, options: CreateAdOptions = {}): Promise<number> {
  const userId = await userIdByPhone(input.ownerPhone);
  if (!userId) throw new Error(`no user for phone ${input.ownerPhone}`);
  const { data, error } = await db()
    .from("ads")
    .insert({
      user_id: userId,
      original_body: input.body,
      body: input.body,
      status: options.status ?? "pending",
      flagged: input.flagged,
      ...(options.status === "rejected" && {
        rejected_reason: options.rejectedReason,
        rejection_kind: "violation",
      }),
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = data.id as number;
  if (input.photo) {
    const { error: photoError } = await db().from("ad_photos").insert({
      ad_id: id,
      src: input.photo.src,
      alt: input.photo.alt,
      width: input.photo.width,
      height: input.photo.height,
    });
    if (photoError) throw photoError;
  }
  return id;
}

export async function getAdRecord(id: number): Promise<StoredAd | null> {
  const { data, error } = await db().from("ads").select(AD_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toStored(data as unknown as AdRow) : null;
}

export async function getPendingAds(): Promise<StoredAd[]> {
  const { data, error } = await db()
    .from("ads")
    .select(AD_SELECT)
    .eq("status", "pending")
    .order("flagged", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as AdRow[]).map(toStored);
}

export async function getAllAds(
  q?: string,
  status?: StoredAdStatus,
  limit = 100,
): Promise<StoredAd[]> {
  let query = db().from("ads").select(AD_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (status) query = query.eq("status", status);
  if (q?.trim()) query = query.ilike("body", `%${q.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as AdRow[]).map(toStored);
}

export async function approveAdRecord(
  id: number,
  editedBody?: string,
  ttlDays = AD_TTL_DAYS,
): Promise<void> {
  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  const update: Record<string, unknown> = {
    status: "approved",
    approved_at: approvedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  if (editedBody?.trim()) update.body = editedBody.trim();
  const { error } = await db().from("ads").update(update).eq("id", id).eq("status", "pending");
  if (error) throw error;
}

export async function rejectAdRecord(
  id: number,
  reason: string,
  kind: "benign" | "violation",
): Promise<void> {
  const { error } = await db()
    .from("ads")
    .update({ status: "rejected", rejected_reason: reason, rejection_kind: kind })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}

export async function markAdSold(id: number): Promise<void> {
  const { error } = await db()
    .from("ads")
    .update({ status: "sold", sold_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function reviveAd(id: number, ttlDays = AD_TTL_DAYS): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  const { error } = await db()
    .from("ads")
    .update({ status: "approved", expires_at: expiresAt.toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function queueBump(adId: number): Promise<boolean> {
  const { error } = await db().from("bumps").insert({ ad_id: adId });
  if (error) {
    if (error.code === "23505") return false; // bumps_one_queued_per_ad
    throw error;
  }
  return true;
}

export async function getQueuedBumps(): Promise<BumpRecord[]> {
  const { data, error } = await db()
    .from("bumps")
    .select("id, ad_id, status, requested_at, digest_id")
    .eq("status", "queued")
    .order("requested_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as number,
    adId: row.ad_id as number,
    status: row.status as BumpRecord["status"],
    requestedAt: row.requested_at as string,
    digestId: (row.digest_id as number | null) ?? undefined,
  }));
}

export async function getNewDigestAds(cap: number): Promise<StoredAd[]> {
  // Approved ads that have never appeared in a digest as a "new" item.
  const { data, error } = await db()
    .from("ads")
    .select(`${AD_SELECT}, digest_items(digest_id)`)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(cap * 3);
  if (error) throw error;
  return ((data ?? []) as unknown as AdRow[])
    .filter((row) => !(row.digest_items?.length))
    .slice(0, cap)
    .map(toStored);
}

export async function createDigestIfAbsent(
  slotKey: string,
  slotHour: number,
  channel: "sms" | "email" = "sms",
): Promise<{ id: number; created: boolean }> {
  void slotHour;
  // slotKey ends "#HH" (ET) → canonical scheduled_for used purely as identity.
  const parts = slotKey.split("#");
  const scheduledFor = `${parts[0]}T${parts[parts.length - 1].padStart(2, "0")}:00:00Z`;
  const { data, error } = await db()
    .from("digests")
    .insert({ channel, scheduled_for: scheduledFor })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: selectError } = await db()
        .from("digests")
        .select("id")
        .eq("channel", channel)
        .eq("scheduled_for", scheduledFor)
        .single();
      if (selectError) throw selectError;
      return { id: existing.id as number, created: false };
    }
    throw error;
  }
  return { id: data.id as number, created: true };
}

export async function getLastEmailDigestAt(excludeId: number): Promise<string | null> {
  const { data, error } = await db()
    .from("digests")
    .select("sent_at")
    .eq("channel", "email")
    .neq("id", excludeId)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.sent_at as string | undefined) ?? null;
}

export async function getSmsAdIdsSince(sinceIso: string | null): Promise<number[]> {
  const since = sinceIso ?? "1970-01-01T00:00:00Z";
  // New-ad items live in digest_items; bumps link through bumps.digest_id.
  const { data: items, error: itemsError } = await db()
    .from("digest_items")
    .select("ad_id, digests!inner(channel, sent_at)")
    .eq("digests.channel", "sms")
    .gt("digests.sent_at", since);
  if (itemsError) throw itemsError;
  const { data: bumps, error: bumpsError } = await db()
    .from("bumps")
    .select("ad_id, digests!inner(channel, sent_at)")
    .eq("status", "sent")
    .eq("digests.channel", "sms")
    .gt("digests.sent_at", since);
  if (bumpsError) throw bumpsError;
  const ids = [
    ...(items ?? []).map((r) => r.ad_id as number),
    ...(bumps ?? []).map((r) => r.ad_id as number),
  ];
  return [...new Set(ids)];
}

export async function finalizeDigest(
  digestId: number,
  adIds: number[],
  bumpIds: number[],
  itemCount: number,
  carriedAdIds?: number[],
): Promise<void> {
  void carriedAdIds; // file-store concern; here items/bump links carry the data
  if (adIds.length || bumpIds.length) {
    const items = [
      ...adIds.map((adId, i) => ({ digest_id: digestId, ad_id: adId, kind: "new", position: i })),
    ];
    if (items.length) {
      const { error } = await db().from("digest_items").insert(items);
      if (error) throw error;
    }
    if (bumpIds.length) {
      const { error } = await db()
        .from("bumps")
        .update({ status: "sent", digest_id: digestId })
        .in("id", bumpIds);
      if (error) throw error;
    }
  }
  void itemCount;
  const { error } = await db()
    .from("digests")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", digestId);
  if (error) throw error;
}

export async function digestsSentOnDay(dayKey: string): Promise<number> {
  const { count, error } = await db()
    .from("digests")
    .select("id", { count: "exact", head: true })
    .gte("scheduled_for", `${dayKey}T00:00:00Z`)
    .lte("scheduled_for", `${dayKey}T23:59:59Z`)
    .not("sent_at", "is", null);
  if (error) throw error;
  return count ?? 0;
}

export async function logMessage(rec: Omit<MessageRecord, "id" | "createdAt">): Promise<void> {
  const { error } = await db().from("messages").insert({
    direction: rec.direction,
    channel: rec.channel,
    address: rec.address,
    body: rec.body,
    media: rec.media ?? null,
    digest_id: rec.digestId ?? null,
  });
  if (error) throw error;
}

export async function listMessages(address?: string, limit = 200): Promise<MessageRecord[]> {
  let query = db()
    .from("messages")
    .select("id, direction, channel, address, body, media, digest_id, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (address) query = query.eq("address", address);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as number,
    direction: row.direction as MessageRecord["direction"],
    channel: row.channel as MessageRecord["channel"],
    address: row.address as string,
    body: (row.body as string | null) ?? "",
    media: (row.media as string[] | null) ?? undefined,
    digestId: (row.digest_id as number | null) ?? undefined,
    createdAt: row.created_at as string,
  }));
}

export async function countRecentOutboundContaining(
  address: string,
  needle: string,
  sinceMs: number,
): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await db()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("address", address)
    .gte("created_at", since)
    .ilike("body", `%${needle}%`);
  if (error) throw error;
  return count ?? 0;
}
