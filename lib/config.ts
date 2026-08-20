/**
 * Site-wide configuration. In production these values come from the
 * admin-editable config table; until the backend exists they live here.
 */
export const site = {
  name: "The Plain Exchange",
  /**
   * The service area, in words. Deliberately BROAD since session 016 — an
   * Amish seller told the user that naming one county reads as "not for me"
   * two townships over, and the ads travel as far as the subscribers do.
   * Never put a county name here.
   */
  region: "Ohio's Plain communities",
  /** The provisioned Telnyx number people TEXT ads to. */
  smsNumber: "(330) 960-7170",
  smsNumberPlain: "3309607170",
  /** The number people CALL for support or to arrange payment (phone/check/saved card). */
  supportPhone: "(234) 301-0048",
  supportPhonePlain: "2343010048",
  /** The address people are told to visit — no scheme, it is spoken copy. */
  webHost: "ThePlainExchange.com",
  /**
   * The site version, shown in the footer and on /api/health.
   *
   * Bumped at the end of any session that shipped work, by the rule in §6 of
   * new_session_instructions.md: 3 or fewer features moves the far-right
   * digit, 4 or more (or a major change) moves the SECOND digit — without
   * resetting the third, which is the user's stated example and not a semver
   * habit to "correct". The FIRST digit only ever moves when the user says so.
   *
   * This constant is the only place it is written down; the footer and the
   * health probe both read it, so they can never disagree.
   */
  version: "1.0.3",
  tagline: "Buy and sell by text message",
  adsPerPage: 15,
} as const;

/**
 * Add-money presets (dollar pricing overhaul, session 016): the amounts a
 * member can put on their account in one Stripe checkout. Sized to the price
 * sheet: one text ad, one two-picture ad, one three-picture ad with change,
 * and a bundle worth a handful. All values in CENTS.
 */
export const TOP_UP_PRESETS_CENTS: number[] = [2000, 4000, 6000, 10000];

export function isTopUpPreset(amountCents: number): boolean {
  return TOP_UP_PRESETS_CENTS.includes(amountCents);
}

/** Operator-typed custom amount (dollars; a leading "$" and decimals are
 * fine) → cents, or null when unusable: not a number, under $1, or over
 * $5,000 — the same fat-finger ceiling as the admin balance adjustment.
 * Member-facing lanes stay preset-only; this is for the admin phone-order
 * forms, where the amount is whatever was agreed on the call. */
export function customAmountCents(raw: string): number | null {
  const cents = Math.round(Number(raw.trim().replace(/^\$/, "")) * 100);
  if (!Number.isFinite(cents) || cents < 100 || cents > 500_000) return null;
  return cents;
}

/**
 * What an ad costs, by how many pictures it carries (user price sheet,
 * session 016): 0 pictures = the text price, 1/2/3 = the picture ladder.
 * More pictures than the sheet covers charge the top rung — the combiner
 * caps at the same number, so that is a belt-and-braces clamp rather than a
 * real case. Pure, so the price ladder is unit-testable.
 */
export function adPriceCents(
  photoCount: number,
  prices: { costTextCents: number; photoPricesCents: number[] },
): number {
  if (photoCount <= 0 || !prices.photoPricesCents.length) return prices.costTextCents;
  const rung = Math.min(photoCount, prices.photoPricesCents.length) - 1;
  return prices.photoPricesCents[rung];
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Engine defaults — the values used until an admin saves overrides via the
 * settings store (lib/settings.ts). Mirrors supabase/seed.sql.
 */
export const engineDefaults = {
  /**
   * Ad prices in CENTS (dollar pricing overhaul, session 016 — see
   * docs/pricing.md). These are NEW settings keys (ad_price_*_cents), so a
   * stale credit-era config row (credit_cost_text = 2) can never be
   * misread as $0.02: unmigrated prod falls back to these defaults.
   */
  costTextCents: 2000,
  /**
   * Picture-ad prices in CENTS, BY PICTURE COUNT (user decision, session 016
   * after comparing an SMS competitor at $15/$20/$30): index 0 = one picture,
   * index 1 = two, index 2 = three. Three is the maximum an ad can carry —
   * the price sheet stops there, so the combiner does too.
   */
  photoPricesCents: [3000, 4000, 5000],
  /** Kept as the ONE-picture price so a single number still means something
   * to older callers and to the refund matcher. Derived, never edited alone. */
  costPhotoCents: 3000,
  /**
   * Do broadcasts carry the picture (MMS to every subscriber), or does the ad
   * say "Reply PIC 12"? OFF is the launch answer and the one that scales: an
   * MMS costs ~$0.035 per subscriber, so at $30 a picture ad auto-sending
   * stops breaking even around 850 subscribers, while an on-demand pull costs
   * that only for the handful who ask. The website carries every picture.
   */
  photosInBroadcast: false,
  /**
   * Website-listing add-on in cents. 0 (launch value) = every ad lists on
   * the website automatically, free. Set to 1500 to start charging +$15:
   * web posts then buy it with a checkbox; SMS ads default to NOT listed
   * (the operator can toggle per ad on /admin/ads).
   */
  webAddonCents: 0,
  /**
   * Starter credit in cents — granted ONCE, on a member's first real post
   * (never at account creation; the session-005 anti-abuse rule). $150
   * covers 3 text ads or 2 picture ads; set 18000 for "3 ads of any kind".
   */
  starterCreditCents: 4000,
  /**
   * How many members may ever receive the starter credit — "the first 200
   * subscribers get $40 free ad credit" (user decision, session 016). It is a
   * launch offer, not a standing one: past this count, first posts are simply
   * charged. 0 = no cap.
   */
  starterCreditLimit: 200,
  digestCap: 10,
  /**
   * EMAIL edition times, hours in America/New_York (session 016: SMS stopped
   * being a digest, so these drive the email editions only) — 7am, noon and
   * 5pm, the user's schedule. Admin-editable at /admin/settings.
   */
  slots: [7, 12, 17],
  /**
   * SMS send window (session 016, user decision): an approved ad is texted
   * IMMEDIATELY, one text per ad — but only between these hours, America/
   * New_York, start inclusive and end EXCLUSIVE (7..21 = the last text can
   * leave at 8:59pm). Ads approved outside the window wait for the next open
   * morning; nothing is ever sent in the middle of the night.
   */
  smsWindowStartHour: 7,
  smsWindowEndHour: 21,
  /** Days that never send, 0 = Sunday. Monday–Saturday is the user's rule. */
  smsQuietDays: [0],
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
   * keeps flowing; use the outbound stops to quiet other channels.
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
  /** Homepage promo banner (sales/announcements). Empty text = hidden. */
  promoBannerText: "",
  promoBannerLink: "/account#credits",
  /**
   * The two emergency stops (session 016, replacing the old three-way
   * pauseMode). They are INDEPENDENT because the failures are:
   *
   *   adsPaused      — no ad goes out. Approved ads queue and ride when it
   *                    comes back off; nothing is dropped.
   *   outboundPaused — every member-facing message that is NOT an ad stops:
   *                    command replies, PIC pictures, moderation notices.
   *                    Ads keep flowing (the user's decision — a wobble in
   *                    the account plumbing is no reason to go silent), and
   *                    so do CRITICAL sends: sign-in codes, operator alerts,
   *                    and the technical-difficulties notice itself.
   *
   * Turning either ON texts subscribers a plain-language notice, so nobody
   * is left wondering why the service went quiet. Queued ads wait; they are
   * never dropped.
   */
  adsPaused: false,
  outboundPaused: false,
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

  /* Line-type policy (session 016). All OFF by default: an unconfigured
   * deploy behaves exactly as it did before the feature existed, and turning
   * it on is a deliberate act that needs TWILIO_ACCOUNT_SID set. The three
   * VoIP switches only ever apply to a POSITIVELY identified throwaway line —
   * see lib/number-lookup.ts for why this withholds privileges rather than
   * blocking signups. */
  /* Paced release (session 016): when a backlog builds — an ads pause, an
   * outage, the overnight window — spread it out instead of firing it all at
   * once. Below the threshold nothing is paced and ads go the instant they
   * are approved, which is what instant send is for. */
  pacedReleaseOver: 4,
  pacedGapMinMinutes: 12,
  pacedGapMaxMinutes: 18,

  lookupEnabled: false,
  voipStarterCredit: false,
  voipReveals: false,
  voipPosting: true,
  /** Auto-tightened per-number command-reply cap/hour while underAttack. */
  attackRepliesPerHour: 5,
  /** Auto-tightened per-number PIC cap/hour while underAttack. */
  attackPicsPerHour: 2,
  /** Auto-tightened service-wide command-reply cap/hour while underAttack. */
  attackGlobalPerHour: 120,
  /** Starter word-filter list (flag-for-review). */
  filterWords: ["gun", "firearm", "rifle", "whiskey", "tobacco"],
} as const;
