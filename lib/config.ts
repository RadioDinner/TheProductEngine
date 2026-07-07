/**
 * Site-wide configuration. In production these values come from the
 * admin-editable config table; until the backend exists they live here.
 */
export const site = {
  name: "The Plain Exchange",
  region: "Holmes County, Ohio",
  /** Placeholder until the Telnyx number is provisioned (555 = reserved fictional range). */
  smsNumber: "(330) 555-0100",
  smsNumberPlain: "3305550100",
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
  /** Starter word-filter list (flag-for-review). */
  filterWords: ["gun", "firearm", "rifle", "whiskey", "tobacco"],
} as const;
