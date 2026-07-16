/**
 * Emailed-in extra ad pictures (FEATURES item 1) — the pure parsing half, so
 * the unit suite can pin it. The inbound webhook route does the I/O.
 */

/** Most pictures one ad may carry in total (live + awaiting review). */
export const MAX_PHOTOS_PER_AD = 8;

/**
 * Find the ad number a photo email is for. The subject is the canonical spot
 * ("Ad 1042", "#1042", "pictures for ad 1042"); a bare number is accepted in
 * the subject only. In the body, only an explicit "ad 1042" / "#1042" counts —
 * a bare digit run there is too often a phone-number fragment ("330-555-0142"
 * contains "0142").
 */
export function parseAdNumber(subject: string, body: string): number | null {
  const explicit = /(?:\bad\s*#?\s*|#\s*)(\d{4,8})\b/i;
  const bare = /\b(\d{4,8})\b/;
  const subjectHit = subject.match(explicit) ?? subject.match(bare);
  if (subjectHit) return Number(subjectHit[1]);
  const bodyHit = body.match(explicit);
  return bodyHit ? Number(bodyHit[1]) : null;
}

export interface InboundAttachment {
  filename?: string;
  contentType?: string;
  /** Base64 content, when the webhook carries the bytes inline. */
  content?: string;
  /** Download URL, when the webhook carries a pointer instead. */
  url?: string;
}

/** Normalize whatever attachment shapes the provider sends into one list. */
export function normalizeAttachments(value: unknown): InboundAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: InboundAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const att: InboundAttachment = {
      filename: str(o.filename) ?? str(o.name),
      contentType: str(o.content_type) ?? str(o.contentType) ?? str(o.type),
      content: str(o.content) ?? str(o.data),
      url: str(o.url) ?? str(o.download_url) ?? str(o.downloadUrl),
    };
    if (att.content || att.url) out.push(att);
  }
  return out;
}
