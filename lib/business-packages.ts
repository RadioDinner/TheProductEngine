/**
 * Business advertising packages (FEATURES item 17) — the pure half: tiers,
 * field caps, the sponsor-line format, and the run-clock day math. Kept
 * deliberately import-free (like lib/pic-quota.ts and lib/myads.ts) so the
 * unit suite can pin it; lib/business.ts owns storage and lib/business-actions
 * the I/O.
 *
 * THE PRODUCT (user decisions, session 009):
 *   1 week $39.99 · 2 weeks $59.99 · 1 month $89.99 — the business's ad rides
 *   the daily digest once a day as a clearly-labeled "Sponsor:" line that
 *   NEVER consumes one of the 10 member ad slots. Payment is Stripe
 *   self-serve, but the ad still goes through the SAME human review as every
 *   member ad, and the run clock starts at APPROVAL, not payment.
 *
 * THE MISSED-DAY RULE (build decision, documented on /advertising and
 * /admin/help): a package expires when it has RIDDEN days-purchased distinct
 * ET days — not at a wall-clock date. A day whose digest never went out
 * (operator pause, segment-budget breaker, or simply no member ads that day)
 * doesn't consume a paid day; the run extends automatically and the admin
 * Business page shows the package as "behind schedule" so the operator sees
 * every missed day. Paid days are never silently eaten.
 */

export interface BusinessTier {
  id: string;
  label: string;
  days: number;
  priceCents: number;
}

/** The three packages (user-recorded pricing, session 009). */
export const BUSINESS_TIERS: BusinessTier[] = [
  { id: "week", label: "1 week", days: 7, priceCents: 3999 },
  { id: "twoweeks", label: "2 weeks", days: 14, priceCents: 5999 },
  { id: "month", label: "1 month", days: 30, priceCents: 8999 },
];

export function getBusinessTier(id: string): BusinessTier | null {
  return BUSINESS_TIERS.find((t) => t.id === id) ?? null;
}

/**
 * Field caps — sized so the whole sponsor line packs cleanly into the digest
 * (the packer's per-message ceiling is 612 GSM septets; a maxed-out sponsor
 * line stays well under it, so it can never crowd the member ads into an
 * extra message on its own).
 */
export const BUSINESS_NAME_MAX = 60;
export const BUSINESS_AD_MAX = 200;
export const BUSINESS_LINK_MAX = 100;

export interface SponsorAdFields {
  businessName: string;
  adText: string;
  link?: string | null;
  phone?: string | null;
}

/** Mirrors lib/phone formatPhone without importing it (module stays pure). */
function formatTen(ten: string): string {
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * The digest sponsor line — clearly labeled, e.g.
 *   Sponsor: Miller's Harness Shop - New harnesses in stock. (330) 555-0142 millers.example.com
 * The digest composer GSM-sanitizes every line it packs (this one included),
 * so a stray character can't flip the broadcast to UCS-2 pricing. In SMS the
 * link rides as plain text; the email edition makes it clickable.
 */
export function sponsorLine(p: SponsorAdFields): string {
  let line = `Sponsor: ${p.businessName} - ${p.adText}`;
  if (p.phone) line += ` ${/^\d{10}$/.test(p.phone) ? formatTen(p.phone) : p.phone}`;
  if (p.link) line += ` ${p.link}`;
  return line;
}

/** Whole days from ET day key A to B ("YYYY-MM-DD"); negative if b<a, 0 on bad input. */
export function dayDiff(dayA: string, dayB: string): number {
  const a = Date.parse(`${dayA}T00:00:00Z`);
  const b = Date.parse(`${dayB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface RunClock {
  /** ET day (YYYY-MM-DD) the run started — the approval day. */
  startsOn: string;
  daysPurchased: number;
  daysRan: number;
}

/** Paid days the package has left to ride. */
export function remainingDays(p: { daysPurchased: number; daysRan: number }): number {
  return Math.max(0, p.daysPurchased - p.daysRan);
}

/**
 * How many days behind schedule the run is: by the end of yesterday a package
 * approved on startsOn should have ridden one digest per full elapsed day
 * (capped at the purchase). The approval day itself is a grace day — a package
 * approved after the day's digests already went out isn't "behind" until
 * tomorrow. Behind > 0 means missed days: the run extends by exactly that
 * many days (expiry is by days ridden, not by date), and the admin page
 * surfaces the number.
 */
export function behindDays(p: RunClock, today: string): number {
  const expected = Math.min(p.daysPurchased, Math.max(0, dayDiff(p.startsOn, today)));
  return Math.max(0, expected - p.daysRan);
}

/** Scheduled last ET day of the run (start + days − 1) — display only. */
export function scheduledEndDay(startsOn: string, daysPurchased: number): string {
  const t = Date.parse(`${startsOn}T00:00:00Z`);
  if (Number.isNaN(t)) return startsOn;
  return new Date(t + (daysPurchased - 1) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Should this package ride the digest composing for ET day `day`?
 * Once per day per active package: it must still have paid days left and not
 * have ridden today already. (The FIRST composed digest of the day carries
 * it; this returning false for the rest of the day is the once-a-day rule.)
 */
export function sponsorDueOn(
  p: { status: string; daysPurchased: number; daysRan: number; lastRanOn: string | null },
  day: string,
): boolean {
  return p.status === "active" && p.daysRan < p.daysPurchased && p.lastRanOn !== day;
}
