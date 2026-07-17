// Business advertising packages (FEATURES item 17) — the pure half: tier
// math, the sponsor-line format that rides the digest, and the run-clock day
// math behind "missed days extend the run, never silently eaten".
import {
  BUSINESS_AD_MAX,
  BUSINESS_NAME_MAX,
  BUSINESS_TIERS,
  behindDays,
  dayDiff,
  getBusinessTier,
  remainingDays,
  scheduledEndDay,
  sponsorDueOn,
  sponsorLine,
} from "../lib/business-packages.ts";

export const name = "business";

export function run(t) {
  // ---- tiers: the user-recorded pricing, exactly ----
  t.eq("three tiers", BUSINESS_TIERS.length, 3);
  t.eq("1 week price", getBusinessTier("week")?.priceCents, 3999);
  t.eq("1 week days", getBusinessTier("week")?.days, 7);
  t.eq("2 weeks price", getBusinessTier("twoweeks")?.priceCents, 5999);
  t.eq("2 weeks days", getBusinessTier("twoweeks")?.days, 14);
  t.eq("1 month price", getBusinessTier("month")?.priceCents, 8999);
  t.eq("1 month days", getBusinessTier("month")?.days, 30);
  t.eq("unknown tier is null", getBusinessTier("year"), null);

  // ---- sponsor line: clearly labeled, fields in order ----
  t.eq(
    "sponsor line — name + text only",
    sponsorLine({ businessName: "Miller's Harness Shop", adText: "New harnesses in stock." }),
    "Sponsor: Miller's Harness Shop - New harnesses in stock.",
  );
  t.eq(
    "sponsor line — phone formatted, link plain text",
    sponsorLine({
      businessName: "Miller's Harness Shop",
      adText: "New harnesses in stock.",
      phone: "3305550142",
      link: "millers.example.com",
    }),
    "Sponsor: Miller's Harness Shop - New harnesses in stock. (330) 555-0142 millers.example.com",
  );
  t.eq(
    "sponsor line — null link/phone omitted",
    sponsorLine({ businessName: "A", adText: "B", link: null, phone: null }),
    "Sponsor: A - B",
  );
  // A maxed-out line still packs comfortably under the 612-septet ceiling.
  const maxed = sponsorLine({
    businessName: "x".repeat(BUSINESS_NAME_MAX),
    adText: "y".repeat(BUSINESS_AD_MAX),
    phone: "3305550142",
    link: "z".repeat(100),
  });
  t.eq("maxed sponsor line stays packable", maxed.length < 400, true);

  // ---- day math ----
  t.eq("dayDiff same day", dayDiff("2026-07-17", "2026-07-17"), 0);
  t.eq("dayDiff forward", dayDiff("2026-07-17", "2026-07-24"), 7);
  t.eq("dayDiff backward", dayDiff("2026-07-24", "2026-07-17"), -7);
  t.eq("dayDiff across a month", dayDiff("2026-07-28", "2026-08-02"), 5);
  t.eq("dayDiff bad input", dayDiff("garbage", "2026-07-17"), 0);
  t.eq("scheduled end of a week run", scheduledEndDay("2026-07-17", 7), "2026-07-23");

  // ---- run clock: remaining / behind ----
  const week = (daysRan) => ({ startsOn: "2026-07-10", daysPurchased: 7, daysRan });
  t.eq("remaining, fresh", remainingDays({ daysPurchased: 7, daysRan: 0 }), 7);
  t.eq("remaining, spent", remainingDays({ daysPurchased: 7, daysRan: 7 }), 0);
  t.eq("remaining never negative", remainingDays({ daysPurchased: 7, daysRan: 9 }), 0);

  // Approval day is a grace day: not behind on day one even before riding.
  t.eq("approval day — not behind", behindDays(week(0), "2026-07-10"), 0);
  // Rode every day: on schedule.
  t.eq("on schedule mid-run", behindDays(week(3), "2026-07-13"), 0);
  // Digest suppressed two days (pause/breaker): behind by exactly those days.
  t.eq("two missed days show", behindDays(week(1), "2026-07-13"), 2);
  // Behind caps at the purchase: a long outage can't owe more than paid days.
  t.eq("behind caps at purchase", behindDays(week(0), "2026-09-01"), 7);
  // Fully-ridden run is never behind, no matter the date.
  t.eq("completed run not behind", behindDays(week(7), "2026-09-01"), 0);

  // ---- once-a-day riding rule ----
  const pkg = (over) => ({
    status: "active",
    daysPurchased: 7,
    daysRan: 2,
    lastRanOn: "2026-07-12",
    ...over,
  });
  t.eq("due on a new day", sponsorDueOn(pkg(), "2026-07-13"), true);
  t.eq("NOT due twice the same day", sponsorDueOn(pkg(), "2026-07-12"), false);
  t.eq("never-ran package is due", sponsorDueOn(pkg({ lastRanOn: null }), "2026-07-13"), true);
  t.eq(
    "spent package not due",
    sponsorDueOn(pkg({ daysRan: 7 }), "2026-07-13"),
    false,
  );
  t.eq(
    "pending package not due",
    sponsorDueOn(pkg({ status: "pending_review" }), "2026-07-13"),
    false,
  );
  t.eq(
    "expired package not due",
    sponsorDueOn(pkg({ status: "expired" }), "2026-07-13"),
    false,
  );
}
