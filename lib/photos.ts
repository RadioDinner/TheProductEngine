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
  // Public bucket: ad photos are public content (they render on the site).
  const { error } = await db().storage.createBucket(BUCKET, { public: true });
  if (error && !/exist|duplicate/i.test(error.message)) throw error;
  bucketReady = true;
}

export type RehostResult = { ok: true; url: string } | { ok: false; reason: string };

/** Telnyx-hosted media (api.telnyx.com/v2/media style) requires API-key auth
 * to fetch; send the bearer ONLY to telnyx.com hosts, never anywhere else. */
function fetchHeaders(src: string): Record<string, string> {
  const host = new URL(src).hostname.toLowerCase();
  const isTelnyx = host === "telnyx.com" || host.endsWith(".telnyx.com");
  return isTelnyx && process.env.TELNYX_API_KEY
    ? { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }
    : {};
}

/** Copy an inbound MMS photo into our storage, reporting exactly why not. */
export async function rehostInboundPhotoDetailed(src: string): Promise<RehostResult> {
  if (!supabaseConfigured) return { ok: false, reason: "Supabase is not configured (dev mode)" };
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
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return { ok: false, reason: `unacceptable size (${bytes.byteLength} bytes)` };
    }
    // Security: the bytes must PROVE the file is an accepted image format —
    // the content-type header is sender-controlled and is not consulted.
    const ext = sniffImage(bytes);
    if (!ext) {
      const headerType = (response.headers.get("content-type") ?? "unknown").split(";")[0];
      return {
        ok: false,
        reason: `not an accepted image — bytes are not jpg/png/gif/webp (sender labeled it ${headerType})`,
      };
    }
    await ensureBucket();
    const path = `${randomUUID()}.${ext}`;
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

/** Copy an inbound MMS photo into our storage; null on any failure. */
export async function rehostInboundPhoto(src: string): Promise<string | null> {
  const result = await rehostInboundPhotoDetailed(src);
  if (!result.ok) {
    console.error("[photos] re-host failed:", result.reason);
    return null;
  }
  return result.url;
}
