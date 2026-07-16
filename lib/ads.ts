/**
 * Ad data layer. The interface (`listAds`, `Ad`) is what the pages depend on.
 * Two implementations sit behind it, chosen by env configuration:
 * - development: the mutable file store (lib/engine-store.ts), seeded from
 *   lib/fixtures.ts — texted-in ads persist and appear here once approved;
 * - production: Supabase (lib/ads-supabase.ts).
 *
 * Faithful to the product spec: an ad is a single free-text body as approved
 * in review (no structured title/price fields). Display title and price are
 * derived from the text, the same way the real system will render them.
 */
import { supabaseConfigured } from "@/lib/db";
import * as remote from "@/lib/ads-supabase";
import { fileGetAd, fileListAds, fileListAdsByOwner } from "@/lib/engine-store";

export type AdStatus = "available" | "sold" | "expired";

export interface Ad {
  /** Public ad number, sequential from 1001. */
  id: number;
  /** The free-text ad exactly as approved (contact info included). */
  body: string;
  status: AdStatus;
  /** When the ad was approved and broadcast (digest slot times). */
  approvedAt: Date;
  /** Real listing expiry, stamped at approval from the configurable expiryDays. */
  expiresAt?: Date | null;
  /** The seller's phone (their SMS identity), 10 digits. */
  ownerPhone: string;
  photo?: { src: string; alt: string; width: number; height: number };
  /** Every live picture, position order — the website gallery (FEATURES item
   * 1). photo (the MMS/digest picture) is photos[0] when the ad has one. */
  photos?: { src: string; alt: string; width: number; height: number }[];
}

/** Listing lifetime on the website. */
export const AD_TTL_DAYS = 30;

export function adExpiresAt(ad: Ad): Date {
  // Prefer the ad's real stored expiry (approval time + the configured
  // expiryDays); fall back to approvedAt + default TTL only for ads that
  // predate the stored value, so the seller-facing date is never wrong when
  // an admin changes expiryDays from the 30-day default.
  if (ad.expiresAt) return new Date(ad.expiresAt);
  const d = new Date(ad.approvedAt);
  d.setDate(d.getDate() + AD_TTL_DAYS);
  return d;
}

export interface AdQuery {
  q?: string;
  page?: number;
  perPage?: number;
}

export interface AdPage {
  ads: Ad[];
  total: number;
  page: number;
  totalPages: number;
}

// ---------- public interface (picks the implementation) ----------

export async function listAds(query: AdQuery = {}): Promise<AdPage> {
  return supabaseConfigured ? remote.listAds(query) : fileListAds(query);
}

/** Look up a single ad by its public number (expired ads included). */
export async function getAd(id: number): Promise<Ad | null> {
  if (!Number.isInteger(id)) return null;
  return supabaseConfigured ? remote.getAd(id) : fileGetAd(id);
}

/** All of a seller's ads, every status, newest first — for My Ads. */
export async function listAdsByOwner(phone: string): Promise<Ad[]> {
  return supabaseConfigured ? remote.listAdsByOwner(phone) : fileListAdsByOwner(phone);
}

// ---------- display derivations (shared by site + digest composer) ----------
// Pure implementations live in lib/ad-display.ts (dependency-free, unit-tested).
export { deriveTitle, deriveRest, derivePrice } from "@/lib/ad-display";
