/**
 * Site-wide configuration. In production these values come from the
 * admin-editable config table; until the backend exists they live here.
 */
export const site = {
  name: "The Plain Exchange",
  region: "Holmes County, Ohio",
  /** The provisioned Telnyx number. */
  smsNumber: "(330) 960-7170",
  smsNumberPlain: "3309607170",
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

/**
 * Engine defaults — the values used until an admin saves overrides via the
 * settings store (lib/settings.ts). Mirrors supabase/seed.sql.
 */
export const engineDefaults = {
  costText: 1,
  costPhoto: 5,
  bumpCost: 0,
  digestCap: 10,
  /** SMS digest slots, hours in America/New_York. */
  slots: [7, 12, 16, 20],
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
  /** Starter word-filter list (flag-for-review). */
  filterWords: ["gun", "firearm", "rifle", "whiskey", "tobacco"],
} as const;
