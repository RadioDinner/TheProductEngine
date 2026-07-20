/**
 * Area registry (FEATURES item 26 / LONG_TERM_VISION V1). "The Plain
 * Exchange" is ONE brand; each AREA is a location-specific slice of it. An
 * area owns its own subscribers/ads/digests — keyed on the `county` column
 * that has existed on the core tables since init (default 'holmes') — and,
 * when it goes live, its own Telnyx SMS number + 10DLC campaign.
 *
 * BACKEND ONLY right now (user instruction): the on-page location selector is
 * built but HIDDEN behind AREAS_SELECTOR_ENABLED (false). Only Holmes is
 * live; the other areas are defined ahead of time so the selector, seed data,
 * and per-number inbound routing can be wired before any second area
 * launches. Adding, splitting, or renaming an area is a one-entry edit here.
 *
 * Kept import-free so the pure registry can be unit-tested in isolation; the
 * only runtime input is process.env (read lazily inside the number helpers).
 */

export interface Area {
  /** Stable slug — ALSO the value stored in the `county` column for this area. */
  slug: string;
  /** Public label, e.g. "Holmes County, OH". */
  name: string;
  /** Short label for tight UI (selector chips), e.g. "Holmes County". */
  shortName: string;
  /** USPS state abbreviation. */
  state: string;
  /** One line on what settlement / counties this area covers. */
  covers: string;
  /**
   * Name of the env var holding this area's Telnyx "from" number (E.164).
   * Holmes reuses the original TELNYX_FROM_NUMBER; every new area gets its
   * OWN number and its own 10DLC campaign (each is a separate registration).
   */
  smsNumberEnv: string;
  /** Live = number provisioned, campaign approved, open for real traffic. */
  live: boolean;
}

/**
 * The areas, in display order. Holmes is live today; the rest are the plain
 * settlements named for rollout. The Indiana entry is the Elkhart–LaGrange
 * settlement (Shipshewana/Topeka/Middlebury) as ONE area — the third-largest
 * Amish community — rather than a single town or county, so the whole
 * settlement shares one number. Split it into multiple entries here if you'd
 * rather run Nappanee (or Elkhart vs LaGrange) as separate numbers.
 */
export const AREAS: Area[] = [
  {
    slug: "holmes",
    name: "Holmes County, OH",
    shortName: "Holmes County",
    state: "OH",
    covers:
      "Holmes County and the surrounding Ohio Amish settlement — Berlin, Millersburg, Mt. Hope, Walnut Creek, Sugarcreek.",
    smsNumberEnv: "TELNYX_FROM_NUMBER",
    live: true,
  },
  {
    slug: "lancaster",
    name: "Lancaster County, PA",
    shortName: "Lancaster",
    state: "PA",
    covers:
      "The Lancaster County, Pennsylvania settlement — the oldest and one of the largest plain communities.",
    smsNumberEnv: "TELNYX_FROM_NUMBER_LANCASTER",
    live: false,
  },
  {
    slug: "elkhart-lagrange",
    name: "Elkhart–LaGrange, IN",
    shortName: "Northern Indiana",
    state: "IN",
    covers:
      "The Elkhart–LaGrange settlement in northern Indiana (Shipshewana, Topeka, Middlebury) — the third-largest Amish community.",
    smsNumberEnv: "TELNYX_FROM_NUMBER_ELKHART_LAGRANGE",
    live: false,
  },
  {
    slug: "big-valley",
    name: "Big Valley, PA",
    shortName: "Big Valley",
    state: "PA",
    covers:
      "The Kishacoquillas (Big) Valley in Mifflin County, PA — Belleville and Allensville — a distinctive plain settlement.",
    smsNumberEnv: "TELNYX_FROM_NUMBER_BIG_VALLEY",
    live: false,
  },
];

/** The area everything belongs to until areas are actually switched on. */
export const DEFAULT_AREA_SLUG = "holmes";

/**
 * Master switch for the on-page area/location selector. OFF by user request:
 * the backend (this registry, seed data, per-number routing) ships first;
 * flip this to true to reveal the selector once a second area is launching.
 */
export const AREAS_SELECTOR_ENABLED = false;

export function listAreas(): Area[] {
  return AREAS;
}

export function getArea(slug: string): Area | null {
  return AREAS.find((a) => a.slug === slug) ?? null;
}

export function defaultArea(): Area {
  return getArea(DEFAULT_AREA_SLUG)!;
}

/** Only the areas open for real traffic (a provisioned number + campaign). */
export function liveAreas(): Area[] {
  return AREAS.filter((a) => a.live);
}

/** Keep only the slugs that name a real area — for sanitizing a filter query. */
export function validAreaSlugs(slugs: string[]): string[] {
  return slugs.filter((s) => AREAS.some((a) => a.slug === s));
}

/** This area's Telnyx "from" number, if its env var is set (else null). */
export function areaSmsNumber(slug: string): string | null {
  const area = getArea(slug);
  if (!area) return null;
  return process.env[area.smsNumberEnv] ?? null;
}

/**
 * Which area owns an inbound Telnyx number? Maps a "to" number back to its
 * area by last-10-digit match, so a future multi-number inbound webhook can
 * route a text to the right area. Falls back to the default (Holmes) — which
 * is exactly today's single-number behaviour.
 */
export function areaForNumber(toNumber: string): Area {
  const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);
  const target = last10(toNumber);
  if (target) {
    for (const a of AREAS) {
      const n = process.env[a.smsNumberEnv];
      if (n && last10(n) === target) return a;
    }
  }
  return defaultArea();
}
