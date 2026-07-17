/**
 * Engine storage: mutable ads, bumps, digests, and the message audit log.
 * Dual-mode like everything else — the JSON file implementation below for
 * development (seeded once from lib/fixtures.ts), Supabase in
 * lib/engine-store-supabase.ts. The website's fixture-mode reads
 * (lib/ads.ts) also come from this store, so texted-in ads appear on the
 * site the moment they're approved.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { supabaseConfigured } from "@/lib/db";
import * as remote from "@/lib/engine-store-supabase";
import { FIXTURE_ADS, fixtureDate } from "@/lib/fixtures";
import { AD_TTL_DAYS, type Ad, type AdPage, type AdQuery, type AdStatus } from "@/lib/ads";

// ---------- types ----------

export type StoredAdStatus = "pending" | "approved" | "rejected" | "sold" | "expired" | "deleted";

export interface StoredAd {
  id: number;
  ownerPhone: string;
  originalBody: string;
  body: string;
  status: StoredAdStatus;
  createdAt: string;
  approvedAt?: string;
  expiresAt?: string;
  soldAt?: string;
  /** Set when the ad rode its one included broadcast (new-ad slot). */
  broadcastAt?: string;
  /** Admin "skip the next digest": excluded from digest selection until this
   * time passes (migration 9988). */
  holdUntil?: string | null;
  /** Admin deletion (soft — migration 9987): when the ad was removed. */
  deletedAt?: string;
  flagged: boolean;
  rejectedReason?: string;
  rejectionKind?: "benign" | "violation";
  /** The MMS picture (position 0) — the one SMS/PIC/email digests carry. */
  photo?: { src: string; alt: string; width: number; height: number };
  /** Approved emailed-in extras (FEATURES item 1) — website gallery only. */
  morePhotos?: { src: string; alt: string; width: number; height: number }[];
}

/** An emailed-in picture awaiting admin review (FEATURES item 1). */
export interface PhotoSubmission {
  id: number;
  adId: number;
  src: string;
  fromEmail: string;
  createdAt: string;
}

export interface DigestRecord {
  id: number;
  channel: "sms" | "email";
  /** ET calendar identity, e.g. "2026-07-07#12" — one digest per slot. */
  slotKey: string;
  slotHour: number;
  itemCount: number;
  /** Ad ids carried (SMS digests) — the email edition's union source. */
  items?: number[];
  /** Public edition number, 1, 2, 3… (FEATURES item 5) — SENT SMS digests
   * with items only; the email mirror shows the same number. */
  digestNo?: number | null;
  sentAt?: string;
  createdAt: string;
}

export interface BumpRecord {
  id: number;
  adId: number;
  status: "queued" | "sent";
  requestedAt: string;
  digestId?: number;
}

export interface MessageRecord {
  id: number;
  direction: "inbound" | "outbound";
  /** 'chat' = the audit copy of an on-platform chat message (item 13; the
   * Postgres enum value ships with migration 9980). */
  channel: "sms" | "mms" | "email" | "chat";
  address: string; // 10-digit phone, or email address
  body: string;
  media?: string[];
  /** Rendered HTML (email, dev mode only — powers the /dev/email preview). */
  html?: string;
  /** Provider message id (Telnyx) — inbound dedup key. */
  providerId?: string;
  digestId?: number;
  createdAt: string;
}

export interface NewAdInput {
  ownerPhone: string;
  body: string;
  flagged: boolean;
  photo?: StoredAd["photo"];
}

/**
 * One queued delivery: a single message part for a single recipient of a
 * digest. Enqueued when the digest is composed, drained in bounded batches
 * by the cron — ordered by part so every subscriber gets part 1 before
 * anyone gets part 2, and resumable when a run times out mid-list.
 */
export interface OutboxRow {
  id: number;
  digestId: number;
  channel: "sms" | "email";
  address: string; // phone number or email address
  part: number; // 1-based within the digest
  parts: number;
  subject?: string; // email only
  body: string; // SMS text / email plain text
  html?: string; // email only
  /** Billed SMS segments for this part (0 for email) — budget accounting. */
  segments: number;
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  lastError?: string;
  claimedAt?: string;
  sentAt?: string;
  createdAt: string;
}

export type OutboxInsert = Omit<
  OutboxRow,
  "id" | "status" | "attempts" | "lastError" | "claimedAt" | "sentAt" | "createdAt"
>;

// --- lightweight rows for the admin insights aggregations (lib/insights.ts) ---
export interface InsightMessage {
  address: string;
  body: string;
  channel: "sms" | "mms" | "email";
  createdAt: string;
}
export interface InsightBump {
  adId: number;
  requestedAt: string;
  status: string;
}
export interface InsightAd {
  id: number;
  ownerPhone: string;
  status: StoredAdStatus;
  createdAt: string;
  approvedAt?: string;
  soldAt?: string;
}

/** A claimed row older than this is presumed orphaned by a dead run. */
const OUTBOX_RECLAIM_MS = 10 * 60 * 1000;

export interface CreateAdOptions {
  status?: "pending" | "rejected";
  rejectedReason?: string;
}

// ---------- file implementation ----------

interface EngineShape {
  seeded: boolean;
  nextId: number;
  ads: StoredAd[];
  digests: DigestRecord[];
  bumps: BumpRecord[];
  messages: MessageRecord[];
  reservations?: { address: string; kind: string; at: number }[];
  outbox?: OutboxRow[];
  photoSubmissions?: PhotoSubmission[];
}

const ENGINE_PATH = join(process.cwd(), ".data", "engine.json");

function seedAds(): StoredAd[] {
  return FIXTURE_ADS.map((f) => {
    const approvedAt = fixtureDate(f.daysAgo, f.slotHour);
    const expiresAt = new Date(approvedAt);
    expiresAt.setDate(expiresAt.getDate() + AD_TTL_DAYS);
    return {
      id: f.id,
      ownerPhone: f.ownerPhone,
      originalBody: f.body,
      body: f.body,
      status: f.status,
      createdAt: approvedAt.toISOString(),
      approvedAt: approvedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(f.status === "sold" && { soldAt: approvedAt.toISOString() }),
      broadcastAt: approvedAt.toISOString(), // fixtures already had their run
      flagged: false,
      ...(f.photo && { photo: f.photo }),
    };
  });
}

function load(): EngineShape {
  try {
    const parsed = JSON.parse(readFileSync(ENGINE_PATH, "utf8")) as EngineShape;
    if (parsed.seeded) return parsed;
  } catch {
    // fall through to seed
  }
  const fresh: EngineShape = {
    seeded: true,
    nextId: 1,
    ads: seedAds(),
    digests: [],
    bumps: [],
    messages: [],
  };
  try {
    save(fresh);
  } catch (e) {
    // Read-only filesystem (e.g. serverless without Supabase configured):
    // serve the seed from memory so reads still work, and say so loudly.
    console.error(
      "[engine-store] file store cannot persist (read-only fs?) — running from memory. " +
        "If this is a deployment, set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      e instanceof Error ? e.message : e,
    );
  }
  return fresh;
}

function save(store: EngineShape): void {
  mkdirSync(dirname(ENGINE_PATH), { recursive: true });
  writeFileSync(ENGINE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/** Lazy expiry: approved ads past their window read (and persist) as expired. */
function sweep(store: EngineShape): void {
  const now = Date.now();
  let dirty = false;
  for (const ad of store.ads) {
    if (ad.status === "approved" && ad.expiresAt && Date.parse(ad.expiresAt) < now) {
      ad.status = "expired";
      dirty = true;
    }
  }
  if (dirty) save(store);
}

function toSiteAd(ad: StoredAd): Ad {
  const photos = [...(ad.photo ? [ad.photo] : []), ...(ad.morePhotos ?? [])];
  return {
    id: ad.id,
    body: ad.body,
    status: (ad.status === "approved" ? "available" : ad.status) as AdStatus,
    approvedAt: new Date(ad.approvedAt ?? ad.createdAt),
    ...(ad.expiresAt && { expiresAt: new Date(ad.expiresAt) }),
    ownerPhone: ad.ownerPhone,
    ...(photos[0] && { photo: photos[0] }),
    ...(photos.length && { photos }),
  };
}

// --- site reads (fixtures mode only; Supabase mode reads via ads-supabase) ---

export async function fileListAds({ q, page = 1, perPage = 15 }: AdQuery = {}): Promise<AdPage> {
  const store = load();
  sweep(store);
  let ads = store.ads
    // Only ads that have gone out in a digest are shown on the public site.
    .filter((ad) => (ad.status === "approved" || ad.status === "sold") && ad.broadcastAt)
    .sort(
      (a, b) =>
        Date.parse(b.approvedAt ?? b.createdAt) - Date.parse(a.approvedAt ?? a.createdAt) ||
        b.id - a.id,
    );
  if (q?.trim()) {
    const needle = q.trim().toLowerCase();
    ads = ads.filter((ad) => ad.body.toLowerCase().includes(needle));
  }
  const total = ads.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    ads: ads.slice((current - 1) * perPage, current * perPage).map(toSiteAd),
    total,
    page: current,
    totalPages,
  };
}

export async function fileGetAd(id: number): Promise<Ad | null> {
  const store = load();
  sweep(store);
  const ad = store.ads.find(
    (a) =>
      a.id === id &&
      Boolean(a.broadcastAt) &&
      (a.status === "approved" || a.status === "sold" || a.status === "expired"),
  );
  return ad ? toSiteAd(ad) : null;
}

export async function fileListAdsByOwner(phone: string): Promise<Ad[]> {
  const store = load();
  sweep(store);
  return store.ads
    .filter(
      (ad) =>
        ad.ownerPhone === phone &&
        (ad.status === "approved" || ad.status === "sold" || ad.status === "expired"),
    )
    .sort(
      (a, b) =>
        Date.parse(b.approvedAt ?? b.createdAt) - Date.parse(a.approvedAt ?? a.createdAt) ||
        b.id - a.id,
    )
    .map(toSiteAd);
}

// --- file engine ops ---

const file = {
  createAd(input: NewAdInput, options: CreateAdOptions = {}): number {
    const store = load();
    const id = Math.max(1000, ...store.ads.map((a) => a.id)) + 1;
    store.ads.push({
      id,
      ownerPhone: input.ownerPhone,
      originalBody: input.body,
      body: input.body,
      status: options.status ?? "pending",
      createdAt: new Date().toISOString(),
      flagged: input.flagged,
      ...(options.status === "rejected" && {
        rejectedReason: options.rejectedReason,
        rejectionKind: "violation" as const,
      }),
      ...(input.photo && { photo: input.photo }),
    });
    save(store);
    return id;
  },

  getAllAds(q?: string, status?: StoredAdStatus, limit = 100): StoredAd[] {
    const store = load();
    sweep(store);
    let ads = [...store.ads].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    );
    if (status) ads = ads.filter((a) => a.status === status);
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      ads = ads.filter(
        (a) => a.body.toLowerCase().includes(needle) || String(a.id).includes(needle),
      );
    }
    return ads.slice(0, limit);
  },

  getAdRecord(id: number): StoredAd | null {
    const store = load();
    sweep(store);
    return store.ads.find((a) => a.id === id) ?? null;
  },

  getPendingAds(): StoredAd[] {
    return load()
      .ads.filter((a) => a.status === "pending")
      .sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.id - b.id);
  },

  approveAd(id: number, editedBody?: string, ttlDays = AD_TTL_DAYS): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad || ad.status !== "pending") return;
    ad.status = "approved";
    if (editedBody?.trim()) ad.body = editedBody.trim();
    ad.approvedAt = new Date().toISOString();
    const exp = new Date();
    exp.setDate(exp.getDate() + ttlDays);
    ad.expiresAt = exp.toISOString();
    save(store);
  },

  rejectAd(id: number, reason: string, kind: "benign" | "violation"): boolean {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad || ad.status !== "pending") return false;
    ad.status = "rejected";
    ad.rejectedReason = reason;
    ad.rejectionKind = kind;
    save(store);
    return true;
  },

  markSold(id: number): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    // Only a live listing can be sold — defense in depth, so SOLD can't
    // publish a pending/unreviewed (or resurrect a rejected) ad.
    if (!ad || (ad.status !== "approved" && ad.status !== "expired")) return;
    ad.status = "sold";
    ad.soldAt = new Date().toISOString();
    save(store);
  },

  reviveAd(id: number, ttlDays = AD_TTL_DAYS): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    // Revival is the bump-an-expired-ad path only.
    if (!ad || ad.status !== "expired") return;
    ad.status = "approved";
    const exp = new Date();
    exp.setDate(exp.getDate() + ttlDays);
    ad.expiresAt = exp.toISOString();
    save(store);
  },

  reassignAdOwnership(fromPhone: string, toPhone: string): number {
    const store = load();
    let moved = 0;
    for (const ad of store.ads) {
      if (ad.ownerPhone === fromPhone) {
        ad.ownerPhone = toPhone;
        moved++;
      }
    }
    if (moved) save(store);
    return moved;
  },

  updateAdBody(id: number, body: string): boolean {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad) return false;
    ad.body = body;
    save(store);
    return true;
  },

  listRecentDigests(limit: number): DigestRecord[] {
    return [...load().digests]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
      .slice(0, limit);
  },

  allocateDigestNumber(digestId: number): number | null {
    const store = load();
    const digest = store.digests.find((d) => d.id === digestId);
    if (!digest) return null;
    if (digest.digestNo) return digest.digestNo; // idempotent on retry
    const max = Math.max(0, ...store.digests.map((d) => d.digestNo ?? 0));
    digest.digestNo = max + 1;
    save(store);
    return digest.digestNo;
  },

  getSmsDigestNumber(slotKey: string): number | null {
    const digest = load().digests.find((d) => d.channel === "sms" && d.slotKey === slotKey);
    return digest?.digestNo ?? null;
  },

  queueBump(adId: number): boolean {
    const store = load();
    if (store.bumps.some((b) => b.adId === adId && b.status === "queued")) return false;
    store.bumps.push({
      id: store.nextId++,
      adId,
      status: "queued",
      requestedAt: new Date().toISOString(),
    });
    save(store);
    return true;
  },

  getQueuedBumps(): BumpRecord[] {
    return load()
      .bumps.filter((b) => b.status === "queued")
      .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  },

  getNewDigestAds(cap: number): StoredAd[] {
    const store = load();
    sweep(store);
    const now = Date.now();
    return store.ads
      .filter(
        (a) =>
          a.status === "approved" &&
          !a.broadcastAt &&
          (!a.holdUntil || Date.parse(a.holdUntil) <= now),
      )
      .sort(
        (a, b) => Date.parse(a.approvedAt ?? a.createdAt) - Date.parse(b.approvedAt ?? b.createdAt),
      )
      .slice(0, cap);
  },

  listHeldNewAds(): StoredAd[] {
    const now = Date.now();
    return load()
      .ads.filter(
        (a) =>
          a.status === "approved" &&
          !a.broadcastAt &&
          a.holdUntil &&
          Date.parse(a.holdUntil) > now,
      )
      .sort((a, b) => a.id - b.id);
  },

  setAdHold(id: number, untilIso: string | null): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad) return;
    ad.holdUntil = untilIso;
    save(store);
  },

  swapAdApprovalOrder(idA: number, idB: number): void {
    const store = load();
    const a = store.ads.find((x) => x.id === idA);
    const b = store.ads.find((x) => x.id === idB);
    if (!a || !b) return;
    [a.approvedAt, b.approvedAt] = [b.approvedAt, a.approvedAt];
    save(store);
  },

  revertAdToPending(id: number): boolean {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    // Only a still-queued ad (approved, never broadcast) can go back to review.
    if (!ad || ad.status !== "approved" || ad.broadcastAt) return false;
    ad.status = "pending";
    ad.holdUntil = null;
    store.bumps = store.bumps.filter((b) => !(b.adId === id && b.status === "queued"));
    save(store);
    return true;
  },

  deleteAd(id: number): "deleted" | "noop" {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad || ad.status === "deleted") return "noop";
    ad.status = "deleted";
    ad.deletedAt = new Date().toISOString();
    ad.holdUntil = null;
    // Photos are removed with the ad (prod deletes the storage objects too).
    delete ad.photo;
    delete ad.morePhotos;
    store.bumps = store.bumps.filter((b) => !(b.adId === id && b.status === "queued"));
    store.photoSubmissions = (store.photoSubmissions ?? []).filter((s) => s.adId !== id);
    save(store);
    return "deleted";
  },

  addPhotoSubmission(adId: number, src: string, fromEmail: string): "added" | "unsupported" {
    const store = load();
    (store.photoSubmissions ??= []).push({
      id: store.nextId++,
      adId,
      src,
      fromEmail,
      createdAt: new Date().toISOString(),
    });
    save(store);
    return "added";
  },

  listPhotoSubmissions(): PhotoSubmission[] {
    return [...(load().photoSubmissions ?? [])].sort((a, b) => a.id - b.id);
  },

  countAdPhotos(adId: number): number {
    const store = load();
    const ad = store.ads.find((a) => a.id === adId);
    const live = (ad?.photo ? 1 : 0) + (ad?.morePhotos?.length ?? 0);
    const pending = (store.photoSubmissions ?? []).filter((s) => s.adId === adId).length;
    return live + pending;
  },

  resolvePhotoSubmission(id: number, approve: boolean): PhotoSubmission | null {
    const store = load();
    const submission = (store.photoSubmissions ?? []).find((s) => s.id === id);
    if (!submission) return null;
    store.photoSubmissions = (store.photoSubmissions ?? []).filter((s) => s.id !== id);
    if (approve) {
      const ad = store.ads.find((a) => a.id === submission.adId);
      if (ad) {
        (ad.morePhotos ??= []).push({
          src: submission.src,
          alt: `More of ad #${ad.id}`,
          width: 800,
          height: 600,
        });
      }
    }
    save(store);
    return submission;
  },

  createExtraDigest(channel: "sms" | "email", now: Date): number {
    const store = load();
    const digest: DigestRecord = {
      id: store.nextId++,
      channel,
      slotKey: `${now.toISOString().slice(0, 10)}#extra#${now.toISOString().slice(11, 19)}`,
      slotHour: now.getUTCHours(),
      itemCount: 0,
      createdAt: now.toISOString(),
    };
    store.digests.push(digest);
    save(store);
    return digest.id;
  },

  finalizeExtraDigest(digestId: number, adIds: number[], itemCount: number): void {
    // An EXTRA edition records what it carried but consumes nothing: no
    // broadcast_at marking, no bump transitions — the queue rides again at
    // the next regular slot.
    const store = load();
    const digest = store.digests.find((d) => d.id === digestId);
    if (digest) {
      digest.itemCount = itemCount;
      digest.sentAt = new Date().toISOString();
      if (digest.channel === "sms") digest.items = adIds;
    }
    save(store);
  },

  expireDueAds(): number {
    const store = load();
    const before = store.ads.filter((a) => a.status === "expired").length;
    sweep(store);
    return store.ads.filter((a) => a.status === "expired").length - before;
  },

  createDigestIfAbsent(
    slotKey: string,
    slotHour: number,
    channel: "sms" | "email",
  ): { id: number; created: boolean; finalized: boolean } {
    const store = load();
    const existing = store.digests.find((d) => d.slotKey === slotKey);
    if (existing) return { id: existing.id, created: false, finalized: !!existing.sentAt };
    const digest: DigestRecord = {
      id: store.nextId++,
      channel,
      slotKey,
      slotHour,
      itemCount: 0,
      createdAt: new Date().toISOString(),
    };
    store.digests.push(digest);
    save(store);
    return { id: digest.id, created: true, finalized: false };
  },

  finalizeDigest(
    digestId: number,
    adIds: number[],
    bumpIds: number[],
    itemCount: number,
    carriedAdIds?: number[],
  ): void {
    const store = load();
    const digest = store.digests.find((d) => d.id === digestId);
    const now = new Date().toISOString();
    if (digest) {
      digest.itemCount = itemCount;
      digest.sentAt = now;
      if (digest.channel === "sms") digest.items = carriedAdIds ?? adIds;
    }
    for (const ad of store.ads) {
      if (adIds.includes(ad.id)) ad.broadcastAt = now;
    }
    for (const bump of store.bumps) {
      if (bumpIds.includes(bump.id)) {
        bump.status = "sent";
        bump.digestId = digestId;
      }
    }
    save(store);
  },

  getRecentDigestAdIds(): number[] {
    const sent = load()
      .digests.filter(
        (d) => d.channel === "sms" && d.sentAt && d.itemCount > 0 && d.items?.length,
      )
      .sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!));
    return sent[0]?.items ?? [];
  },

  getSmsDigestAdIds(slotKey: string): number[] | null {
    const digest = load().digests.find((d) => d.channel === "sms" && d.slotKey === slotKey);
    if (!digest?.sentAt) return null; // not composed yet — the email edition waits
    return digest.items ?? [];
  },

  digestsSentOnDay(dayKey: string): number {
    // SMS digests with items only — the email edition must not suppress the
    // Reply-STOP footer on the day's first real SMS digest.
    return load().digests.filter(
      (d) =>
        d.channel === "sms" &&
        d.slotKey.startsWith(`${dayKey}#`) &&
        d.sentAt &&
        d.itemCount > 0,
    ).length;
  },

  logMessage(rec: Omit<MessageRecord, "id" | "createdAt">): void {
    const store = load();
    store.messages.push({ id: store.nextId++, createdAt: new Date().toISOString(), ...rec });
    save(store);
  },

  enqueueDigestOutbox(rows: OutboxInsert[]): number {
    const store = load();
    const outbox = (store.outbox ??= []);
    const seen = new Set(outbox.map((r) => `${r.digestId}#${r.address}#${r.part}`));
    let added = 0;
    for (const row of rows) {
      const key = `${row.digestId}#${row.address}#${row.part}`;
      if (seen.has(key)) continue; // idempotent: a resumed enqueue skips existing rows
      seen.add(key);
      outbox.push({
        ...row,
        id: store.nextId++,
        status: "queued",
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      added++;
    }
    if (added) save(store);
    return added;
  },

  claimDigestOutbox(limit: number): OutboxRow[] {
    const store = load();
    const outbox = store.outbox ?? [];
    const staleBefore = Date.now() - OUTBOX_RECLAIM_MS;
    const claimable = outbox
      .filter(
        (r) =>
          r.status === "queued" ||
          (r.status === "sending" && Date.parse(r.claimedAt ?? r.createdAt) < staleBefore),
      )
      .sort((a, b) => a.part - b.part || a.id - b.id)
      .slice(0, limit);
    if (!claimable.length) return [];
    const now = new Date().toISOString();
    for (const row of claimable) {
      row.status = "sending";
      row.claimedAt = now;
    }
    save(store);
    return claimable.map((r) => ({ ...r }));
  },

  markOutboxSent(id: number): void {
    const store = load();
    const row = store.outbox?.find((r) => r.id === id);
    if (!row) return;
    row.status = "sent";
    row.sentAt = new Date().toISOString();
    delete row.lastError;
    save(store);
  },

  markOutboxFailed(id: number, error: string, maxAttempts: number): void {
    const store = load();
    const row = store.outbox?.find((r) => r.id === id);
    if (!row) return;
    row.attempts += 1;
    row.status = row.attempts >= maxAttempts ? "failed" : "queued";
    row.lastError = error.slice(0, 500);
    delete row.claimedAt;
    save(store);
  },

  requeueOutbox(ids: number[]): void {
    if (!ids.length) return;
    const store = load();
    const wanted = new Set(ids);
    for (const row of store.outbox ?? []) {
      if (wanted.has(row.id) && row.status === "sending") {
        row.status = "queued";
        delete row.claimedAt;
      }
    }
    save(store);
  },

  cancelQueuedOutboxFor(address: string): number {
    const store = load();
    let removed = 0;
    for (const row of store.outbox ?? []) {
      if (row.address === address && (row.status === "queued" || row.status === "sending")) {
        // Terminal, not delivered — drop it from the queue so a post-compose
        // STOP/block/unsub is honored before the row ever sends. 'failed' keeps
        // it out of the segment-budget tally (only 'sent' rows count).
        row.status = "failed";
        row.lastError = "canceled: recipient opted out or was blocked";
        delete row.claimedAt;
        removed++;
      }
    }
    if (removed) save(store);
    return removed;
  },

  digestSegmentsSentSince(sinceIso: string): number {
    const since = Date.parse(sinceIso);
    return (load().outbox ?? [])
      .filter((r) => r.status === "sent" && r.sentAt && Date.parse(r.sentAt) >= since)
      .reduce((sum, r) => sum + r.segments, 0);
  },

  queuedOutboxCount(): number {
    return (load().outbox ?? []).filter((r) => r.status === "queued" || r.status === "sending")
      .length;
  },

  listInboundSince(sinceIso: string): InsightMessage[] {
    const since = Date.parse(sinceIso);
    return load()
      .messages.filter(
        (m) =>
          m.direction === "inbound" &&
          // Chat audit copies (item 13) aren't inbound SMS commands — keep
          // them out of the command/keyword insights.
          m.channel !== "chat" &&
          Date.parse(m.createdAt) >= since,
      )
      .map((m) => ({
        address: m.address,
        body: m.body,
        // Safe: 'chat' rows are filtered out above.
        channel: m.channel as InsightMessage["channel"],
        createdAt: m.createdAt,
      }));
  },

  listBumpsSince(sinceIso: string | null): InsightBump[] {
    const since = sinceIso ? Date.parse(sinceIso) : 0;
    return load()
      .bumps.filter((b) => Date.parse(b.requestedAt) >= since)
      .map((b) => ({ adId: b.adId, requestedAt: b.requestedAt, status: b.status }));
  },

  listAdsLite(): InsightAd[] {
    const store = load();
    sweep(store);
    return store.ads.map((a) => ({
      id: a.id,
      ownerPhone: a.ownerPhone,
      status: a.status,
      createdAt: a.createdAt,
      approvedAt: a.approvedAt,
      soldAt: a.soldAt,
    }));
  },

  seenInboundProviderId(providerId: string): boolean {
    return load().messages.some((m) => m.providerId === providerId);
  },

  recordInboundOnce(rec: Omit<MessageRecord, "id" | "createdAt">): boolean {
    const store = load();
    if (rec.providerId && store.messages.some((m) => m.providerId === rec.providerId)) {
      return false;
    }
    store.messages.push({ id: store.nextId++, createdAt: new Date().toISOString(), ...rec });
    save(store);
    return true;
  },

  reserveSms(
    address: string,
    kind: "reply" | "pic",
    perNumber: number,
    global: number,
    perNumberPic: number,
    windowMs: number,
  ): boolean {
    const store = load();
    const list = (store.reservations ??= []);
    const since = Date.now() - windowMs;
    const recent = list.filter((r) => r.at >= since);
    if (recent.length >= global) return false;
    const forNum = recent.filter((r) => r.address === address);
    if (forNum.length >= perNumber) return false;
    if (kind === "pic" && forNum.filter((r) => r.kind === "pic").length >= perNumberPic) {
      return false;
    }
    list.push({ address, kind, at: Date.now() });
    store.reservations = list.filter((r) => r.at >= Date.now() - 2 * 60 * 60 * 1000);
    save(store);
    return true;
  },

  listMessages(address?: string, limit = 200): MessageRecord[] {
    const all = load().messages;
    const filtered = address ? all.filter((m) => m.address === address) : all;
    return filtered.slice(-limit);
  },

  countRecentOutboundContaining(address: string, needle: string, sinceMs: number): number {
    const cutoff = Date.now() - sinceMs;
    return load().messages.filter(
      (m) =>
        m.direction === "outbound" &&
        m.address === address &&
        Date.parse(m.createdAt) >= cutoff &&
        m.body.includes(needle),
    ).length;
  },

  countRecentOutbound(address: string | null, sinceMs: number, mmsOnly: boolean): number {
    const cutoff = Date.now() - sinceMs;
    return load().messages.filter(
      (m) =>
        m.direction === "outbound" &&
        m.digestId === undefined &&
        (mmsOnly ? m.channel === "mms" : m.channel === "sms" || m.channel === "mms") &&
        (address === null || m.address === address) &&
        Date.parse(m.createdAt) >= cutoff,
    ).length;
  },
};

// ---------- public interface (picks the implementation) ----------

export async function createAd(input: NewAdInput, options: CreateAdOptions = {}): Promise<number> {
  return supabaseConfigured ? remote.createAd(input, options) : file.createAd(input, options);
}

export async function getAdRecord(id: number): Promise<StoredAd | null> {
  return supabaseConfigured ? remote.getAdRecord(id) : file.getAdRecord(id);
}

export async function getPendingAds(): Promise<StoredAd[]> {
  return supabaseConfigured ? remote.getPendingAds() : file.getPendingAds();
}

export async function getAllAds(
  q?: string,
  status?: StoredAdStatus,
  limit = 100,
): Promise<StoredAd[]> {
  return supabaseConfigured ? remote.getAllAds(q, status, limit) : file.getAllAds(q, status, limit);
}

export async function approveAdRecord(
  id: number,
  editedBody?: string,
  ttlDays?: number,
): Promise<void> {
  return supabaseConfigured
    ? remote.approveAdRecord(id, editedBody, ttlDays)
    : file.approveAd(id, editedBody, ttlDays);
}

export async function rejectAdRecord(
  id: number,
  reason: string,
  kind: "benign" | "violation",
): Promise<boolean> {
  return supabaseConfigured ? remote.rejectAdRecord(id, reason, kind) : file.rejectAd(id, reason, kind);
}

export async function markAdSold(id: number): Promise<void> {
  return supabaseConfigured ? remote.markAdSold(id) : file.markSold(id);
}

/** Admin edit of an ad's public text; the raw submission stays in originalBody. */
export async function updateAdBody(id: number, body: string): Promise<boolean> {
  return supabaseConfigured ? remote.updateAdBody(id, body) : file.updateAdBody(id, body);
}

/** Account-merge helper: move all of a phone's ads to another phone. The file
 * store keys ads by owner phone; in Supabase ads follow users.id and are moved
 * by the account merge itself, so this is a no-op there. */
export async function reassignAdOwnership(fromPhone: string, toPhone: string): Promise<number> {
  return supabaseConfigured ? 0 : file.reassignAdOwnership(fromPhone, toPhone);
}

/** Newest-first digest history for the admin Digests tab. */
export async function listRecentDigests(limit = 20): Promise<DigestRecord[]> {
  return supabaseConfigured ? remote.listRecentDigests(limit) : file.listRecentDigests(limit);
}

/**
 * Assign (or read back) a digest's public number (FEATURES item 5): 1, 2, 3…
 * in send order, counting from this feature's launch. Idempotent per digest;
 * null when migration 9982 isn't applied — the header simply omits the number.
 */
export async function allocateDigestNumber(digestId: number): Promise<number | null> {
  return supabaseConfigured
    ? remote.allocateDigestNumber(digestId)
    : file.allocateDigestNumber(digestId);
}

/** The number of one slot's SMS digest — the email mirror shows the same. */
export async function getSmsDigestNumber(slotKey: string): Promise<number | null> {
  return supabaseConfigured
    ? remote.getSmsDigestNumber(slotKey)
    : file.getSmsDigestNumber(slotKey);
}

export async function reviveAd(id: number, ttlDays?: number): Promise<void> {
  return supabaseConfigured ? remote.reviveAd(id, ttlDays) : file.reviveAd(id, ttlDays);
}

export async function queueBump(adId: number): Promise<boolean> {
  return supabaseConfigured ? remote.queueBump(adId) : file.queueBump(adId);
}

export async function getQueuedBumps(): Promise<BumpRecord[]> {
  return supabaseConfigured ? remote.getQueuedBumps() : file.getQueuedBumps();
}

export async function getNewDigestAds(cap: number): Promise<StoredAd[]> {
  return supabaseConfigured ? remote.getNewDigestAds(cap) : file.getNewDigestAds(cap);
}

/** Approved, never-broadcast ads currently held past a digest ("skip next"). */
export async function listHeldNewAds(): Promise<StoredAd[]> {
  return supabaseConfigured ? remote.listHeldNewAds() : file.listHeldNewAds();
}

/** Hold (or release, with null) an ad from digest selection until a time. */
export async function setAdHold(id: number, untilIso: string | null): Promise<void> {
  return supabaseConfigured ? remote.setAdHold(id, untilIso) : file.setAdHold(id, untilIso);
}

/** Swap two ads' approval order — the digest queue's move up/down. */
export async function swapAdApprovalOrder(idA: number, idB: number): Promise<void> {
  return supabaseConfigured
    ? remote.swapAdApprovalOrder(idA, idB)
    : file.swapAdApprovalOrder(idA, idB);
}

/** Pull a queued (approved, never-broadcast) ad back into the review list. */
export async function revertAdToPending(id: number): Promise<boolean> {
  return supabaseConfigured ? remote.revertAdToPending(id) : file.revertAdToPending(id);
}

/**
 * Admin deletion (soft, migration 9987): the ad's status flips to 'deleted' —
 * every positive status filter (site, digests, My Ads, PIC) excludes it, while
 * digest history and the message audit log keep the ad number. Queued bumps
 * are dropped and the photo (row + storage object) is removed. No refund and
 * no seller notice — that's admin judgement, handled elsewhere if deserved.
 * "unsupported" = the store can't take the new status yet (migration 9987 not
 * applied) — the caller surfaces that instead of 500ing.
 */
export async function deleteAdRecord(id: number): Promise<"deleted" | "noop" | "unsupported"> {
  return supabaseConfigured ? remote.deleteAdRecord(id) : file.deleteAd(id);
}

/**
 * Record an emailed-in extra picture (already re-hosted) as awaiting review
 * (FEATURES item 1). "unsupported" = migration 9985 not applied — the caller
 * tells nobody and the feature stays dormant.
 */
export async function addPhotoSubmission(
  adId: number,
  src: string,
  fromEmail: string,
): Promise<"added" | "unsupported"> {
  return supabaseConfigured
    ? remote.addPhotoSubmission(adId, src, fromEmail)
    : file.addPhotoSubmission(adId, src, fromEmail);
}

/** Every emailed-in picture awaiting review, oldest first. */
export async function listPhotoSubmissions(): Promise<PhotoSubmission[]> {
  return supabaseConfigured ? remote.listPhotoSubmissions() : file.listPhotoSubmissions();
}

/** Live + pending picture count for one ad — the per-ad submission cap. */
export async function countAdPhotos(adId: number): Promise<number> {
  return supabaseConfigured ? remote.countAdPhotos(adId) : file.countAdPhotos(adId);
}

/**
 * Approve (→ live website gallery) or discard an emailed-in picture. Returns
 * the resolved submission, or null if it no longer exists (double-submit).
 */
export async function resolvePhotoSubmission(
  id: number,
  approve: boolean,
): Promise<PhotoSubmission | null> {
  return supabaseConfigured
    ? remote.resolvePhotoSubmission(id, approve)
    : file.resolvePhotoSubmission(id, approve);
}

/** A digest row OUTSIDE the slot system (the admin "Send extra" edition). */
export async function createExtraDigest(channel: "sms" | "email", now: Date): Promise<number> {
  return supabaseConfigured
    ? remote.createExtraDigest(channel, now)
    : file.createExtraDigest(channel, now);
}

/** Record an extra edition's contents WITHOUT consuming the queue. */
export async function finalizeExtraDigest(
  digestId: number,
  adIds: number[],
  itemCount: number,
): Promise<void> {
  return supabaseConfigured
    ? remote.finalizeExtraDigest(digestId, adIds, itemCount)
    : file.finalizeExtraDigest(digestId, adIds, itemCount);
}

/**
 * Transition approved ads past their expiry window to 'expired'. The file store
 * does this lazily on every read (sweep); Supabase has no such trigger, so the
 * digest cron calls this each tick to give production the same 30-day-listing
 * behavior (otherwise approved ads stay live on the public site forever).
 * Returns how many ads were newly expired.
 */
export async function expireDueAds(): Promise<number> {
  return supabaseConfigured ? remote.expireDueAds() : file.expireDueAds();
}

export async function createDigestIfAbsent(
  slotKey: string,
  slotHour: number,
  channel: "sms" | "email" = "sms",
): Promise<{ id: number; created: boolean; finalized: boolean }> {
  return supabaseConfigured
    ? remote.createDigestIfAbsent(slotKey, slotHour, channel)
    : file.createDigestIfAbsent(slotKey, slotHour, channel);
}

export async function finalizeDigest(
  digestId: number,
  adIds: number[],
  bumpIds: number[],
  itemCount: number,
  carriedAdIds?: number[],
): Promise<void> {
  return supabaseConfigured
    ? remote.finalizeDigest(digestId, adIds, bumpIds, itemCount, carriedAdIds)
    : file.finalizeDigest(digestId, adIds, bumpIds, itemCount, carriedAdIds);
}

/** Ads carried by one SMS digest (`day#hour`), or null while it hasn't
 * composed — the email edition mirrors it 1:1 and waits on null. */
export async function getSmsDigestAdIds(slotKey: string): Promise<number[] | null> {
  return supabaseConfigured ? remote.getSmsDigestAdIds(slotKey) : file.getSmsDigestAdIds(slotKey);
}

export async function digestsSentOnDay(dayKey: string): Promise<number> {
  return supabaseConfigured ? remote.digestsSentOnDay(dayKey) : file.digestsSentOnDay(dayKey);
}

/** Ad ids carried by the most recent finalized, non-empty SMS digest slot. */
export async function getRecentDigestAdIds(): Promise<number[]> {
  return supabaseConfigured ? remote.getRecentDigestAdIds() : file.getRecentDigestAdIds();
}

/**
 * Queue digest deliveries (one row per recipient per message part). Idempotent
 * on (digestId, address, part) so a crashed enqueue can simply re-run. Returns
 * how many rows were newly added.
 */
export async function enqueueDigestOutbox(rows: OutboxInsert[]): Promise<number> {
  return supabaseConfigured ? remote.enqueueDigestOutbox(rows) : file.enqueueDigestOutbox(rows);
}

/**
 * Atomically claim the next batch of queued deliveries, columnar order (all
 * part 1s first, FIFO within a part). Rows claimed by a run that died are
 * reclaimed after 10 minutes.
 */
export async function claimDigestOutbox(limit: number): Promise<OutboxRow[]> {
  return supabaseConfigured ? remote.claimDigestOutbox(limit) : file.claimDigestOutbox(limit);
}

export async function markOutboxSent(id: number): Promise<void> {
  return supabaseConfigured ? remote.markOutboxSent(id) : file.markOutboxSent(id);
}

/** Failure re-queues the row for the next run until maxAttempts, then parks it as failed. */
export async function markOutboxFailed(
  id: number,
  error: string,
  maxAttempts: number,
): Promise<void> {
  return supabaseConfigured
    ? remote.markOutboxFailed(id, error, maxAttempts)
    : file.markOutboxFailed(id, error, maxAttempts);
}

/** Return claimed-but-unattempted rows to the queue (early halt) — attempts untouched. */
export async function requeueOutbox(ids: number[]): Promise<void> {
  return supabaseConfigured ? remote.requeueOutbox(ids) : file.requeueOutbox(ids);
}

/**
 * Cancel every still-pending (queued or claimed) digest delivery for an
 * address — called when the recipient opts out (STOP), is blocked, or
 * unsubscribes from email, so a digest composed BEFORE that event doesn't still
 * send afterward. Returns how many rows were dropped.
 */
export async function cancelQueuedOutboxFor(address: string): Promise<number> {
  return supabaseConfigured
    ? remote.cancelQueuedOutboxFor(address)
    : file.cancelQueuedOutboxFor(address);
}

/** Billed SMS segments delivered since a moment — the digest budget window. */
export async function digestSegmentsSentSince(sinceIso: string): Promise<number> {
  return supabaseConfigured
    ? remote.digestSegmentsSentSince(sinceIso)
    : file.digestSegmentsSentSince(sinceIso);
}

/** Deliveries still waiting (queued or mid-send) — for cron results/reports. */
export async function queuedOutboxCount(): Promise<number> {
  return supabaseConfigured ? remote.queuedOutboxCount() : file.queuedOutboxCount();
}

/** Inbound messages since a moment — powers the admin insights aggregations. */
export async function listInboundSince(sinceIso: string): Promise<InsightMessage[]> {
  return supabaseConfigured ? remote.listInboundSince(sinceIso) : file.listInboundSince(sinceIso);
}

/** Bump requests since a moment (null = all-time) — for bump-frequency insights. */
export async function listBumpsSince(sinceIso: string | null): Promise<InsightBump[]> {
  return supabaseConfigured ? remote.listBumpsSince(sinceIso) : file.listBumpsSince(sinceIso);
}

/** Minimal ad rows (id, owner, status, dates) for advertiser/funnel insights. */
export async function listAdsLite(): Promise<InsightAd[]> {
  return supabaseConfigured ? remote.listAdsLite() : file.listAdsLite();
}

export async function logMessage(rec: Omit<MessageRecord, "id" | "createdAt">): Promise<void> {
  return supabaseConfigured ? remote.logMessage(rec) : file.logMessage(rec);
}

/** Inbound dedup: true if a message with this Telnyx provider id already landed. */
export async function seenInboundProviderId(providerId: string): Promise<boolean> {
  return supabaseConfigured
    ? remote.seenInboundProviderId(providerId)
    : file.seenInboundProviderId(providerId);
}

/**
 * Log an inbound message, returning false if its provider id was already
 * recorded — the race-safe dedup point (a concurrent Telnyx retry loses the
 * unique-index insert). Non-provider (dev) messages always record.
 */
export async function recordInboundOnce(
  rec: Omit<MessageRecord, "id" | "createdAt">,
): Promise<boolean> {
  return supabaseConfigured ? remote.recordInboundOnce(rec) : file.recordInboundOnce(rec);
}

/**
 * Atomically reserve one outbound command-reply slot; returns false when a cap
 * (per-number, per-number PIC, or service-wide) is already hit. Digests never
 * reserve, so they stay exempt.
 */
export async function reserveSms(
  address: string,
  kind: "reply" | "pic",
  perNumber: number,
  global: number,
  perNumberPic: number,
  windowMs: number,
): Promise<boolean> {
  return supabaseConfigured
    ? remote.reserveSms(address, kind, perNumber, global, perNumberPic, windowMs)
    : file.reserveSms(address, kind, perNumber, global, perNumberPic, windowMs);
}

export async function listMessages(address?: string, limit = 200): Promise<MessageRecord[]> {
  return supabaseConfigured ? remote.listMessages(address, limit) : file.listMessages(address, limit);
}

export async function countRecentOutboundContaining(
  address: string,
  needle: string,
  sinceMs: number,
): Promise<number> {
  return supabaseConfigured
    ? remote.countRecentOutboundContaining(address, needle, sinceMs)
    : file.countRecentOutboundContaining(address, needle, sinceMs);
}

/**
 * Command replies sent in the window — digest broadcasts and email excluded.
 * `address: null` counts across all numbers (the global circuit breaker);
 * `mmsOnly` counts just picture replies (PIC costs the most to send).
 */
export async function countRecentOutbound(
  address: string | null,
  sinceMs: number,
  mmsOnly = false,
): Promise<number> {
  return supabaseConfigured
    ? remote.countRecentOutbound(address, sinceMs, mmsOnly)
    : file.countRecentOutbound(address, sinceMs, mmsOnly);
}
