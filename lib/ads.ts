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
  /** The seller's phone (their SMS identity), 10 digits. */
  ownerPhone: string;
  photo?: { src: string; alt: string; width: number; height: number };
}

/** Listing lifetime on the website. */
export const AD_TTL_DAYS = 30;

export function adExpiresAt(ad: Ad): Date {
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

/**
 * Display title: the lead clause of the free-text body, the way a
 * classified's first line works in print.
 */
export function deriveTitle(body: string): string {
  const firstClause = body.split(/[.,]/, 1)[0]?.trim() ?? body;
  return firstClause.length > 64 ? `${firstClause.slice(0, 61).trimEnd()}…` : firstClause;
}

/** Remainder of the body after the title clause, for the excerpt line. */
export function deriveRest(body: string): string {
  const title = body.split(/[.,]/, 1)[0] ?? "";
  return body
    .slice(title.length)
    .replace(/^[.,]\s*/, "")
    .trim();
}

/** First dollar amount in the body, if any — shown as the row's price. */
export function derivePrice(body: string): string | null {
  const match = body.match(/\$[\d,]+(?:\.\d{2})?/);
  return match ? match[0] : null;
}
