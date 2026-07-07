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
  digestId?: number;
  createdAt: string;
}

export interface NewAdInput {
  ownerPhone: string;
  body: string;
  flagged: boolean;
  photo?: StoredAd["photo"];
}

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

  rejectAd(id: number, reason: string, kind: "benign" | "violation"): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad || ad.status !== "pending") return;
    ad.status = "rejected";
    ad.rejectedReason = reason;
    ad.rejectionKind = kind;
    save(store);
  },

  markSold(id: number): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad) return;
    ad.status = "sold";
    ad.soldAt = new Date().toISOString();
    save(store);
  },

  reviveAd(id: number, ttlDays = AD_TTL_DAYS): void {
    const store = load();
    const ad = store.ads.find((a) => a.id === id);
    if (!ad) return;
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
  ): { id: number; created: boolean } {
    const store = load();
    const existing = store.digests.find((d) => d.slotKey === slotKey);
    if (existing) return { id: existing.id, created: false };
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
    return { id: digest.id, created: true };
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
    return load().digests.filter((d) => d.slotKey.startsWith(`${dayKey}#`) && d.sentAt && d.itemCount > 0)
      .length;
  },

  logMessage(rec: Omit<MessageRecord, "id" | "createdAt">): void {
    const store = load();
    store.messages.push({ id: store.nextId++, createdAt: new Date().toISOString(), ...rec });
    save(store);
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
): Promise<void> {
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
): Promise<{ id: number; created: boolean }> {
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

export async function logMessage(rec: Omit<MessageRecord, "id" | "createdAt">): Promise<void> {
  return supabaseConfigured ? remote.logMessage(rec) : file.logMessage(rec);
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
