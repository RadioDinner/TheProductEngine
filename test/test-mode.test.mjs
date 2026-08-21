// TEST MODE (session 021). The dangerous states are the ones where the switch
// LOOKS on but the send path disagrees — every one of those is pinned here,
// because the failure they produce is silent: ads keep flowing, every admin
// screen reads healthy, and the subscriber list receives nothing.
import {
  TEST_MODE_MAX_HOURS,
  TEST_NUMBERS_MAX,
  narrowToTestNumbers,
  parseTestNumbers,
  testModeActive,
  testModeExpiry,
  testModeMinutesLeft,
  testModeState,
  unsubscribedTestNumbers,
} from "../lib/test-mode.ts";

export const name = "test-mode";

const NOW = Date.parse("2026-08-21T12:00:00Z");
const LATER = (h) => new Date(NOW + h * 3600_000).toISOString();

/** A config with test mode genuinely in force. */
const live = (over = {}) => ({
  testMode: true,
  testNumbers: "3305551212,3305551213",
  testModeExpiresAt: LATER(2),
  ...over,
});

export function run(t) {
  /* ---- parsing the number list ---- */
  t.eq("plain ten digits", parseTestNumbers("3305551212"), ["3305551212"]);
  t.eq("comma separated", parseTestNumbers("3305551212,3305551213"), [
    "3305551212",
    "3305551213",
  ]);
  t.eq("punctuation and spaces survive", parseTestNumbers(" (330) 555-1212 , 330.555.1213 "), [
    "3305551212",
    "3305551213",
  ]);
  t.eq("leading US country code is stripped", parseTestNumbers("+1 330 555 1212"), ["3305551212"]);
  t.eq("duplicates collapse", parseTestNumbers("3305551212,(330) 555-1212"), ["3305551212"]);
  t.eq("empty is empty", parseTestNumbers(""), []);
  t.eq("null is empty", parseTestNumbers(null), []);
  // A typo must DROP, never be guessed at — a half-parsed number could be a
  // real member's phone, and they would receive the operator's test ads.
  t.eq("too short is dropped", parseTestNumbers("33055512"), []);
  t.eq("too long is dropped", parseTestNumbers("330555121234"), []);
  t.eq("letters are dropped", parseTestNumbers("call-me"), []);
  t.eq("area code starting 0 is dropped", parseTestNumbers("0305551212"), []);
  t.eq("area code starting 1 is dropped", parseTestNumbers("1305551212"), []);
  t.eq("exchange starting 0 is dropped", parseTestNumbers("3300551212"), []);
  t.eq("exchange starting 1 is dropped", parseTestNumbers("3301551212"), []);
  t.eq("a good number survives a bad neighbour", parseTestNumbers("nope,3305551212"), [
    "3305551212",
  ]);
  const many = parseTestNumbers(
    "3305551212,3305551213,3305551214,3305551215,3305551216,3305551217,3305551218",
  );
  t.eq("the list is capped", many.length, TEST_NUMBERS_MAX);

  /* ---- when is it actually in force ---- */
  t.eq("switch on, numbers set, not expired -> ACTIVE", testModeActive(live(), NOW), true);
  t.eq("switch off -> inactive", testModeActive(live({ testMode: false }), NOW), false);
  // The deadline is the whole safety story: a forgotten switch stops mattering.
  t.eq("past the deadline -> inactive", testModeActive(live({ testModeExpiresAt: LATER(-1) }), NOW), false);
  t.eq("exactly at the deadline -> inactive", testModeActive(live({ testModeExpiresAt: LATER(0) }), NOW), false);
  // A corrupted or absent timestamp must read as EXPIRED, never as forever —
  // "on with no deadline" is precisely the indefinite silent outage this
  // whole mechanism exists to make impossible.
  t.eq("missing expiry -> inactive", testModeActive(live({ testModeExpiresAt: "" }), NOW), false);
  t.eq("garbage expiry -> inactive", testModeActive(live({ testModeExpiresAt: "soon" }), NOW), false);
  // On with an EMPTY recipient list would mean every ad goes to nobody at all.
  // Reading that as OFF makes the worst case of a half-finished setting "ads
  // went out normally" instead of a service-wide blackout.
  t.eq("no test numbers -> inactive", testModeActive(live({ testNumbers: "" }), NOW), false);
  t.eq("only unusable numbers -> inactive", testModeActive(live({ testNumbers: "abc,12" }), NOW), false);

  /* ---- the state the admin screen shows ---- */
  t.eq("state active", testModeState(live(), NOW), "active");
  t.eq("state off", testModeState(live({ testMode: false }), NOW), "off");
  t.eq("state expired", testModeState(live({ testModeExpiresAt: LATER(-1) }), NOW), "expired");
  t.eq("state no-numbers", testModeState(live({ testNumbers: "" }), NOW), "no-numbers");
  // "off" and "no-numbers" are BOTH inactive but must not read the same: one
  // is a deliberate state, the other is a setting the operator half-finished.
  t.eq(
    "no-numbers is distinguishable from off",
    testModeState(live({ testNumbers: "" }), NOW) === testModeState(live({ testMode: false }), NOW),
    false,
  );

  /* ---- the countdown ---- */
  t.eq("two hours left", testModeMinutesLeft(live(), NOW), 120);
  t.eq("expired reads zero", testModeMinutesLeft(live({ testModeExpiresAt: LATER(-3) }), NOW), 0);
  t.eq("missing expiry reads zero", testModeMinutesLeft(live({ testModeExpiresAt: "" }), NOW), 0);
  const stamped = testModeExpiry(NOW);
  t.eq("a fresh stamp is in force", testModeActive(live({ testModeExpiresAt: stamped }), NOW), true);
  t.eq(
    "a fresh stamp lasts the documented window",
    testModeMinutesLeft(live({ testModeExpiresAt: stamped }), NOW),
    TEST_MODE_MAX_HOURS * 60,
  );
  // ...and it really does run out, rather than being a decoration.
  t.eq(
    "the stamp expires",
    testModeActive(live({ testModeExpiresAt: stamped }), NOW + (TEST_MODE_MAX_HOURS + 1) * 3600_000),
    false,
  );

  /* ---- narrowing the audience ---- */
  const list = [
    { phone: "3305551212", categories: null },
    { phone: "3305551213", categories: ["horses"] },
    { phone: "3305559999", categories: null },
    { phone: "2165550000", categories: [] },
  ];
  const narrowed = narrowToTestNumbers(list, ["3305551212", "3305551213"]);
  t.eq("only the test numbers survive", narrowed.map((r) => r.phone), [
    "3305551212",
    "3305551213",
  ]);
  // The single most important property: narrowing FILTERS the real rows, so a
  // test recipient keeps its own category prefs. Synthesizing a recipient
  // would bypass exactly the subscriber plumbing a test is meant to exercise.
  t.eq("the real category prefs come through", narrowed[1].categories, ["horses"]);
  t.eq("a real subscriber is not reachable", narrowed.some((r) => r.phone === "3305559999"), false);
  // A test number that is not a subscriber yields nothing — it is never
  // invented into the list.
  t.eq("an unsubscribed test number is not invented", narrowToTestNumbers(list, ["4405551111"]), []);
  t.eq("an empty allow-list sends to nobody", narrowToTestNumbers(list, []), []);
  t.eq("E.164 rows still match", narrowToTestNumbers([{ phone: "+13305551212" }], ["3305551212"]).length, 1);

  /* ---- which test numbers would hear nothing ---- */
  t.eq(
    "an unsubscribed test number is named",
    unsubscribedTestNumbers(list, ["3305551212", "4405551111"]),
    ["4405551111"],
  );
  t.eq("all subscribed -> nothing to warn about", unsubscribedTestNumbers(list, ["3305551212"]), []);
}
