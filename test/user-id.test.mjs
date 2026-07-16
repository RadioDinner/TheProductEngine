// USER_ID (FEATURES item 0) — 6 random digits, leading zeros allowed, and the
// one-year retirement window for merged-away ids.
import {
  USER_ID_RETIREMENT_MS,
  isRetirementActive,
  isValidUserId,
  randomUserId,
} from "../lib/user-id.ts";

export const name = "user-id";

const DAY = 24 * 60 * 60 * 1000;

export function run(t) {
  // Shape: always exactly 6 digits, zero-padded.
  t.eq("rng 0 pads to 000000", randomUserId(() => 0), "000000");
  t.eq("rng max stays 6 digits", randomUserId(() => 0.9999999), "999999");
  t.eq("mid value", randomUserId(() => 0.123456), "123456");
  t.eq("small value zero-pads", randomUserId(() => 0.000042), "000042");
  const sample = randomUserId();
  t.eq("real rng shape", /^[0-9]{6}$/.test(sample), true);

  // Validation.
  t.eq("valid id", isValidUserId("004217"), true);
  t.eq("too short", isValidUserId("12345"), false);
  t.eq("too long", isValidUserId("1234567"), false);
  t.eq("letters rejected", isValidUserId("12a456"), false);

  // Retirement window: not reusable for a whole year, reusable after.
  const now = Date.parse("2026-07-16T12:00:00Z");
  t.eq("retired yesterday is active", isRetirementActive(new Date(now - DAY).toISOString(), now), true);
  t.eq(
    "retired 364 days ago is active",
    isRetirementActive(new Date(now - 364 * DAY).toISOString(), now),
    true,
  );
  t.eq(
    "retired just over a year ago is free",
    isRetirementActive(new Date(now - USER_ID_RETIREMENT_MS - 1).toISOString(), now),
    false,
  );
  t.eq("garbage timestamp is not active", isRetirementActive("not-a-date", now), false);
}
