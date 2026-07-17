/**
 * Supabase implementation of the engine store (see lib/engine-store.ts).
 * Written against supabase/migrations/9999_init.sql; unexecuted until the
 * project exists.
 */
import { db } from "@/lib/db";
import { AD_TTL_DAYS } from "@/lib/ads";
import { isPicReplaceSubmission } from "@/lib/myads";
import { removeHostedPhotos } from "@/lib/photos";
import type {
  BumpRecord,
  CreateAdOptions,
  DigestRecord,
  InsightAd,
  InsightBump,
  InsightMessage,
  MessageRecord,
  NewAdInput,
  OutboxInsert,
  OutboxRow,
  PhotoSubmission,
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
  broadcast_at?: string | null;
  users: { phone: string | null } | null;
  ad_photos: {
    src: string;
    alt: string | null;
    width: number | null;
    height: number | null;
    position: number;
  }[];
}

// broadcast_at is deliberately NOT selected here. It's only needed by the
// digest builder (getNewDigestAds filters on it), and keeping it out of the
// shared reader means the admin queue and SMS ad-reads don't hard-depend on
// migration 9993 — a code deploy that lands before the migration degrades to
// "digests wait" (the cron fails loudly) instead of taking down /admin.
const AD_SELECT =
  "id, original_body, body, status, created_at, approved_at, expires_at, sold_at, flagged, rejected_reason, rejection_kind, users!inner(phone), ad_photos(src, alt, width, height, position)";

/** PostgREST silently caps un-ranged selects at ~1000 rows — page past it. */
const PAGE = 1000;

function toStored(row: AdRow): StoredAd {
  // Position 0 is THE ad picture (the one MMS/PIC/digests carry); higher
  // positions are approved emailed-in extras — website gallery only.
  const sorted = [...(row.ad_photos ?? [])].sort((a, b) => a.position - b.position);
  const photo = sorted.find((p) => p.position === 0);
  const extras = sorted.filter((p) => p.position > 0);
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
    broadcastAt: row.broadcast_at ?? undefined,
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
    ...(extras.length && {
      morePhotos: extras.map((p) => ({
        src: p.src,
        alt: p.alt ?? "",
        width: p.width ?? 800,
        height: p.height ?? 600,
      })),
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
  // Paged: a backlog over 1000 must not silently hide the newest
  // charged-but-unreviewed ads from the moderation queue.
  const rows: AdRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("ads")
      .select(AD_SELECT)
      .eq("status", "pending")
      .order("flagged", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as AdRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows.map(toStored);
}

export async function getAllAds(
  q?: string,
  status?: StoredAdStatus,
  limit = 100,
): Promise<StoredAd[]> {
  let query = db().from("ads").select(AD_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (status) query = query.eq("status", status);
  if (q?.trim()) {
    const needle = q.trim();
    const asId = Number(needle);
    // Match the ad NUMBER too (file-store parity): admins search "1042" to find
    // ad #1042. Only take the id branch for a pure-integer needle, so the value
    // interpolated into the .or() filter is digits-only (no PostgREST injection).
    if (Number.isSafeInteger(asId) && asId > 0 && String(asId) === needle) {
      query = query.or(`body.ilike.%${needle}%,id.eq.${asId}`);
    } else {
      query = query.ilike("body", `%${needle}%`);
    }
  }
  const { data, error } = await query;
  if (error) {
    // The admin filtered by 'deleted' before migration 9987 was pasted: the
    // enum value doesn't exist yet (22P02). An empty list, not a 500.
    if (status === "deleted" && error.code === "22P02") return [];
    throw error;
  }
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

/** Returns true only if THIS call transitioned the ad pending -> rejected. */
export async function rejectAdRecord(
  id: number,
  reason: string,
  kind: "benign" | "violation",
): Promise<boolean> {
  const { data, error } = await db()
    .from("ads")
    .update({ status: "rejected", rejected_reason: reason, rejection_kind: kind })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function updateAdBody(id: number, body: string): Promise<boolean> {
  const { data, error } = await db().from("ads").update({ body }).eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function markAdSold(id: number): Promise<void> {
  // Defense in depth: only a live listing can be sold, so SOLD can never
  // publish a pending/unreviewed (or resurrect a rejected) ad even if a
  // future caller skips the engine's status check.
  const { error } = await db()
    .from("ads")
    .update({ status: "sold", sold_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["approved", "expired"]);
  if (error) throw error;
}

export async function reviveAd(id: number, ttlDays = AD_TTL_DAYS): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  // Only an expired ad is revived (the bump-an-expired-ad path); the status
  // guard keeps a stray call from reactivating a pending/rejected/sold ad.
  const { error } = await db()
    .from("ads")
    .update({ status: "approved", expires_at: expiresAt.toISOString() })
    .eq("id", id)
    .eq("status", "expired");
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
  // Approved ads that have never ridden their included broadcast. Keyed on the
  // broadcast_at column (migration 9993) so the queue is an O(cap) indexed
  // read — the old "cap*3 oldest, filter client-side" scan silently starved
  // new paid ads once already-broadcast approved ads outnumbered the window.
  // Admin holds ("skip next digest", migration 9988) exclude an ad until the
  // hold passes.
  const { data, error } = await db()
    .from("ads")
    .select(AD_SELECT)
    .eq("status", "approved")
    .is("broadcast_at", null)
    .or(`hold_until.is.null,hold_until.lte.${new Date().toISOString()}`)
    .order("approved_at", { ascending: true })
    .limit(cap);
  if (error) throw error;
  return ((data ?? []) as unknown as AdRow[]).map(toStored);
}

export async function listHeldNewAds(): Promise<StoredAd[]> {
  const { data, error } = await db()
    .from("ads")
    .select(`${AD_SELECT}, hold_until`)
    .eq("status", "approved")
    .is("broadcast_at", null)
    .gt("hold_until", new Date().toISOString())
    .order("id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as (AdRow & { hold_until: string | null })[]).map((row) => ({
    ...toStored(row),
    holdUntil: row.hold_until,
  }));
}

export async function setAdHold(id: number, untilIso: string | null): Promise<void> {
  const { error } = await db().from("ads").update({ hold_until: untilIso }).eq("id", id);
  if (error) throw error;
}

export async function swapAdApprovalOrder(idA: number, idB: number): Promise<void> {
  const { data, error } = await db()
    .from("ads")
    .select("id, approved_at")
    .in("id", [idA, idB]);
  if (error) throw error;
  const a = data?.find((r) => r.id === idA);
  const b = data?.find((r) => r.id === idB);
  if (!a || !b) return;
  const { error: e1 } = await db().from("ads").update({ approved_at: b.approved_at }).eq("id", idA);
  if (e1) throw e1;
  const { error: e2 } = await db().from("ads").update({ approved_at: a.approved_at }).eq("id", idB);
  if (e2) throw e2;
}

export async function revertAdToPending(id: number): Promise<boolean> {
  // Only a still-queued ad (approved, never broadcast) goes back to review.
  const { data, error } = await db()
    .from("ads")
    .update({ status: "pending", hold_until: null })
    .eq("id", id)
    .eq("status", "approved")
    .is("broadcast_at", null)
    .select("id");
  if (error) throw error;
  const transitioned = (data?.length ?? 0) > 0;
  if (transitioned) {
    const { error: bumpError } = await db()
      .from("bumps")
      .delete()
      .eq("ad_id", id)
      .eq("status", "queued");
    if (bumpError) throw bumpError;
  }
  return transitioned;
}

/**
 * Admin deletion (soft, migration 9987). Order matters for crash-safety: the
 * status flip comes FIRST (the authoritative act — the ad is off the site the
 * moment it lands), then the child cleanup; a crash mid-cleanup leaves only
 * already-orphanable leftovers (a queued bump the digest selector skips, a
 * storage object nothing links to), never a live ad in a broken state.
 * A hard DELETE is impossible anyway: digest_items references ads(id) with no
 * cascade — past digests are history and stay intact.
 */
export async function deleteAdRecord(id: number): Promise<"deleted" | "noop" | "unsupported"> {
  const { data, error } = await db()
    .from("ads")
    .update({ status: "deleted", deleted_at: new Date().toISOString(), hold_until: null })
    .eq("id", id)
    .neq("status", "deleted")
    .select("id");
  if (error) {
    // 22P02 = 'deleted' isn't a valid ad_status value yet — migration 9987
    // hasn't been pasted. Degrade to a report instead of 500ing the action
    // (the 9989/9988 migration races both took down whole surfaces this way).
    if (error.code === "22P02" && /ad_status|enum/i.test(error.message)) return "unsupported";
    throw error;
  }
  if ((data?.length ?? 0) === 0) return "noop";

  const { error: bumpError } = await db()
    .from("bumps")
    .delete()
    .eq("ad_id", id)
    .eq("status", "queued");
  if (bumpError) throw bumpError;

  const { data: photos, error: photoReadError } = await db()
    .from("ad_photos")
    .select("src")
    .eq("ad_id", id);
  if (photoReadError) throw photoReadError;
  if (photos?.length) {
    await removeHostedPhotos(photos.map((p) => p.src as string));
    const { error: photoDeleteError } = await db().from("ad_photos").delete().eq("ad_id", id);
    if (photoDeleteError) throw photoDeleteError;
  }
  // Pending emailed-in pictures for the ad go too (row + storage object).
  const { data: submissions, error: subError } = await db()
    .from("ad_photo_submissions")
    .select("src")
    .eq("ad_id", id);
  if (!subError && submissions?.length) {
    await removeHostedPhotos(submissions.map((s) => s.src as string));
    await db().from("ad_photo_submissions").delete().eq("ad_id", id);
  }
  return "deleted";
}

/** Missing ad_photo_submissions table = migration 9985 not applied yet; the
 * emailed-pictures feature stays dormant instead of erroring. */
function submissionsSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

export async function addPhotoSubmission(
  adId: number,
  src: string,
  fromEmail: string,
): Promise<"added" | "unsupported"> {
  const { error } = await db()
    .from("ad_photo_submissions")
    .insert({ ad_id: adId, src, from_email: fromEmail });
  if (error) {
    if (submissionsSchemaMissing(error)) return "unsupported";
    throw error;
  }
  return "added";
}

export async function listPhotoSubmissions(): Promise<PhotoSubmission[]> {
  const { data, error } = await db()
    .from("ad_photo_submissions")
    .select("id, ad_id, src, from_email, created_at")
    .order("id", { ascending: true });
  if (error) {
    if (submissionsSchemaMissing(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id as number,
    adId: row.ad_id as number,
    src: row.src as string,
    fromEmail: row.from_email as string,
    createdAt: row.created_at as string,
  }));
}

/** broadcast_at for one ad — the member-delete refund matrix's input. A
 * missing column (migration 9993 unapplied) means no digest ever marked
 * anything broadcast, so it truthfully reads as "never". */
export async function adEverBroadcast(id: number): Promise<boolean> {
  const { data, error } = await db()
    .from("ads")
    .select("broadcast_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") return false;
    throw error;
  }
  return Boolean((data as { broadcast_at?: string | null } | null)?.broadcast_at);
}

/** Migration-9985 probe: false hides the picture actions instead of 500ing. */
export async function photoSubmissionsSupported(): Promise<boolean> {
  const { error } = await db()
    .from("ad_photo_submissions")
    .select("id", { count: "exact", head: true });
  if (error) {
    if (submissionsSchemaMissing(error)) return false;
    throw error;
  }
  return true;
}

export async function countAdPhotos(adId: number): Promise<number> {
  const { count: live, error: liveError } = await db()
    .from("ad_photos")
    .select("id", { count: "exact", head: true })
    .eq("ad_id", adId);
  if (liveError) throw liveError;
  const { count: pending, error: pendingError } = await db()
    .from("ad_photo_submissions")
    .select("id", { count: "exact", head: true })
    .eq("ad_id", adId);
  if (pendingError && !submissionsSchemaMissing(pendingError)) throw pendingError;
  return (live ?? 0) + (pending ?? 0);
}

export async function resolvePhotoSubmission(
  id: number,
  approve: boolean,
): Promise<PhotoSubmission | null> {
  const { data, error } = await db()
    .from("ad_photo_submissions")
    .select("id, ad_id, src, from_email, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (submissionsSchemaMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  const submission: PhotoSubmission = {
    id: data.id as number,
    adId: data.ad_id as number,
    src: data.src as string,
    fromEmail: data.from_email as string,
    createdAt: data.created_at as string,
  };
  // Delete-first makes a double-submit resolve exactly once (0 rows = lost).
  const { data: deleted, error: deleteError } = await db()
    .from("ad_photo_submissions")
    .delete()
    .eq("id", id)
    .select("id");
  if (deleteError) throw deleteError;
  if (!deleted?.length) return null;
  if (!approve) {
    await removeHostedPhotos([submission.src]);
    return submission;
  }
  if (isPicReplaceSubmission(submission.fromEmail)) {
    // FEATURES item 16: an approved REPLACEMENT swaps the position-0
    // (digest/PIC) picture in place; the old storage object is removed after
    // the row points at the new one, so a crash never leaves a broken image.
    const { data: existing, error: existingError } = await db()
      .from("ad_photos")
      .select("id, src")
      .eq("ad_id", submission.adId)
      .eq("position", 0)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      const { error: updateError } = await db()
        .from("ad_photos")
        .update({ src: submission.src })
        .eq("id", existing.id);
      if (updateError) throw updateError;
      if (existing.src !== submission.src) {
        await removeHostedPhotos([existing.src as string]);
      }
    } else {
      // The paid picture disappeared meanwhile (rare); the admin still
      // explicitly approved this image as THE listing picture — install it.
      const { error: insertError } = await db().from("ad_photos").insert({
        ad_id: submission.adId,
        src: submission.src,
        alt: `Ad #${submission.adId}`,
        position: 0,
      });
      if (insertError) throw insertError;
    }
    return submission;
  }
  // Approved extras live at position 1+ — position 0 stays reserved for the
  // MMS picture the seller paid for (SMS/PIC/digests read only position 0).
  const { data: positions, error: posError } = await db()
    .from("ad_photos")
    .select("position")
    .eq("ad_id", submission.adId)
    .order("position", { ascending: false })
    .limit(1);
  if (posError) throw posError;
  const next = Math.max(0, ...(positions ?? []).map((p) => p.position as number)) + 1;
  const { error: insertError } = await db().from("ad_photos").insert({
    ad_id: submission.adId,
    src: submission.src,
    alt: `More of ad #${submission.adId}`,
    position: next,
  });
  if (insertError) throw insertError;
  return submission;
}

export async function createExtraDigest(channel: "sms" | "email", now: Date): Promise<number> {
  // scheduled_for doubles as the digest's unique identity: the exact instant
  // makes an extra edition collide with nothing (slots use whole hours).
  const { data, error } = await db()
    .from("digests")
    .insert({ channel, scheduled_for: now.toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function finalizeExtraDigest(
  digestId: number,
  adIds: number[],
  itemCount: number,
): Promise<void> {
  // An EXTRA edition records what it carried but consumes NOTHING: no
  // broadcast_at marking, no bump transitions — the queue rides again at the
  // next regular slot. digest_items rows keep catch-up/history correct.
  if (adIds.length) {
    const items = adIds.map((adId, i) => ({
      digest_id: digestId,
      ad_id: adId,
      kind: "new",
      position: i,
    }));
    const { error } = await db()
      .from("digest_items")
      .upsert(items, { onConflict: "digest_id,ad_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  const { error } = await db()
    .from("digests")
    .update({ sent_at: new Date().toISOString(), item_count: itemCount })
    .eq("id", digestId);
  if (error) throw error;
}

export async function expireDueAds(): Promise<number> {
  // Production parity with the file store's lazy sweep (engine-store.ts:213):
  // flip approved ads past their expiry window to 'expired'. Without this the
  // Supabase store never expires anything, so the public site lists ads forever
  // and the SOLD/BUMP-revive branches (which need the 'expired' state) are dead.
  const { data, error } = await db()
    .from("ads")
    .update({ status: "expired" })
    .eq("status", "approved")
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function createDigestIfAbsent(
  slotKey: string,
  slotHour: number,
  channel: "sms" | "email" = "sms",
): Promise<{ id: number; created: boolean; finalized: boolean }> {
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
        .select("id, sent_at")
        .eq("channel", channel)
        .eq("scheduled_for", scheduledFor)
        .single();
      if (selectError) throw selectError;
      // finalized=false means a previous run died between compose and
      // finalize — the caller re-runs the (idempotent) enqueue to recover.
      return {
        id: existing.id as number,
        created: false,
        finalized: existing.sent_at != null,
      };
    }
    throw error;
  }
  return { id: data.id as number, created: true, finalized: false };
}

export async function getSmsDigestAdIds(slotKey: string): Promise<number[] | null> {
  // slotKey is "day#hour"; the table's slot identity is the canonical
  // scheduled_for that createDigestIfAbsent writes for it.
  const parts = slotKey.split("#");
  const scheduledFor = `${parts[0]}T${parts[parts.length - 1].padStart(2, "0")}:00:00Z`;
  const { data: digest, error } = await db()
    .from("digests")
    .select("id, sent_at")
    .eq("channel", "sms")
    .eq("scheduled_for", scheduledFor)
    .maybeSingle();
  if (error) throw error;
  if (!digest?.sent_at) return null; // not composed yet — the email edition waits
  const digestId = digest.id as number;
  // A digest carries at most digestCap (≤15) items — no paging needed.
  const [{ data: items, error: itemsError }, { data: bumps, error: bumpsError }] =
    await Promise.all([
      db().from("digest_items").select("ad_id").eq("digest_id", digestId),
      db().from("bumps").select("ad_id").eq("digest_id", digestId).eq("status", "sent"),
    ]);
  if (itemsError) throw itemsError;
  if (bumpsError) throw bumpsError;
  const ids = new Set<number>();
  for (const r of items ?? []) ids.add(r.ad_id as number);
  for (const r of bumps ?? []) ids.add(r.ad_id as number);
  return [...ids];
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
      // Idempotent on (digest_id, ad_id): if finalize partially failed and the
      // slot re-runs, re-inserting the same items must be a no-op, not a PK
      // violation that would wedge the slot un-finalized forever.
      const { error } = await db()
        .from("digest_items")
        .upsert(items, { onConflict: "digest_id,ad_id", ignoreDuplicates: true });
      if (error) throw error;
      // Mark these ads broadcast so getNewDigestAds never re-queues them
      // (migration 9993). Guard on is-null so a bump re-broadcast can't
      // reset the original broadcast time.
      const { error: broadcastError } = await db()
        .from("ads")
        .update({ broadcast_at: new Date().toISOString() })
        .in("id", adIds)
        .is("broadcast_at", null);
      if (broadcastError) throw broadcastError;
    }
    if (bumpIds.length) {
      const { error } = await db()
        .from("bumps")
        .update({ status: "sent", digest_id: digestId })
        .in("id", bumpIds);
      if (error) throw error;
    }
  }
  const { error } = await db()
    .from("digests")
    .update({ sent_at: new Date().toISOString(), item_count: itemCount })
    .eq("id", digestId);
  if (error) throw error;
}

export async function listRecentDigests(limit: number): Promise<DigestRecord[]> {
  // The table has no slot_key/slot_hour columns — the slot identity lives in
  // scheduled_for, written by createDigestIfAbsent as "<day>T<HH>:00:00Z"
  // (canonical ET identity, not a real instant). Derive both back from it.
  // digest_no (migration 9982) is fetched with a fallback so this page never
  // 500s while the migration is pending (the e50f73d lesson).
  const fetchRecent = (columns: string) =>
    db()
      .from("digests")
      .select(columns)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
  let { data, error } = await fetchRecent(
    "id, channel, scheduled_for, item_count, sent_at, created_at, digest_no",
  );
  if (error?.code === "42703") {
    ({ data, error } = await fetchRecent(
      "id, channel, scheduled_for, item_count, sent_at, created_at",
    ));
  }
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const scheduled = String(row.scheduled_for ?? "");
    const day = scheduled.slice(0, 10);
    const hour = Number(scheduled.slice(11, 13));
    // Slot digests are written with a whole-hour identity; anything with
    // minutes/seconds is an admin "extra" edition — label it as such.
    const isExtra = scheduled.slice(14, 19) !== "00:00" && scheduled.length >= 19;
    return {
      id: row.id as number,
      channel: row.channel as DigestRecord["channel"],
      slotKey: isExtra
        ? `${day}#extra#${scheduled.slice(11, 16)}`
        : `${day}#${Number.isFinite(hour) ? hour : "?"}`,
      slotHour: Number.isFinite(hour) ? hour : 0,
      itemCount: (row.item_count as number | null) ?? 0,
      digestNo: (row.digest_no as number | null) ?? null,
      sentAt: (row.sent_at as string | null) ?? undefined,
      createdAt: row.created_at as string,
    };
  });
}

/** Missing digest_no column = migration 9982 pending; numbering dormant. */
function digestNoSchemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

export async function allocateDigestNumber(digestId: number): Promise<number | null> {
  const { data: existing, error: readError } = await db()
    .from("digests")
    .select("digest_no")
    .eq("id", digestId)
    .maybeSingle();
  if (readError) {
    if (digestNoSchemaMissing(readError)) return null;
    throw readError;
  }
  if (!existing) return null;
  if (existing.digest_no) return existing.digest_no as number; // idempotent on retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: top, error: maxError } = await db()
      .from("digests")
      .select("digest_no")
      .not("digest_no", "is", null)
      .order("digest_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;
    const next = ((top?.digest_no as number | undefined) ?? 0) + 1;
    const { data: updated, error: writeError } = await db()
      .from("digests")
      .update({ digest_no: next })
      .eq("id", digestId)
      .is("digest_no", null)
      .select("digest_no");
    if (writeError) {
      if (writeError.code === "23505") continue; // a concurrent send took this number
      throw writeError;
    }
    if (updated?.length) return next;
    // 0 rows: another run numbered this digest — read what it got.
    const { data: raced } = await db()
      .from("digests")
      .select("digest_no")
      .eq("id", digestId)
      .maybeSingle();
    return (raced?.digest_no as number | null) ?? null;
  }
  console.error("[digest-no] could not allocate a number after 5 attempts");
  return null;
}

export async function getSmsDigestNumber(slotKey: string): Promise<number | null> {
  const parts = slotKey.split("#");
  const scheduledFor = `${parts[0]}T${parts[parts.length - 1].padStart(2, "0")}:00:00Z`;
  const { data, error } = await db()
    .from("digests")
    .select("digest_no")
    .eq("channel", "sms")
    .eq("scheduled_for", scheduledFor)
    .maybeSingle();
  if (error) {
    if (digestNoSchemaMissing(error)) return null;
    throw error;
  }
  return (data?.digest_no as number | null) ?? null;
}

export async function getRecentDigestAdIds(): Promise<number[]> {
  const { data: digest, error } = await db()
    .from("digests")
    .select("id")
    .eq("channel", "sms")
    .not("sent_at", "is", null)
    .gt("item_count", 0)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!digest) return [];
  const digestId = digest.id as number;
  const [{ data: items, error: itemsError }, { data: bumps, error: bumpsError }] =
    await Promise.all([
      db().from("digest_items").select("ad_id").eq("digest_id", digestId),
      db().from("bumps").select("ad_id").eq("digest_id", digestId).eq("status", "sent"),
    ]);
  if (itemsError) throw itemsError;
  if (bumpsError) throw bumpsError;
  const ids = [
    ...(items ?? []).map((r) => r.ad_id as number),
    ...(bumps ?? []).map((r) => r.ad_id as number),
  ];
  return [...new Set(ids)];
}

export async function digestsSentOnDay(dayKey: string): Promise<number> {
  // SMS digests with items only (item_count, migration 9994) — matches the
  // file store, so an empty slot or the email edition can't suppress the
  // Reply-STOP footer on the day's first real SMS digest.
  const { count, error } = await db()
    .from("digests")
    .select("id", { count: "exact", head: true })
    .eq("channel", "sms")
    .gte("scheduled_for", `${dayKey}T00:00:00Z`)
    .lte("scheduled_for", `${dayKey}T23:59:59Z`)
    .not("sent_at", "is", null)
    .gt("item_count", 0);
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
    provider_id: rec.providerId ?? null,
    digest_id: rec.digestId ?? null,
  });
  if (error) throw error;
}

/** Inbound dedup: has a message with this Telnyx provider id already landed? */
export async function seenInboundProviderId(providerId: string): Promise<boolean> {
  const { count, error } = await db()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", providerId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Record an inbound message, returning false if it's a duplicate provider id.
 * The unique index (migration 9995) makes this race-safe: a concurrent retry
 * loses the INSERT with 23505, so the caller drops it before re-processing.
 */
export async function recordInboundOnce(
  rec: Omit<MessageRecord, "id" | "createdAt">,
): Promise<boolean> {
  const { error } = await db().from("messages").insert({
    direction: rec.direction,
    channel: rec.channel,
    address: rec.address,
    body: rec.body,
    media: rec.media ?? null,
    provider_id: rec.providerId ?? null,
    digest_id: rec.digestId ?? null,
  });
  if (error) {
    if (error.code === "23505") return false; // duplicate provider id — already handled
    throw error;
  }
  return true;
}

/** Atomically reserve one command-reply slot; false if a cap is hit. */
export async function reserveSms(
  address: string,
  kind: "reply" | "pic",
  perNumber: number,
  global: number,
  perNumberPic: number,
  windowMs: number,
): Promise<boolean> {
  const { data, error } = await db().rpc("reserve_sms", {
    p_address: address,
    p_kind: kind,
    p_per_number: perNumber,
    p_global: global,
    p_per_number_pic: perNumberPic,
    p_window_s: Math.round(windowMs / 1000),
  });
  if (error) throw error;
  return data === true;
}

export async function listMessages(address?: string, limit = 200): Promise<MessageRecord[]> {
  // The NEWEST `limit` messages, returned oldest-first — parity with the file
  // store's `slice(-limit)`. Ascending+limit returned the OLDEST N instead, so
  // callers that scan from the end for recent activity (handleConfirmPurchase's
  // BUYCREDIT/YES lookup) missed the just-sent quote once a busy account had
  // more than `limit` messages. Fetch descending, then reverse to chronological.
  let query = db()
    .from("messages")
    .select("id, direction, channel, address, body, media, digest_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (address) query = query.eq("address", address);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .reverse()
    .map((row) => ({
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

// ---------- digest outbox (migration 9994) ----------

interface OutboxRowDb {
  id: number;
  digest_id: number;
  channel: string;
  address: string;
  part: number;
  parts: number;
  subject: string | null;
  body: string;
  html: string | null;
  segments: number;
  status: string;
  attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  created_at: string;
}

function toOutboxRow(row: OutboxRowDb): OutboxRow {
  return {
    id: row.id,
    digestId: row.digest_id,
    channel: row.channel as OutboxRow["channel"],
    address: row.address,
    part: row.part,
    parts: row.parts,
    subject: row.subject ?? undefined,
    body: row.body,
    html: row.html ?? undefined,
    segments: row.segments,
    status: row.status as OutboxRow["status"],
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
  };
}

export async function enqueueDigestOutbox(rows: OutboxInsert[]): Promise<number> {
  let added = 0;
  // Chunked so a big list (1500 subscribers × parts) stays well under
  // request-size limits; ignoreDuplicates makes a resumed enqueue a no-op
  // for rows that already made it in.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      digest_id: r.digestId,
      channel: r.channel,
      address: r.address,
      part: r.part,
      parts: r.parts,
      subject: r.subject ?? null,
      body: r.body,
      html: r.html ?? null,
      segments: r.segments,
    }));
    const { data, error } = await db()
      .from("digest_outbox")
      .upsert(chunk, { onConflict: "digest_id,address,part", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    added += data?.length ?? 0;
  }
  return added;
}

export async function claimDigestOutbox(limit: number): Promise<OutboxRow[]> {
  const { data, error } = await db().rpc("claim_digest_outbox", { p_limit: limit });
  if (error) throw error;
  // UPDATE ... RETURNING does not guarantee order — restore columnar order.
  return ((data ?? []) as OutboxRowDb[])
    .map(toOutboxRow)
    .sort((a, b) => a.part - b.part || a.id - b.id);
}

export async function markOutboxSent(id: number): Promise<void> {
  const { error } = await db()
    .from("digest_outbox")
    .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
    .eq("id", id);
  if (error) throw error;
}

export async function markOutboxFailed(
  id: number,
  errorText: string,
  maxAttempts: number,
): Promise<void> {
  const { data, error } = await db()
    .from("digest_outbox")
    .select("attempts")
    .eq("id", id)
    .single();
  if (error) throw error;
  const attempts = ((data?.attempts as number) ?? 0) + 1;
  const { error: updateError } = await db()
    .from("digest_outbox")
    .update({
      attempts,
      status: attempts >= maxAttempts ? "failed" : "queued",
      last_error: errorText.slice(0, 500),
      claimed_at: null,
    })
    .eq("id", id);
  if (updateError) throw updateError;
}

export async function requeueOutbox(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db()
    .from("digest_outbox")
    .update({ status: "queued", claimed_at: null })
    .in("id", ids)
    .eq("status", "sending");
  if (error) throw error;
}

export async function cancelQueuedOutboxFor(address: string): Promise<number> {
  // Drop any pending delivery for this address (opt-out / block / unsub). Mark
  // 'failed' (not 'sent') so it leaves the queue without counting toward the
  // billed-segment budget. Returns how many rows were dropped.
  try {
    const { data, error } = await db()
      .from("digest_outbox")
      .update({
        status: "failed",
        last_error: "canceled: recipient opted out or was blocked",
        claimed_at: null,
      })
      .eq("address", address)
      .in("status", ["queued", "sending"])
      .select("id");
    if (error) throw error;
    return (data ?? []).length;
  } catch (e) {
    // This runs inside the STOP path (every unsubscribe) — a missing
    // digest_outbox table (migration 9994 not applied) or transient error must
    // not fail the opt-out itself (setSubscribed already committed).
    console.error("[outbox] cancelQueuedOutboxFor failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function digestSegmentsSentSince(sinceIso: string): Promise<number> {
  const { data, error } = await db().rpc("outbox_segments_since", { p_since: sinceIso });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

export async function queuedOutboxCount(): Promise<number> {
  const { count, error } = await db()
    .from("digest_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "sending"]);
  if (error) throw error;
  return count ?? 0;
}

// --- admin insights readers (paged; aggregation happens in lib/insights.ts) ---

export async function listInboundSince(sinceIso: string): Promise<InsightMessage[]> {
  const rows: InsightMessage[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("messages")
      .select("address, body, channel, created_at")
      .eq("direction", "inbound")
      .gte("created_at", sinceIso)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      // Chat audit copies (item 13) aren't inbound SMS commands — keep them
      // out of the command/keyword insights. Filtered here (not with .neq)
      // because 'chat' isn't a valid enum value until migration 9980 lands,
      // and an enum comparison against an unknown value errors the query.
      if (r.channel === "chat") continue;
      rows.push({
        address: r.address as string,
        body: (r.body as string | null) ?? "",
        channel: r.channel as InsightMessage["channel"],
        createdAt: r.created_at as string,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function listBumpsSince(sinceIso: string | null): Promise<InsightBump[]> {
  const rows: InsightBump[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = db()
      .from("bumps")
      .select("ad_id, requested_at, status")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (sinceIso) query = query.gte("requested_at", sinceIso);
    const { data, error } = await query;
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        adId: r.ad_id as number,
        requestedAt: r.requested_at as string,
        status: r.status as string,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

export async function listAdsLite(): Promise<InsightAd[]> {
  const rows: InsightAd[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("ads")
      .select("id, status, created_at, approved_at, sold_at, users!inner(phone)")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      // PostgREST returns a to-one embed as an object; supabase-js types it as
      // an array, so cast through unknown like the AdRow reads above.
      const owner = (r.users as unknown as { phone: string | null } | null)?.phone ?? "";
      rows.push({
        id: r.id as number,
        ownerPhone: owner,
        status: r.status as InsightAd["status"],
        createdAt: r.created_at as string,
        approvedAt: (r.approved_at as string | null) ?? undefined,
        soldAt: (r.sold_at as string | null) ?? undefined,
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

/** Command replies only — digest broadcasts (digest_id set) and email don't count. */
export async function countRecentOutbound(
  address: string | null,
  sinceMs: number,
  mmsOnly: boolean,
): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  let query = db()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .is("digest_id", null)
    .gte("created_at", since);
  query = mmsOnly ? query.eq("channel", "mms") : query.in("channel", ["sms", "mms"]);
  if (address !== null) query = query.eq("address", address);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
