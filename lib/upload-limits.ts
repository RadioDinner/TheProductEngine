/**
 * One upload ceiling for the whole app, and the arithmetic behind it.
 *
 * WHY THIS EXISTS (session 016, found in prod): every upload path declared an
 * 8 MB per-file cap and next.config.ts allowed an 80 MB action body — but the
 * app runs on Vercel, which rejects any request body over ~4.5 MB at the
 * platform edge, BEFORE the server action runs. So a 5 MB photo never reached
 * our friendly "that image couldn't be used" message: the POST died with
 * FUNCTION_PAYLOAD_TOO_LARGE and the browser showed "This page couldn't
 * load." Modern phone photos are routinely 3–6 MB, so this was on its way to
 * being the single most common failure a seller would hit.
 *
 * The fix has two halves:
 * 1. The browser shrinks pictures before sending them (components/
 *    ImageUpload.tsx). A 1600px JPEG is a few hundred KB, so real uploads land
 *    an order of magnitude under any limit — and upload FAST, which is the
 *    part that matters on a rural connection.
 * 2. These numbers are what the server accepts if something arrives
 *    un-shrunk (a browser without canvas, a form posted by hand). They sit
 *    below the platform cap so the rejection is OUR honest error message
 *    rather than a broken page.
 */

/** Vercel's hard request-body limit. Nothing above this ever reaches us. */
export const PLATFORM_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

/** Per-file ceiling the server enforces. Under the platform cap with room for
 * multipart overhead and the other form fields. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Ceiling on a whole multi-file post (the "extra pictures" inputs). Kept
 * under the platform cap because these arrive as ONE request — eight files
 * that each pass the per-file check can still blow the body limit together. */
export const MAX_UPLOAD_TOTAL_BYTES = 4 * 1024 * 1024;

/** What the browser shrinks to before upload: longest edge in pixels. Well
 * above what MMS or the website ever displays, so nothing visible is lost. */
export const CLIENT_MAX_EDGE = 1600;
/** JPEG quality for the shrunk upload. */
export const CLIENT_JPEG_QUALITY = 0.82;
/** Files at or under this are sent untouched — re-encoding a small picture
 * only costs quality. */
export const CLIENT_SHRINK_THRESHOLD_BYTES = 900 * 1024;

/** "3 MB" — for member-facing copy, so the number in the sentence and the
 * number in the check can never drift apart. */
export function uploadLimitLabel(bytes: number = MAX_UPLOAD_BYTES): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/**
 * Does this set of files fit in one request? Pure, so both the browser guard
 * and the server check can use it and agree.
 *
 * Returns the reason it doesn't fit, so the caller can say which problem it
 * is — "that one picture is too big" and "those eight together are too big"
 * need different advice.
 */
export function uploadFits(
  sizes: number[],
  limits: { perFile?: number; total?: number } = {},
): { ok: true } | { ok: false; reason: "file" | "total" } {
  const perFile = limits.perFile ?? MAX_UPLOAD_BYTES;
  const total = limits.total ?? MAX_UPLOAD_TOTAL_BYTES;
  if (sizes.some((n) => n > perFile)) return { ok: false, reason: "file" };
  if (sizes.reduce((a, b) => a + b, 0) > total) return { ok: false, reason: "total" };
  return { ok: true };
}

/**
 * The pixel size to shrink to: longest edge capped at `maxEdge`, aspect ratio
 * preserved, never scaled UP (a small picture stays its own size). Pure.
 */
export function shrinkTo(
  width: number,
  height: number,
  maxEdge: number = CLIENT_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
