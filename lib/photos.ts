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
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** MMS media frequently arrives as application/octet-stream — trust the bytes
 * over the header. Returns the storage extension, or null for a non-image. */
function imageExt(contentType: string, bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  const head6 = bytes.subarray(0, 6).toString("latin1");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return EXT_BY_TYPE[contentType] ?? null;
}

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
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw new Error(`unacceptable size (${bytes.byteLength} bytes)`);
    }
    const headerType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const ext = imageExt(headerType, bytes);
    if (!ext) throw new Error(`not an image (content-type ${headerType || "missing"})`);
    await ensureBucket();
    const path = `${randomUUID()}.${ext}`;
    const { error } = await db()
      .storage.from(BUCKET)
      .upload(path, bytes, { contentType: CONTENT_TYPE_BY_EXT[ext] });
    if (error) throw error;
    const { data } = db().storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  } catch (e) {
    console.error("[photos] re-host failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
