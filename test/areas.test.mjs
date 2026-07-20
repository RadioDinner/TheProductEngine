// Area registry (FEATURES item 26 / LONG_TERM_VISION V1): the pure registry
// the location selector, seed data, and per-number inbound routing read from.
// Backend-only for now (the selector is hidden), but the data is load-bearing
// once areas switch on, so pin its shape.
import {
  AREAS,
  DEFAULT_AREA_SLUG,
  defaultArea,
  getArea,
  listAreas,
  liveAreas,
  validAreaSlugs,
} from "../lib/areas.ts";

export const name = "areas";

export function run(t) {
  t.eq("default slug is holmes", DEFAULT_AREA_SLUG, "holmes");
  t.eq("default area resolves", defaultArea().slug, "holmes");
  t.eq("listAreas returns the registry", listAreas().length, AREAS.length);

  // The four named plain settlements are all present.
  t.eq("four areas defined", AREAS.length, 4);
  t.eq("holmes present", getArea("holmes")?.state, "OH");
  t.eq("lancaster present", getArea("lancaster")?.state, "PA");
  t.eq("northern indiana present", getArea("elkhart-lagrange")?.state, "IN");
  t.eq("big valley present", getArea("big-valley")?.state, "PA");
  t.eq("unknown area is null", getArea("nope"), null);

  // Only Holmes is live until the others are provisioned.
  t.eq("holmes is the only live area", liveAreas().map((a) => a.slug), ["holmes"]);

  // Slugs must be unique — they double as the stored `county` value.
  const slugs = AREAS.map((a) => a.slug);
  t.eq("slugs are unique", new Set(slugs).size, slugs.length);

  // Every area is fully labeled (name/shortName/covers) for the selector.
  t.eq(
    "every area is labeled",
    AREAS.every((a) => a.name && a.shortName && a.covers),
    true,
  );

  // Each NEW area gets its own number env — never the base Holmes number,
  // because each area is its own 10DLC campaign.
  const others = AREAS.filter((a) => a.slug !== "holmes");
  t.eq(
    "new areas have distinct number envs",
    others.every((a) => a.smsNumberEnv && a.smsNumberEnv !== "TELNYX_FROM_NUMBER"),
    true,
  );
  t.eq(
    "number envs are unique",
    new Set(AREAS.map((a) => a.smsNumberEnv)).size,
    AREAS.length,
  );

  // validAreaSlugs sanitizes a filter query down to real areas.
  t.eq(
    "validAreaSlugs keeps real, drops junk",
    validAreaSlugs(["holmes", "lancaster", "atlantis", ""]),
    ["holmes", "lancaster"],
  );
}
