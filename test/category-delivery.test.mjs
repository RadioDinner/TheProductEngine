// CATEGORY DELIVERY, END TO END (session 021, user: "we've never done any
// category testing").
//
// test/categories.test.mjs already covers the pure decisions in isolation:
// does this ad match this preference set, what does a menu reply choose, how
// does a toggle mutate state. What was never covered is the question the
// operator actually cares about — **given these ads and these subscribers, who
// receives which ad?** That answer comes out of buildCategorizedSmsRows, which
// partitions subscribers by preference set, filters each partition's ads, and
// emits one outbox row per part per phone. It is pure, so the whole delivery
// decision is testable here without a database.
//
// The failures this is guarding against are all silent ones: a subscriber
// quietly receiving a category they turned off (the complaint that costs a
// STOP), or quietly receiving nothing when they should have (the complaint
// that never arrives, because people who stop hearing from you don't write in).
import { buildCategorizedSmsRows } from "../lib/digest-engine.ts";

export const name = "category-delivery";

const NOW = new Date("2026-08-21T14:00:00Z");

/** A minimal approved ad — the composer reads id and body. */
const ad = (id, body) => ({
  id,
  ownerPhone: "3305550000",
  originalBody: body,
  body,
  status: "approved",
  createdAt: NOW.toISOString(),
  approvedAt: NOW.toISOString(),
});

const ADS = [
  ad(1001, "Belgian gelding, 8 years old, broke to drive. $2500"),
  ad(1002, "Beagle pups, 6 weeks, first shots. $150"),
  ad(1003, "New Holland baler, field ready. $4200"),
];

const CATEGORIES = new Map([
  [1001, "horses"],
  [1002, "dogs"],
  [1003, "machinery"],
]);

/** Which ad numbers reached this phone, read back off the outbox rows. */
function adsReceivedBy(rows, phone) {
  const got = new Set();
  for (const row of rows.filter((r) => r.address === phone)) {
    for (const [id] of CATEGORIES) if (row.body.includes(String(id))) got.add(id);
  }
  return [...got].sort();
}

const build = (recipients, over = {}) =>
  buildCategorizedSmsRows({
    digestId: 1,
    now: NOW,
    items: ADS,
    categoriesByAd: CATEGORIES,
    digestNo: 7,
    sponsorLines: [],
    recipients,
    ...over,
  });

export function run(t) {
  /* ---- the core promise: you get what you picked, and only that ---- */
  const mixed = build([
    { phone: "3305551000", categories: null }, // ALL
    { phone: "3305551001", categories: ["horses"] }, // horses only
    { phone: "3305551002", categories: ["dogs", "machinery"] }, // two picks
    { phone: "3305551003", categories: [] }, // warned dark
  ]);

  t.eq("ALL receives every ad", adsReceivedBy(mixed.rows, "3305551000"), [1001, 1002, 1003]);
  t.eq("a horses-only member receives the horse", adsReceivedBy(mixed.rows, "3305551001"), [1001]);
  // The one that matters most: NOT receiving what they turned off.
  t.eq(
    "a horses-only member receives nothing else",
    adsReceivedBy(mixed.rows, "3305551001").includes(1002),
    false,
  );
  t.eq("two picks receive both", adsReceivedBy(mixed.rows, "3305551002"), [1002, 1003]);
  t.eq(
    "two picks do not receive the third",
    adsReceivedBy(mixed.rows, "3305551002").includes(1001),
    false,
  );
  // The empty set was warned "You're not getting any ads now" — that copy has
  // to be literally true, so this member gets no row at all.
  t.eq("the empty set receives nothing", mixed.rows.filter((r) => r.address === "3305551003").length, 0);

  /* ---- an uncategorized ad rides every non-empty set ---- */
  const withUncategorized = buildCategorizedSmsRows({
    digestId: 1,
    now: NOW,
    items: ADS,
    // 1003 deliberately absent from the map = uncategorized (a skipped review
    // dropdown, or an ad from before categories existed).
    categoriesByAd: new Map([
      [1001, "horses"],
      [1002, "dogs"],
    ]),
    digestNo: 7,
    sponsorLines: [],
    recipients: [
      { phone: "3305551001", categories: ["horses"] },
      { phone: "3305551003", categories: [] },
    ],
  });
  t.eq(
    "an uncategorized ad rides a selective list",
    adsReceivedBy(withUncategorized.rows, "3305551001"),
    [1001, 1003],
  );
  t.eq(
    "an uncategorized ad still does NOT ride the empty set",
    withUncategorized.rows.filter((r) => r.address === "3305551003").length,
    0,
  );

  /* ---- subscribers with the same picks share one composition ---- */
  // Two members with the same set, written in different order, must be one
  // partition — otherwise the same batch is composed (and billed) twice.
  const shared = build([
    { phone: "3305552000", categories: ["dogs", "horses"] },
    { phone: "3305552001", categories: ["horses", "dogs"] },
  ]);
  t.eq("both are counted as recipients", shared.recipients, 2);
  t.eq(
    "and both receive the same ads",
    adsReceivedBy(shared.rows, "3305552000"),
    adsReceivedBy(shared.rows, "3305552001"),
  );
  const partsA = shared.rows.filter((r) => r.address === "3305552000").length;
  const partsB = shared.rows.filter((r) => r.address === "3305552001").length;
  t.eq("with identical part counts", partsA, partsB);

  /* ---- nobody in a category means no batch, not an empty one ---- */
  const noMatch = build([{ phone: "3305553000", categories: ["buggies"] }]);
  t.eq("a member whose categories match nothing gets no rows", noMatch.rows.length, 0);
  t.eq("and is not counted as reached", noMatch.recipients, 0);
  t.eq("no ad is marked delivered", noMatch.deliveredAdIds.size, 0);

  /* ---- ...unless a sponsor line is riding ---- */
  // Sponsors ride every non-empty set regardless of picks, so a member who
  // matched no ad still gets the sponsor edition. Without this the sponsor is
  // silently not delivering what was sold.
  const sponsored = build([{ phone: "3305553000", categories: ["buggies"] }], {
    sponsorLines: ["Miller's Harness Shop - open Sat 8-noon"],
  });
  t.eq("a sponsor line still reaches an unmatched member", sponsored.rows.length > 0, true);
  t.eq(
    "and the sponsor text is in it",
    sponsored.rows.some((r) => r.body.includes("Miller's Harness Shop")),
    true,
  );
  // ...carrying the sponsor and NOT some ad the member never asked for.
  t.eq("without smuggling in an unmatched ad", adsReceivedBy(sponsored.rows, "3305553000"), []);
  // But NEVER the warned-dark member.
  const sponsoredDark = build([{ phone: "3305551003", categories: [] }], {
    sponsorLines: ["Miller's Harness Shop - open Sat 8-noon"],
  });
  t.eq("a sponsor line does not reach the empty set", sponsoredDark.rows.length, 0);

  /* ---- deliveredAdIds reflects what actually went out ---- */
  const onlyDogs = build([{ phone: "3305554000", categories: ["dogs"] }]);
  t.eq("only the delivered ad is marked", [...onlyDogs.deliveredAdIds], [1002]);
  // This is what the per-ad reach analytics and the "did this ad go out" flag
  // read, so an ad nobody's categories matched must not be recorded as sent.
  t.eq("an undelivered ad is not marked", onlyDogs.deliveredAdIds.has(1001), false);

  /* ---- every row is addressed and ordered ---- */
  for (const row of mixed.rows) {
    t.eq(`row for ${row.address} has a body`, row.body.length > 0, true);
    t.eq(`row for ${row.address} is within its part count`, row.part <= row.parts, true);
  }
}
