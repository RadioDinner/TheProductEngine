/**
 * Inbound-MMS photo re-hosting. Telnyx media URLs expire and are not always on
 * an allowlisted host, so a picture ad's photo is copied into Supabase Storage
 * at ingest — the stored ad then points at our own public URL, which the image
 * allowlist (lib/media.ts + next.config.ts) already serves. Best-effort by
 * design: any failure returns null and the caller falls back to the original
 * URL (kept only if allowlisted) — a photo problem must never block an ad.
 */
import { randomUUID } from "node:crypto";
import { db, supabaseConfigured } from "@/lib/db";
import { CONTENT_TYPE_BY_EXT, sniffImage } from "@/lib/image-sniff";
import { MAX_COMBINED_PHOTOS, collageDimensions, combineImageBuffers } from "@/lib/photo-collage";

const BUCKET = "ad-photos";
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

let bucketReady = false;

/** Fetch only real public https hosts — never IP literals or local names. The
 * URL comes from a signature-verified Telnyx payload, but re-hosting fetches
 * server-side, so keep SSRF guardrails anyway. */
function fetchableHost(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  // Probe before create: create-on-exists logs a handled-but-visible 23505
  // (buckets_pkey) in the operator's Postgres error log on every cold start.
  // Creation stays for the true first run, with its exist/duplicate swallow
  // as the race guard.
  const { data: existing } = await db().storage.getBucket(BUCKET);
  if (!existing) {
    // Public bucket: ad photos are public content (they render on the site).
    const { error } = await db().storage.createBucket(BUCKET, { public: true });
    if (error && !/exist|duplicate/i.test(error.message)) throw error;
  }
  bucketReady = true;
}

export type RehostResult = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Storage folders encode provenance so no schema change is needed:
 * - `collage/` — a combined multi-picture image (always at ad_photos position
 *   0 when present; safe to delete when replaced by a recompose);
 * - `parts/` — an individual source picture of a collage (website gallery,
 *   positions 1+; the recompose inputs when the seller texts another photo);
 * - bare path — a single-picture ad's photo, or an emailed-in extra.
 */
export type PhotoFolder = "collage" | "parts";

const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

export function isCollageSrc(src: string): boolean {
  return src.includes(`${PUBLIC_MARKER}collage/`);
}

export function isCombinePartSrc(src: string): boolean {
  return src.includes(`${PUBLIC_MARKER}parts/`);
}

/** Telnyx-hosted media (api.telnyx.com/v2/media style) requires API-key auth
 * to fetch; send the bearer ONLY to telnyx.com hosts, never anywhere else. */
function fetchHeaders(src: string): Record<string, string> {
  const host = new URL(src).hostname.toLowerCase();
  const isTelnyx = host === "telnyx.com" || host.endsWith(".telnyx.com");
  return isTelnyx && process.env.TELNYX_API_KEY
    ? { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }
    : {};
}

/**
 * Sniff-verify raw image bytes and store them in the public bucket. The shared
 * back half of every ingest path (MMS re-host, emailed-in extras): the bytes
 * must PROVE the file is jpg/png/gif/webp — sender-supplied content types and
 * filenames are never consulted.
 */
export async function storeImageBytes(bytes: Buffer, folder?: PhotoFolder): Promise<RehostResult> {
  if (!supabaseConfigured) return { ok: false, reason: "Supabase is not configured (dev mode)" };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return { ok: false, reason: `unacceptable size (${bytes.byteLength} bytes)` };
  }
  const ext = sniffImage(bytes);
  if (!ext) {
    return { ok: false, reason: "not an accepted image — bytes are not jpg/png/gif/webp" };
  }
  try {
    await ensureBucket();
    const path = `${folder ? `${folder}/` : ""}${randomUUID()}.${ext}`;
    const { error } = await db()
      .storage.from(BUCKET)
      .upload(path, bytes, { contentType: CONTENT_TYPE_BY_EXT[ext] });
    if (error) return { ok: false, reason: `storage upload failed: ${error.message}` };
    const { data } = db().storage.from(BUCKET).getPublicUrl(path);
    if (!data.publicUrl) return { ok: false, reason: "storage returned no public URL" };
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

type FetchBytesResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; reason: string };

/** Download media bytes with the same guardrails every ingest path uses:
 * https-only public hosts, Telnyx auth only to Telnyx, bounded time. */
export async function fetchImageBytes(src: string): Promise<FetchBytesResult> {
  if (!fetchableHost(src)) return { ok: false, reason: `not a fetchable https host: ${src}` };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(src, { signal: controller.signal, headers: fetchHeaders(src) });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return { ok: false, reason: `media fetch returned HTTP ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") ?? "unknown").split(";")[0];
    return { ok: true, bytes, contentType };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Copy an inbound MMS photo into our storage, reporting exactly why not. */
export async function rehostInboundPhotoDetailed(src: string): Promise<RehostResult> {
  if (!supabaseConfigured) return { ok: false, reason: "Supabase is not configured (dev mode)" };
  const fetched = await fetchImageBytes(src);
  if (!fetched.ok) return fetched;
  const stored = await storeImageBytes(fetched.bytes);
  if (!stored.ok && /not an accepted image/.test(stored.reason)) {
    return { ok: false, reason: `${stored.reason} (sender labeled it ${fetched.contentType})` };
  }
  return stored;
}

export interface IngestedAdPhotos {
  /** The ad's position-0 picture — the one MMS/PIC/digests carry. */
  photo: string;
  /** Individually re-hosted source pictures (website gallery, positions 1+).
   * Non-empty only when 2+ pictures were saved. */
  parts: string[];
  /** Pictures that made it in / attachments that didn't (bad bytes, fetch
   * failures, or beyond the combine limit). */
  saved: number;
  dropped: number;
  /** True when `photo` is a collage of the saved pictures; false when a
   * single picture (or a compose-failure fallback) is the photo. */
  combined: boolean;
  /** Exact pixel size of the photo — known only for collages (we composed
   * them); single pictures keep the caller's default. */
  width?: number;
  height?: number;
}

export type IngestResult = { ok: true } & IngestedAdPhotos | { ok: false; reason: string };

/**
 * Ingest every picture on an inbound MMS (FEATURES item 32). One picture
 * re-hosts exactly as before. Two to four pictures are each re-hosted as
 * `parts/` originals and composed into a single `collage/` image that becomes
 * the ad's one photo. Attachments beyond MAX_COMBINED_PHOTOS are dropped (and
 * counted, so the seller can be told). Best-effort at every step: a compose
 * failure degrades to first-picture-as-photo with the rest still in the
 * gallery; a photo problem never blocks an ad.
 */
export async function ingestInboundPhotos(srcs: string[]): Promise<IngestResult> {
  if (!supabaseConfigured) return { ok: false, reason: "Supabase is not configured (dev mode)" };
  const take = srcs.slice(0, MAX_COMBINED_PHOTOS);
  let dropped = srcs.length - take.length;
  const buffers: Buffer[] = [];
  for (const src of take) {
    const fetched = await fetchImageBytes(src);
    if (fetched.ok && sniffImage(fetched.bytes) && fetched.bytes.byteLength <= MAX_BYTES) {
      buffers.push(fetched.bytes);
    } else {
      dropped += 1;
      console.error(
        "[photos] ingest dropped an attachment:",
        fetched.ok ? `bytes are not an accepted image (labeled ${fetched.contentType})` : fetched.reason,
      );
    }
  }
  if (!buffers.length) return { ok: false, reason: "no usable pictures in the message" };

  if (buffers.length === 1) {
    const stored = await storeImageBytes(buffers[0]);
    if (!stored.ok) return stored;
    return { ok: true, photo: stored.url, parts: [], saved: 1, dropped, combined: false };
  }

  // 2+ pictures: originals first (they're the recompose inputs and the
  // website gallery), then the collage.
  const stored: { bytes: Buffer; url: string }[] = [];
  for (const bytes of buffers) {
    const result = await storeImageBytes(bytes, "parts");
    if (result.ok) stored.push({ bytes, url: result.url });
    else {
      dropped += 1;
      console.error("[photos] ingest couldn't store an original:", result.reason);
    }
  }
  if (!stored.length) return { ok: false, reason: "storage failed for every picture" };
  const partUrls = stored.map((s) => s.url);
  if (stored.length === 1) {
    return { ok: true, photo: partUrls[0], parts: [], saved: 1, dropped, combined: false };
  }
  const saved = stored.length;
  try {
    const collage = await combineImageBuffers(stored.map((s) => s.bytes));
    const storedCollage = await storeImageBytes(collage, "collage");
    if (storedCollage.ok) {
      return {
        ok: true,
        photo: storedCollage.url,
        parts: partUrls,
        saved,
        dropped,
        combined: true,
        ...collageDimensions(saved),
      };
    }
    console.error("[photos] collage store failed:", storedCollage.reason);
  } catch (e) {
    console.error("[photos] collage compose failed:", e instanceof Error ? e.message : String(e));
  }
  // Compose fallback: first picture is the photo, the rest ride the gallery.
  return {
    ok: true,
    photo: partUrls[0],
    parts: partUrls.slice(1),
    saved,
    dropped,
    combined: false,
  };
}

/** Bytes for an emailed-in attachment: inline base64 or an https download. */
export async function attachmentBytes(att: {
  content?: string;
  url?: string;
}): Promise<Buffer | null> {
  if (att.content) {
    try {
      const bytes = Buffer.from(att.content, "base64");
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  if (att.url && fetchableHost(att.url)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(att.url, { signal: controller.signal, headers: fetchHeaders(att.url) });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES ? bytes : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Copy an inbound MMS photo into our storage; null on any failure. */
export async function rehostInboundPhoto(src: string): Promise<string | null> {
  const result = await rehostInboundPhotoDetailed(src);
  if (!result.ok) {
    console.error("[photos] re-host failed:", result.reason);
    return null;
  }
  return result.url;
}

/**
 * Remove re-hosted photo objects when their ad is deleted. Only objects in our
 * own bucket are touched (public URL form …/object/public/ad-photos/<path>);
 * fixture/site-relative and external allowlisted srcs are skipped. Best-effort:
 * a storage failure logs and moves on — the ad_photos rows are the source of
 * truth for what renders, and the caller has already removed those.
 */
export async function removeHostedPhotos(srcs: string[]): Promise<void> {
  if (!supabaseConfigured) return;
  const marker = `/object/public/${BUCKET}/`;
  const paths = srcs
    .map((src) => {
      const at = src.indexOf(marker);
      return at === -1 ? null : src.slice(at + marker.length);
    })
    .filter((p): p is string => Boolean(p));
  if (!paths.length) return;
  const { error } = await db().storage.from(BUCKET).remove(paths);
  if (error) console.error("[photos] storage removal failed:", error.message);
}
