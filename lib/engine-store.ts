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

export type StoredAdStatus = "pending" | "approved" | "rejected" | "sold" | "expired";

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
  flagged: boolean;
  rejectedReason?: string;
  rejectionKind?: "benign" | "violation";
  photo?: { src: string; alt: string; width: number; height: number };
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
  channel: "sms" | "mms" | "email";
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
  return {
    id: ad.id,
    body: ad.body,
    status: (ad.status === "approved" ? "available" : ad.status) as AdStatus,
    approvedAt: new Date(ad.approvedAt ?? ad.createdAt),
    ownerPhone: ad.ownerPhone,
    ...(ad.photo && { photo: ad.photo }),
  };
}

// --- site reads (fixtures mode only; Supabase mode reads via ads-supabase) ---

export async function fileListAds({ q, page = 1, perPage = 15 }: AdQuery = {}): Promise<AdPage> {
  const store = load();
  sweep(store);
  let ads = store.ads
    .filter((ad) => ad.status === "approved" || ad.status === "sold")
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
    (a) => a.id === id && (a.status === "approved" || a.status === "sold" || a.status === "expired"),
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
    return store.ads
      .filter((a) => a.status === "approved" && !a.broadcastAt)
      .sort(
        (a, b) => Date.parse(a.approvedAt ?? a.createdAt) - Date.parse(b.approvedAt ?? b.createdAt),
      )
      .slice(0, cap);
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

  getLastEmailDigestAt(excludeId: number): string | null {
    const sent = load()
      .digests.filter((d) => d.channel === "email" && d.id !== excludeId && d.sentAt)
      .sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!));
    return sent[0]?.sentAt ?? null;
  },

  getSmsAdIdsSince(sinceIso: string | null): number[] {
    const cutoff = sinceIso ? Date.parse(sinceIso) : 0;
    const ids = load()
      .digests.filter(
        (d) => d.channel === "sms" && d.sentAt && Date.parse(d.sentAt) > cutoff && d.items?.length,
      )
      .flatMap((d) => d.items ?? []);
    return [...new Set(ids)];
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
      .messages.filter((m) => m.direction === "inbound" && Date.parse(m.createdAt) >= since)
      .map((m) => ({ address: m.address, body: m.body, channel: m.channel, createdAt: m.createdAt }));
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

/** Watermark for the email edition: when the previous email digest went out. */
export async function getLastEmailDigestAt(excludeId: number): Promise<string | null> {
  return supabaseConfigured
    ? remote.getLastEmailDigestAt(excludeId)
    : file.getLastEmailDigestAt(excludeId);
}

/** Ad ids the SMS digests carried after the watermark (deduplicated). */
export async function getSmsAdIdsSince(sinceIso: string | null): Promise<number[]> {
  return supabaseConfigured ? remote.getSmsAdIdsSince(sinceIso) : file.getSmsAdIdsSince(sinceIso);
}

export async function digestsSentOnDay(dayKey: string): Promise<number> {
  return supabaseConfigured ? remote.digestsSentOnDay(dayKey) : file.digestsSentOnDay(dayKey);
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
