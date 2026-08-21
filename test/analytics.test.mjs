/**
 * Unit checks for the staged analytics library.
 *
 * Run it:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *        --loader ./test/abuse/alias-loader.mjs analytics/test/analytics.test.mjs
 *
 * (The loader already lives in the repo — it resolves extensionless TypeScript
 * imports. Nothing outside analytics/ is modified to run this.)
 *
 * It also exports `name` and `run(t)` in the shape test/run.mjs expects, so
 * registering it in the main suite later is a one-line change; see
 * analytics/04-wiring.md.
 *
 * What is worth testing here, and what is not: none of this proves GA is
 * receiving anything — only Google's debug endpoint and DebugView can do that.
 * What it does prove is that the rules with no error message are obeyed. GA4
 * discards a reserved event name, a 26th parameter, and a 101st character
 * silently, returning success either way. Those are the failures that cost a
 * month of trusting an empty report, so they are the ones pinned here.
 */

// Set before the modules load: config.ts reads the environment once, at import.
process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TESTID1234";
process.env.GA_API_SECRET = "test-api-secret";
process.env.ANALYTICS_SALT = "test-salt";

export const name = "analytics";

export async function run(t) {
  const events = await import("../analytics/src/events");
  const ids = await import("../analytics/src/ids");
  const mp = await import("../analytics/src/measurement-protocol");
  const server = await import("../analytics/src/server-events");
  const track = await import("../analytics/src/track");

  // ── The catalogue is legal GA4 ─────────────────────────────────────────
  {
    const seen = new Set();
    let illegal = 0;
    let duplicate = 0;
    let unexplained = 0;
    let badParam = 0;
    for (const spec of events.EVENT_CATALOGUE) {
      if (events.eventNameProblem(spec.name)) illegal++;
      if (seen.has(spec.name)) duplicate++;
      seen.add(spec.name);
      if (!spec.question || spec.question.length < 10) unexplained++;
      for (const p of spec.params) {
        if (events.paramNameProblem(p)) badParam++;
      }
    }
    t.eq("catalogue: no illegal event names", illegal, 0);
    t.eq("catalogue: no duplicate event names", duplicate, 0);
    t.eq("catalogue: every event says what it answers", unexplained, 0);
    t.eq("catalogue: no illegal parameter names", badParam, 0);
    t.eq("catalogue: is not empty", events.EVENT_CATALOGUE.length > 25, true);
  }

  // ── The reserved-name trap this product walks straight into ────────────
  {
    t.eq(
      "ad_click is rejected (GA4 reserved)",
      events.eventNameProblem("ad_click") !== null,
      true,
    );
    t.eq(
      "ad_impression is rejected (GA4 reserved)",
      events.eventNameProblem("ad_impression") !== null,
      true,
    );
    t.eq("session_start is rejected", events.eventNameProblem("session_start") !== null, true);
    t.eq("firebase_ prefix is rejected", events.eventNameProblem("firebase_x") !== null, true);
    t.eq("a leading underscore is rejected", events.eventNameProblem("_x") !== null, true);
    t.eq("a leading digit is rejected", events.eventNameProblem("1listing") !== null, true);
    t.eq("listing_view is fine", events.eventNameProblem("listing_view"), null);
    // The whole reason the catalogue says "listing" and not "ad".
    const usesReserved = events.EVENT_CATALOGUE.filter((e) =>
      events.RESERVED_EVENT_NAMES.has(e.name),
    );
    t.eq("catalogue avoids every reserved name", usesReserved.length, 0);
  }

  // ── Parameter clamping ─────────────────────────────────────────────────
  {
    const long = "x".repeat(150);
    const clean = events.sanitizeParams({ note: long });
    t.eq("a 150-char value is cut to 100", clean.params.note.length, 100);

    const many = {};
    for (let i = 0; i < 30; i++) many[`p${i}`] = i;
    const clamped = events.sanitizeParams(many);
    t.eq("only 25 parameters survive", Object.keys(clamped.params).length, 25);
    t.eq("the other 5 are reported, not silently lost", clamped.dropped.length, 5);

    const illegal = events.sanitizeParams({ "bad-name": 1, good_name: 2 });
    t.eq("an illegal parameter name is dropped", "bad-name" in illegal.params, false);
    t.eq("a legal one beside it survives", illegal.params.good_name, 2);

    const withUndefined = events.sanitizeParams({ a: undefined, b: 1 });
    t.eq("undefined is omitted entirely", "a" in withUndefined.params, false);

    const items = events.sanitizeParams({ items: [{ item_id: "ad_1" }] });
    t.eq("an items array passes through", Array.isArray(items.params.items), true);
  }

  // ── Nothing that identifies a person leaves the browser ────────────────
  {
    t.eq(
      "a phone number in a string is scrubbed",
      track.scrubValue("call me at (330) 960-7170 today"),
      "call me at [phone] today",
    );
    t.eq(
      "a dotted phone number is scrubbed",
      track.scrubValue("330.960.7170"),
      "[phone]",
    );
    t.eq(
      "an email address is scrubbed",
      track.scrubValue("write to sam@example.com"),
      "write to [email]",
    );
    t.eq(
      "ordinary words are left alone",
      track.scrubValue("two draft horses, broke to harness"),
      "two draft horses, broke to harness",
    );
  }

  // ── Identity: stable, salted, and never the phone number ───────────────
  {
    const a = ids.hashedMemberId("(330) 960-7170", "salt");
    const b = ids.hashedMemberId("3309607170", "salt");
    const c = ids.hashedMemberId("13309607170", "salt");
    t.eq("formatting does not change the hash", a, b);
    t.eq("a leading 1 does not change the hash", a, c);
    t.eq("the hash carries the m_ marker", a.startsWith("m_"), true);
    t.eq("the hash is 34 characters", a.length, 34);
    t.eq("the phone digits are absent from the hash", a.includes("3309607170"), false);
    t.eq(
      "a different salt gives a different hash",
      ids.hashedMemberId("3309607170", "other") !== a,
      true,
    );
    t.eq("no salt means no id, never a raw fallback", ids.hashedMemberId("3309607170", ""), "");
    t.eq("a short number gives no id", ids.hashedMemberId("12345", "salt"), "");

    const cid = ids.syntheticClientId(a);
    t.eq("the synthetic client id is <int>.<int>", /^\d+\.\d+$/.test(cid), true);
    t.eq("it is stable across calls", cid, ids.syntheticClientId(a));
    t.eq(
      "two members do not share a client id",
      cid !== ids.clientIdForPhone("3309607171", "salt"),
      true,
    );

    t.eq(
      "the _ga cookie is parsed",
      ids.gaClientIdFromCookie("GA1.1.1234567890.1712345678"),
      "1234567890.1712345678",
    );
    t.eq(
      "the GA1.2 variant is parsed",
      ids.gaClientIdFromCookie("GA1.2.987654321.1700000000"),
      "987654321.1700000000",
    );
    t.eq(
      "a bare client id is accepted",
      ids.gaClientIdFromCookie("1234567890.1712345678"),
      "1234567890.1712345678",
    );
    t.eq("junk gives null", ids.gaClientIdFromCookie("nonsense"), null);
    t.eq("nothing gives null", ids.gaClientIdFromCookie(undefined), null);

    const day1 = ids.dailyVisitorHash("1.2.3.4", "Mozilla", "salt", "2026-08-20");
    const day2 = ids.dailyVisitorHash("1.2.3.4", "Mozilla", "salt", "2026-08-21");
    t.eq("the same visitor is one token within a day", day1, ids.dailyVisitorHash("1.2.3.4", "Mozilla", "salt", "2026-08-20"));
    t.eq("the token rotates at midnight, so it cannot follow anyone", day1 !== day2, true);
  }

  // ── The payload GA will actually accept ────────────────────────────────
  {
    const built = mp.buildPayload(
      { clientId: "1.2", userId: "m_abc", sessionId: 42, events: [] },
      [{ name: "post_submit", params: { channel: "sms" } }],
    );
    const ev = built.payload.events[0];
    t.eq("engagement_time_msec is always sent", ev.params.engagement_time_msec, 1);
    t.eq("session_id is always sent", ev.params.session_id, "42");
    t.eq("the event parameters survive", ev.params.channel, "sms");
    t.eq("the client id is set", built.payload.client_id, "1.2");
    t.eq("the user id is set", built.payload.user_id, "m_abc");
    t.eq("ad personalisation is denied on every event", built.payload.consent.ad_personalization, "DENIED");
    t.eq("ad user data is denied on every event", built.payload.consent.ad_user_data, "DENIED");
    t.eq("non_personalized_ads is set", built.payload.non_personalized_ads, true);

    const noUser = mp.buildPayload({ clientId: "1.2", events: [] }, [{ name: "x" }]);
    t.eq("no user id means the key is absent, not empty", "user_id" in noUser.payload, false);

    // debug_mode is what makes a SERVER event visible in DebugView. Without it
    // a freshly wired integration is unverifiable for up to 48 hours, because
    // the live endpoint answers 204 either way and the standard reports lag.
    t.eq("debug_mode is off by default", "debug_mode" in ev.params, false);
    const debug = mp.buildPayload({ clientId: "1.2", events: [], debugMode: true }, [
      { name: "post_submit" },
    ]);
    t.eq("debug_mode rides on every event when asked for", debug.payload.events[0].params.debug_mode, true);

    const props = mp.buildPayload(
      {
        clientId: "1.2",
        events: [],
        userProperties: { member_status: "seller", posts: 3 },
      },
      [{ name: "x" }],
    );
    t.eq("user properties take GA's wire shape", props.payload.user_properties.member_status.value, "seller");
    t.eq("numeric user properties are kept numeric", props.payload.user_properties.posts.value, 3);
  }

  // ── Batching and the 72-hour window ────────────────────────────────────
  {
    const sixty = Array.from({ length: 60 }, (_, i) => ({ name: `e${i}` }));
    const batches = mp.batchEvents(sixty);
    t.eq("60 events become 3 requests", batches.length, 3);
    t.eq("the first request holds GA's maximum of 25", batches[0].length, 25);
    t.eq("the last holds the remainder", batches[2].length, 10);
    t.eq("no events are lost in batching", batches.flat().length, 60);
    t.eq("an empty list makes no requests", mp.batchEvents([]).length, 0);

    const now = Date.UTC(2026, 7, 20, 12, 0, 0);
    t.eq("an event from an hour ago is in the window", mp.withinBackdateWindow((now - 3600e3) * 1000, now), true);
    t.eq("an event from 4 days ago is not", mp.withinBackdateWindow((now - 4 * 86400e3) * 1000, now), false);
    t.eq("an event from the future is not", mp.withinBackdateWindow((now + 60e3) * 1000, now), false);
  }

  // ── Sending: batched, timed out, and never fatal ───────────────────────
  {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { status: 204, ok: true, json: async () => ({}) };
    };
    const res = await mp.sendServerEvents({
      clientId: "1.2",
      events: Array.from({ length: 30 }, (_, i) => ({ name: `e${i}` })),
      fetchImpl: fakeFetch,
      endpointOverride: "https://example.test/mp",
    });
    t.eq("30 events go out in 2 requests", calls.length, 2);
    t.eq("all 30 are reported sent", res.eventsSent, 30);
    t.eq("the result is ok", res.ok, true);
    t.eq("the measurement id rides on the query string", calls[0].url.includes("measurement_id="), true);
    t.eq("the api secret rides on the query string", calls[0].url.includes("api_secret="), true);

    // The next two checks make the library log on purpose. Muting console.error
    // around them keeps a deliberate failure from reading like a broken suite —
    // a stack trace in passing output is how people learn to ignore output.
    const realError = console.error;
    console.error = () => {};
    let failed;
    let rejected;
    try {
      const exploding = async () => {
        throw new Error("network is down");
      };
      failed = await mp.sendServerEvents({
        clientId: "1.2",
        events: [{ name: "post_submit" }],
        fetchImpl: exploding,
        endpointOverride: "https://example.test/mp",
      });
      rejected = await mp.sendServerEvents({
        clientId: "1.2",
        events: [{ name: "post_submit" }],
        fetchImpl: async () => ({ status: 400, ok: false, json: async () => ({}) }),
        endpointOverride: "https://example.test/mp",
      });
    } finally {
      console.error = realError;
    }
    t.eq("a network failure is reported, not thrown", failed.ok, false);
    t.eq("and nothing is counted as sent", failed.eventsSent, 0);
    t.eq("a 400 is not counted as sent", rejected.eventsSent, 0);

    const noClient = await mp.sendServerEvents({
      clientId: "",
      events: [{ name: "post_submit" }],
      fetchImpl: fakeFetch,
      endpointOverride: "https://example.test/mp",
    });
    t.eq("no client id sends nothing", noClient.skipped, "no client_id");

    const before = calls.length;
    await mp.sendServerEvents({
      clientId: "1.2",
      events: [],
      fetchImpl: fakeFetch,
      endpointOverride: "https://example.test/mp",
    });
    t.eq("an empty event list makes no request", calls.length, before);
  }

  // ── Every emitting server action registers after() ────────────────────
  // A static check, because this is the one bug class a unit test cannot
  // reach: analytics/src/after.ts takes its implementation by injection, and
  // a file that emits without importing the registration silently degrades to
  // unawaited fire-and-forget. On serverless that means an undercount of
  // unknown size that still looks entirely plausible — it happened, to twelve
  // events including two key events, and nothing failed.
  {
    const { readdirSync, readFileSync } = await import("node:fs");

    // Loaded by the unit and abuse suites under plain node, where next/server
    // does not resolve. They must NOT import the registration; their CALLERS
    // register instead, and registration is process-wide.
    // ad-billing.ts joined this set in session 023: digest-engine imports it
    // (the batch is what collects for an ad now), so it is loaded under plain
    // node by everything that loads digest-engine.
    // engine-store.ts joined in session 024: creating an ad with a picture
    // schedules the SMS label after the response, and the store is imported by
    // nearly every module the suites load. Its callers all register — the
    // Telnyx inbound route, the digest cron, post-actions and admin-actions.
    const TEST_LOADED = new Set([
      "engine.ts",
      "moderation.ts",
      "digest-engine.ts",
      "ad-billing.ts",
      "engine-store.ts",
      "analytics.ts",
    ]);

    const offenders = [];
    const testLoadedImportingNextServer = [];
    for (const file of readdirSync("lib").filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(`lib/${file}`, "utf8");
      const emits = src.includes("analytics/src/server-events") || src.includes("afterResponse(");
      if (!emits) continue;
      if (TEST_LOADED.has(file)) {
        if (src.includes('from "next/server"')) testLoadedImportingNextServer.push(file);
        continue;
      }
      if (!src.includes("analytics/src/register-after")) offenders.push(file);
    }
    t.eq(
      `every emitting server action registers after() (missing: ${offenders.join(", ") || "none"})`,
      offenders.length,
      0,
    );
    t.eq(
      `test-loaded lib files never import next/server (violations: ${testLoadedImportingNextServer.join(", ") || "none"})`,
      testLoadedImportingNextServer.length,
      0,
    );
  }

  // ── after(): the injection itself ─────────────────────────────────────
  {
    const mod = await import("../analytics/src/after");
    mod.clearAfterImpl();
    t.eq("with nothing registered, no implementation is reported", mod.afterImplRegistered(), false);

    let ranInline = false;
    mod.afterResponse(() => {
      ranInline = true;
    });
    t.eq("unregistered work still runs, inline", ranInline, true);

    const scheduled = [];
    mod.setAfterImpl((work) => scheduled.push(work));
    t.eq("registration is reported", mod.afterImplRegistered(), true);
    mod.afterResponse(() => {});
    t.eq("registered work is handed to the implementation", scheduled.length, 1);

    // after() throws when called outside a request scope. The fallback must
    // still run the work rather than losing it.
    let ranAfterThrow = false;
    mod.setAfterImpl(() => {
      throw new Error("outside a request scope");
    });
    mod.afterResponse(() => {
      ranAfterThrow = true;
    });
    t.eq("a throwing implementation falls back to inline", ranAfterThrow, true);

    // A rejected promise from unawaited work must not escape — an unhandled
    // rejection can take the process down, and analytics must never do that.
    mod.clearAfterImpl();
    let threw = false;
    try {
      mod.afterResponse(async () => {
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    t.eq("a rejecting job never throws out of afterResponse", threw, false);

    mod.clearAfterImpl();
  }

  // ── The helpers callers will actually use ──────────────────────────────
  {
    t.eq("the ET day key is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(server.etDayKey()), true);
    // 2026-01-01 04:30 UTC is 11:30pm on New Year's Eve in Eastern time — the
    // case that matters, because every daily figure in this app is ET-bucketed
    // and a UTC day key would file the evening's activity under tomorrow.
    t.eq(
      "the day key follows Eastern time, not UTC",
      server.etDayKey(new Date("2026-01-01T04:30:00Z")),
      "2025-12-31",
    );
    t.eq(
      "and rolls over at ET midnight, not UTC midnight",
      server.etDayKey(new Date("2026-01-01T05:30:00Z")),
      "2026-01-01",
    );
    // A member we cannot identify produces no event rather than a bad one.
    let threw = false;
    try {
      await server.emit({}, [{ name: "post_submit" }]);
    } catch {
      threw = true;
    }
    t.eq("an unidentifiable member is a no-op, not a crash", threw, false);
  }
}

// Standalone runner, so this file is useful before it joins the main suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  let pass = 0;
  const failures = [];
  const t = {
    eq(label, got, want) {
      if (Object.is(got, want)) pass++;
      else failures.push(`${label}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
    },
  };
  await run(t);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.log(`analytics: ${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
