/**
 * Featured rotating sidebar spots (FEATURES item 19) — the pure rules, kept
 * dependency-free so the unit suite can pin them AND so the client rotator
 * component can import them (no IO, no server imports).
 *
 * The product shape (user words, session 009): LEFT of the homepage ads, TWO
 * Featured slots stacked vertically; each slot rotates every 8 seconds
 * through up to 3 image ads — 6 sellable spots total. Operator-posted ONLY
 * (admin CRUD, no selling flow yet — pricing unset). Each spot may carry an
 * EXTERNAL link: the operator-only exception to the no-links rule, rendered
 * rel="sponsored noopener nofollow".
 */

export const FEATURED_SLOTS = 2;
export const SPOTS_PER_SLOT = 3;
export const FEATURED_ROTATE_MS = 8000;
export const FEATURED_CAPTION_MAX = 120;

/** What one rotating spot renders from — serializable for the client leaf. */
export interface FeaturedSpotView {
  id: number;
  slot: number;
  position: number;
  src: string;
  caption: string | null;
  linkUrl: string | null;
}

/**
 * The rotation for one slot: its spots in position order (id breaking ties —
 * oldest first), capped at 3. The store may hold more rows than rotate; the
 * cap is a display rule, not a write-time refusal, so the operator can stage
 * inactive spots freely.
 */
export function slotRotation<T extends { slot: number; position: number; id: number }>(
  spots: T[],
  slot: number,
): T[] {
  return spots
    .filter((s) => s.slot === slot)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .slice(0, SPOTS_PER_SLOT);
}

/** Which spot index shows after `ticks` 8-second steps (or dot presses).
 * Safe for any integer — negatives and overshoot wrap. */
export function rotationIndex(ticks: number, count: number): number {
  if (!Number.isFinite(ticks) || count <= 0) return 0;
  return ((Math.trunc(ticks) % count) + count) % count;
}

/**
 * May this string be a Featured spot's external link? Absolute http(s) only —
 * no javascript:, no data:, no protocol-relative or bare text. Empty is fine
 * (the link is optional).
 */
export function acceptableSpotLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}
