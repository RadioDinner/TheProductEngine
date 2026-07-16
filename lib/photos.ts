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

const BUCKET = "ad-photos";
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

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

/** Copy an inbound MMS photo into our storage; null on any failure. */
export async function rehostInboundPhoto(src: string): Promise<string | null> {
  if (!supabaseConfigured || !fetchableHost(src)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(src, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`fetch returned ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const ext = EXT_BY_TYPE[contentType];
    if (!ext) throw new Error(`not an image (content-type ${contentType || "missing"})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw new Error(`unacceptable size (${bytes.byteLength} bytes)`);
    }
    await ensureBucket();
    const path = `${randomUUID()}.${ext}`;
    const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType });
    if (error) throw error;
    const { data } = db().storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  } catch (e) {
    console.error("[photos] re-host failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
