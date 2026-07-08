/**
 * Site-wide configuration. In production these values come from the
 * admin-editable config table; until the backend exists they live here.
 */
export const site = {
  name: "The Plain Exchange",
  region: "Holmes County, Ohio",
  /** The provisioned Telnyx number people TEXT ads to. */
  smsNumber: "(330) 960-7170",
  smsNumberPlain: "3309607170",
  /** The number people CALL for support or to arrange payment (phone/check/saved card). */
  supportPhone: "(234) 301-0048",
  supportPhonePlain: "2343010048",
  tagline: "Buy and sell by text message",
  adsPerPage: 15,
} as const;

export interface Pack {
  id: string;
  credits: number;
  priceCents: number;
}

/** Credit packs — admin-configurable in production. */
export const packs: Pack[] = [
  { id: "pack5", credits: 5, priceCents: 500 },
  { id: "pack10", credits: 10, priceCents: 900 },
  { id: "pack25", credits: 25, priceCents: 2000 },
];

export function getPack(id: string): Pack | null {
  return packs.find((p) => p.id === id) ?? null;
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Apply the saved-card discount to a price, rounded to whole cents. */
export function discountedCents(priceCents: number, discountPercent: number): number {
  const pct = Math.max(0, Math.min(100, discountPercent));
  return Math.round((priceCents * (100 - pct)) / 100);
}

/**
 * Engine defaults — the values used until an admin saves overrides via the
 * settings store (lib/settings.ts). Mirrors supabase/seed.sql.
 */
export const engineDefaults = {
  costText: 1,
  costPhoto: 5,
  bumpCost: 0,
  digestCap: 10,
  /**
   * SMS digest slots, hours in America/New_York — 2/day (morning + evening).
   * Admin-editable at /admin/settings.
   */
  slots: [7, 18],
  /** Email edition slots, hours in America/New_York. */
  emailSlots: [7, 16],
  maxChars: 250,
  expiryDays: 30,
  /** Abuse guards: command replies per number per hour before going silent. */
  smsRepliesPerHour: 20,
  /** Picture (PIC) replies per number per hour — MMS costs the most to send. */
  smsPicsPerHour: 12,
  /** All command replies service-wide per hour — the cost circuit breaker. */
  smsGlobalPerHour: 500,
  /**
   * Digest circuit breaker: billed SMS segments the digest broadcaster may
   * send in any rolling 24h window. When it's met, queued deliveries wait
   * and the admin is alerted. 12,000 ≈ 4 slots × ~430 subscribers × 7
   * segments — raise it deliberately as the list grows. 0 pauses digests.
   */
  digestDailySegmentBudget: 12000,
  /**
   * Insights: flag a number that requests more than this many pictures (PIC)
   * in a rolling 24h as "excessive" on the admin dashboard. Purely a reporting
   * threshold — the actual send cap is smsPicsPerHour. 0 disables the flag.
   */
  picAbusePerDay: 15,
  /**
   * Percent off a credit pack when it's bought with a saved card by text
   * (BUYCREDIT) — the incentive to keep a card on file. 0 = no discount.
   */
  savedCardDiscountPercent: 10,
  /** Starter word-filter list (flag-for-review). */
  filterWords: ["gun", "firearm", "rifle", "whiskey", "tobacco"],
} as const;
