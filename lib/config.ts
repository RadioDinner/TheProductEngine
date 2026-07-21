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
  costText: 2,
  costPhoto: 10,
  bumpCost: 0,
  digestCap: 10,
  /**
   * SMS digest slots, hours in America/New_York — 2/day (morning + evening).
   * Admin-editable at /admin/settings.
   */
  slots: [7, 18],
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
   * send in any rolling 24h window. When it's met, queued SMS deliveries wait
   * and the admin is alerted. 12,000 ≈ 4 slots × ~430 subscribers × 7
   * segments — raise it deliberately as the list grows. 0 pauses SMS digests.
   * This is an SMS COST cap only — the 0-segment email edition is exempt and
   * keeps flowing; use pauseMode to stop every channel.
   */
  digestDailySegmentBudget: 12000,
  /**
   * Insights: flag a number that requests more than this many pictures (PIC)
   * in a rolling 24h as "excessive" on the admin dashboard. Purely a reporting
   * threshold — the actual send cap is smsPicsPerHour. 0 disables the flag.
   */
  picAbusePerDay: 15,
  /**
   * PIC daily allowance + rolling bank — the real MMS cost control. A number
   * gets `picDailyAllowance` photo pulls per ET calendar day; unused pulls bank
   * up to `picBankCap` (a light user builds a cushion, a heavy user is capped).
   * The hourly `smsPicsPerHour` cap stays on top as a burst limiter. Set
   * picDailyAllowance to 0 to turn the daily quota OFF (photos then bounded only
   * by the hourly cap). See lib/pic-quota.ts.
   */
  picDailyAllowance: 3,
  /** Max photo pulls a number can bank across days (the sinking-fund ceiling). */
  picBankCap: 20,
  /**
   * Metered click-to-reveal (item 23, anti-scraping): "Show number" look-ups a
   * signed-in member gets per ET day; unused ones bank up to `revealBankCap`
   * (same daily-allowance + rolling-bank shape as PIC pulls). Re-viewing an
   * already-revealed ad is always free. Set revealsPerDay to 0 to turn
   * metering OFF (reveals still click-gated and logged, never denied). See
   * lib/reveal-quota.ts.
   */
  revealsPerDay: 10,
  /** Max number look-ups a member can bank across days. */
  revealBankCap: 30,
  /**
   * Insights: flag a member revealing more than this many seller numbers in a
   * rolling 24h as "excessive" (a scraper signature). Purely a reporting
   * threshold — the actual cap is revealsPerDay/revealBankCap. 0 disables.
   */
  revealAbusePerDay: 25,
  /**
   * Category-confirmation throttle (item 24 spam guard): category toggles and
   * LIST checks a number can have CONFIRMED per hour. Past it, ONE "changes
   * still apply" notice goes out and further confirmations are silent for the
   * hour — toggles still apply, they just cost nothing outbound. The hourly
   * reserve_sms reply cap stays on top as the hard backstop. 0 = unthrottled.
   */
  categoryConfirmsPerHour: 5,
  /**
   * Percent off a credit pack when it's bought with a saved card by text
   * (BUYCREDIT) — the incentive to keep a card on file. 0 = no discount.
   */
  savedCardDiscountPercent: 10,
  /** Homepage promo banner (credit sales). Empty text = hidden. */
  promoBannerText: "",
  promoBannerLink: "/account#credits",
  /**
   * Master outbound kill switch (operator-flipped at /admin/settings):
   *   "off"  — normal operation.
   *   "bulk" — PARTIAL pause: digests + new-subscriber catch-up stop; command
   *            replies, PIC MMS, sign-in codes and STOP confirmations still go.
   *   "all"  — FULL pause: every subscriber/user-facing SMS+email stops
   *            (digests, replies, PIC, sign-in codes, confirmations). Inbound is
   *            still received and logged; operator alert emails still reach you;
   *            you sign into admin with your password. Absolute spend stop.
   * Queued digest rows wait (they're never dropped) and resume — under the
   * segment budget — when you set this back to "off".
   */
  pauseMode: "off",
  /**
   * UNDER ATTACK mode (operator-flipped). While on: replies to unknown/gibberish
   * and new-subscriber catch-up are suppressed, the per-number and service-wide
   * SMS caps are auto-tightened, and outbound is throttled to
   * outboundThrottlePerMin. Pair it with the blocklist to kill bad actors fast.
   */
  underAttack: false,
  /**
   * Global outbound sends-per-minute ceiling enforced ONLY while underAttack is
   * on. Excess defers to the next cron tick (digests) or is dropped (replies),
   * smoothing burst spend. Ignored when underAttack is off.
   */
  outboundThrottlePerMin: 60,
  /** Auto-tightened per-number command-reply cap/hour while underAttack. */
  attackRepliesPerHour: 5,
  /** Auto-tightened per-number PIC cap/hour while underAttack. */
  attackPicsPerHour: 2,
  /** Auto-tightened service-wide command-reply cap/hour while underAttack. */
  attackGlobalPerHour: 120,
  /** Starter word-filter list (flag-for-review). */
  filterWords: ["gun", "firearm", "rifle", "whiskey", "tobacco"],
} as const;
