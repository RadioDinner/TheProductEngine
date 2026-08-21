/**
 * Deployment diagnostics. The DETAILED report (which env vars are present, the
 * Supabase key *kind*, live table row counts, DB error strings) is operator-
 * only: it requires `Authorization: Bearer <CRON_SECRET>`, because that posture
 * is useful reconnaissance to an attacker. Unauthenticated callers get liveness
 * only. In dev (no NODE_ENV=production) the full report is open for convenience.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db, supabaseConfigured } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { getEngineSettings } from "@/lib/settings";
import { parseTestNumbers, testModeMinutesLeft, testModeState } from "@/lib/test-mode";
import { site } from "@/lib/config";

function keyKind(key: string | undefined): string {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "sb_secret (correct)";
  if (key.startsWith("sb_publishable_")) return "sb_publishable (WRONG — this is the public key)";
  if (key.startsWith("eyJ")) return "legacy JWT (fine if it's the service_role one)";
  return "unrecognized format";
}

/** Telnyx sends `from` verbatim — anything but E.164 (+1XXXXXXXXXX) 400s every
 * reply, and a WRONG owned number is accepted by the API but carrier-filtered
 * (10DLC: only the campaign-linked number delivers). Echo the last 4 so a
 * stale value is visible without opening the Vercel dashboard. */
function fromNumberKind(value: string | undefined): string {
  if (!value) return "missing";
  const last4 = value.replace(/\D/g, "").slice(-4);
  return /^\+1\d{10}$/.test(value)
    ? `set (E.164, ends ${last4})`
    : `set but NOT +1XXXXXXXXXX (ends ${last4}) — Telnyx sends will fail`;
}

/** Operator check: the detailed report needs the CRON_SECRET bearer (open in dev). */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !isProduction;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(req: NextRequest) {
  const mode = supabaseConfigured ? "supabase" : "fixtures/file store";
  if (!authorized(req)) {
    // Liveness only — no env posture, key kinds, row counts, or DB errors.
    return NextResponse.json({ ok: true, mode });
  }

  const report: Record<string, unknown> = {
    // Same constant the footer shows, so "what's deployed?" can be answered
    // from either end and the two can never disagree.
    version: site.version,
    mode: supabaseConfigured
      ? "supabase"
      : "fixtures/file store (misconfigured for Vercel — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    env: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY),
      SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
      ADMIN_PHONES: Boolean(process.env.ADMIN_PHONES),
      SITE_URL: process.env.SITE_URL ?? null,
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      TELNYX_API_KEY: Boolean(process.env.TELNYX_API_KEY),
      TELNYX_PUBLIC_KEY: Boolean(process.env.TELNYX_PUBLIC_KEY),
      TELNYX_FROM_NUMBER: fromNumberKind(process.env.TELNYX_FROM_NUMBER),
      TELNYX_MESSAGING_PROFILE_ID: Boolean(process.env.TELNYX_MESSAGING_PROFILE_ID),
      RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
      // The launch blocker (LAUNCH §A2/A6): both must be true for ANY money
      // to move — checkout, auto top-up, business packages, phone orders.
      STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      // The call-in card line: the token gates /api/voice entirely. There is no
      // ring list to report any more — as of session 021 the attendant answers
      // every call and nothing dials out (VOICE_RING_TO / VOICE_RING_FIRST /
      // VOICE_RING_SECONDS are gone from the code; delete them from Vercel).
      TWILIO_ACCOUNT_SID: Boolean(process.env.TWILIO_ACCOUNT_SID),
      TWILIO_AUTH_TOKEN: Boolean(process.env.TWILIO_AUTH_TOKEN),
      // Google Analytics (analytics/). Booleans only — the api secret and the
      // salt are secrets and must never appear in a response.
      // All three must be true before ANY server-side event is sent; missing
      // the salt is a refusal, not a fallback to raw phone numbers.
      NEXT_PUBLIC_GA_MEASUREMENT_ID: Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID),
      GA_API_SECRET: Boolean(process.env.GA_API_SECRET),
      ANALYTICS_SALT: Boolean(process.env.ANALYTICS_SALT),
      // TRUE IN PRODUCTION IS A SILENT OUTAGE: events go to GA's validation
      // endpoint, which stores nothing while reporting success. Everything
      // looks healthy and no data is recorded.
      GA_VALIDATE_ONLY: process.env.GA_VALIDATE_ONLY === "1",
      // Makes server events visible in GA4 DebugView. Safe to leave on, but
      // it routes events through the debug stream — switch it off once the
      // plumbing has been seen to work.
      GA_DEBUG_MODE: process.env.GA_DEBUG_MODE === "1",
    },
  };

  // TEST MODE (session 021) is reported FIRST and unconditionally, because it
  // is the one state where every other line in this report reads healthy while
  // the subscriber list receives nothing at all. Anything that can produce a
  // silent outage has to be visible from outside the admin screens.
  try {
    const settings = await getEngineSettings();
    const nowMs = Date.now();
    const state = testModeState(settings, nowMs);
    report.testMode =
      state === "active"
        ? {
            ON: true,
            warning: "ADS ARE GOING ONLY TO THE TEST NUMBERS — the subscriber list receives nothing",
            testNumbers: parseTestNumbers(settings.testNumbers).length,
            minutesUntilAutoOff: testModeMinutesLeft(settings, nowMs),
          }
        : { ON: false, state };
  } catch (e) {
    report.testMode = { ON: "unknown", error: (e as Error).message };
  }

  if (supabaseConfigured) {
    try {
      const config = await db().from("config").select("key", { count: "exact", head: true });
      report.configTable = config.error
        ? { ok: false, code: config.error.code, error: config.error.message }
        : { ok: true, rows: config.count };
      const ads = await db().from("ads").select("id", { count: "exact", head: true });
      report.adsTable = ads.error
        ? { ok: false, code: ads.error.code, error: ads.error.message }
        : { ok: true, rows: ads.count };
      // Migration probes: the deployed code depends on these columns; a
      // missing one breaks a whole surface (9989: every inbound SMS command;
      // 9988: digest composition + /admin/digests). Surface drift here instead
      // of leaving it to be inferred from 500s.
      // Migration 9958: the member name a feedback form teaches us. Until it
      // is pasted the forms work and the name rides the operator's email; it
      // simply isn't stored on the account.
      const memberName = await db()
        .from("users")
        .select("first_name", { count: "exact", head: true });
      report.migration9958 = memberName.error
        ? {
            applied: false,
            code: memberName.error.code,
            error: memberName.error.message,
            fix: "run supabase/migrations/9958_member_names.sql in the SQL editor",
          }
        : { applied: true };
      // Migration 9959: who filed a help report. Until it is pasted, reports
      // still file (and the operator's email still names the person) — they
      // just land without the contact columns, so the admin list can't show
      // who to call back.
      const helpContact = await db()
        .from("help_reports")
        .select("contact_phone", { count: "exact", head: true });
      report.migration9959 = helpContact.error
        ? {
            applied: false,
            code: helpContact.error.code,
            error: helpContact.error.message,
            fix: "run supabase/migrations/9959_help_report_contact.sql in the SQL editor",
          }
        : { applied: true };
      // Migration 9960: batched ads. digests.slot_key is what makes a batch
      // idempotent; without it the composer falls back to a synthetic
      // scheduled_for identity, which works but is unreadable in the admin
      // history — and the three batch config rows are unset, so the code
      // defaults stand in.
      const slotKey = await db().from("digests").select("slot_key", { count: "exact", head: true });
      report.migration9960 = slotKey.error
        ? {
            applied: false,
            code: slotKey.error.code,
            error: slotKey.error.message,
            fix: "run supabase/migrations/9960_batched_ads.sql in the SQL editor",
          }
        : { applied: true };
      // Migration 9961: the first-party analytics upgrade. Until it is pasted,
      // recordVisit falls back to bump_page_view and referrer/visitor counts
      // are simply not collected — nothing breaks, so without this probe the
      // gap would be invisible.
      const visitDays = await db().from("visit_days").select("day", { count: "exact", head: true });
      report.migration9961 = visitDays.error
        ? {
            applied: false,
            code: visitDays.error.code,
            error: visitDays.error.message,
            fix: "run supabase/migrations/9961_analytics_upgrade.sql in the SQL editor",
          }
        : { applied: true };
      const quota = await db()
        .from("users")
        .select("pic_balance", { count: "exact", head: true });
      report.migration9989 = quota.error
        ? {
            applied: false,
            code: quota.error.code,
            error: quota.error.message,
            fix: "run supabase/migrations/9989_pic_quota.sql in the SQL editor",
          }
        : { applied: true };
      const hold = await db().from("ads").select("hold_until", { count: "exact", head: true });
      report.migration9988 = hold.error
        ? {
            applied: false,
            code: hold.error.code,
            error: hold.error.message,
            fix: "run supabase/migrations/9988_ad_hold.sql in the SQL editor",
          }
        : { applied: true };
      // deleted_at ships in the same paste as the 'deleted' enum value, so
      // this column probe stands in for the whole of 9987 (admin ad deletion).
      const del = await db().from("ads").select("deleted_at", { count: "exact", head: true });
      report.migration9987 = del.error
        ? {
            applied: false,
            code: del.error.code,
            error: del.error.message,
            fix: "run supabase/migrations/9987_ad_delete.sql in the SQL editor",
          }
        : { applied: true };
      const uid = await db().from("users").select("user_id", { count: "exact", head: true });
      report.migration9986 = uid.error
        ? {
            applied: false,
            code: uid.error.code,
            error: uid.error.message,
            fix: "run supabase/migrations/9986_user_ids.sql in the SQL editor",
          }
        : { applied: true };
      const subs = await db()
        .from("ad_photo_submissions")
        .select("id", { count: "exact", head: true });
      report.migration9985 = subs.error
        ? {
            applied: false,
            code: subs.error.code,
            error: subs.error.message,
            fix: "run supabase/migrations/9985_ad_photo_submissions.sql in the SQL editor",
          }
        : { applied: true };
      const contexts = await db()
        .from("sms_contexts")
        .select("phone", { count: "exact", head: true });
      report.migration9984 = contexts.error
        ? {
            applied: false,
            code: contexts.error.code,
            error: contexts.error.message,
            fix: "run supabase/migrations/9984_ratings.sql in the SQL editor",
          }
        : { applied: true };
      const chats = await db().from("chats").select("id", { count: "exact", head: true });
      report.migration9983 = chats.error
        ? {
            applied: false,
            code: chats.error.code,
            error: chats.error.message,
            fix: "run supabase/migrations/9983_profiles_chat.sql in the SQL editor",
          }
        : { applied: true };
      const digestNo = await db()
        .from("digests")
        .select("digest_no", { count: "exact", head: true });
      report.migration9982 = digestNo.error
        ? {
            applied: false,
            code: digestNo.error.code,
            error: digestNo.error.message,
            fix: "run supabase/migrations/9982_digest_numbers.sql in the SQL editor",
          }
        : { applied: true };
      const verified = await db()
        .from("users")
        .select("verified_at", { count: "exact", head: true });
      report.migration9981 = verified.error
        ? {
            applied: false,
            code: verified.error.code,
            error: verified.error.message,
            fix: "run supabase/migrations/9981_verified_members.sql in the SQL editor",
          }
        : { applied: true };
      // Probe BOTH ends of 9980: prod was caught (2026-08-17 logs) holding a
      // partial paste — reported_at present, photo missing — because the file
      // was amended after the user's mid-session-009 paste and a single-column
      // probe vouched for the whole migration. photo is the last-added column,
      // so reported_at + photo together span the file; re-pasting is safe
      // (re-runnable).
      const chatUpgrade = await db()
        .from("chat_messages")
        .select("reported_at, photo", { count: "exact", head: true });
      report.migration9980 = chatUpgrade.error
        ? {
            applied: false,
            code: chatUpgrade.error.code,
            error: chatUpgrade.error.message,
            fix: "run supabase/migrations/9980_chat_upgrade.sql in the SQL editor",
          }
        : { applied: true };
      // reveal_log ships in the same paste as the users reveal_balance /
      // reveal_accrual_day columns and reserve_reveal_quota(), so this table
      // probe stands in for the whole of 9979 (metered click-to-reveal).
      const revealLog = await db()
        .from("reveal_log")
        .select("id", { count: "exact", head: true });
      report.migration9979 = revealLog.error
        ? {
            applied: false,
            code: revealLog.error.code,
            error: revealLog.error.message,
            fix: "run supabase/migrations/9979_reveal_quota.sql in the SQL editor",
          }
        : { applied: true };
      // Business advertising packages (item 17): without this table the
      // /advertising purchase form says "not available yet" and a paid webhook
      // event can only LOG the package — so surface the drift loudly here.
      const business = await db()
        .from("business_packages")
        .select("id", { count: "exact", head: true });
      report.migration9978 = business.error
        ? {
            applied: false,
            code: business.error.code,
            error: business.error.message,
            fix: "run supabase/migrations/9978_business_packages.sql in the SQL editor",
          }
        : { applied: true };
      // events + featured_spots ship in the same 9977 paste, so this table
      // probe stands in for both homepage sidebars (town hall + featured).
      const townHall = await db().from("events").select("id", { count: "exact", head: true });
      report.migration9977 = townHall.error
        ? {
            applied: false,
            code: townHall.error.code,
            error: townHall.error.message,
            fix: "run supabase/migrations/9977_town_hall_featured.sql in the SQL editor",
          }
        : { applied: true };
      // users.categories ships in the same paste as ads.category and the
      // confirmation-throttle columns, so this column probe stands in for the
      // whole of 9976 (the category system: menu welcome, toggles, filtered
      // digests, homepage browser). Until it's applied the system is dormant
      // by design: unknown-word replies, unfiltered digests, hidden UI.
      const categories = await db()
        .from("users")
        .select("categories", { count: "exact", head: true });
      report.migration9976 = categories.error
        ? {
            applied: false,
            code: categories.error.code,
            error: categories.error.message,
            fix: "run supabase/migrations/9976_categories.sql in the SQL editor",
          }
        : { applied: true };
      // ads.collage_notified_at ships in the same paste as
      // ad_photos.created_at, so this column probe stands in for the whole of
      // 9974 (combined-photo confirmation texts). Until it's applied the
      // feature is dormant by design: the cron warns once and sends nothing.
      const collageConfirm = await db()
        .from("ads")
        .select("collage_notified_at", { count: "exact", head: true });
      report.migration9974 = collageConfirm.error
        ? {
            applied: false,
            code: collageConfirm.error.code,
            error: collageConfirm.error.message,
            fix: "run supabase/migrations/9974_collage_confirmation.sql in the SQL editor",
          }
        : { applied: true };
      // 9973 (dollar pricing): users.auto_topup and ads.web_listing ship in
      // the same paste as the cents conversion and the new price config keys,
      // so these two column probes plus the money_unit marker stand in for
      // the whole migration. Until it's applied: prices fall back to the
      // code defaults (correct dollars), auto top-up stays OFF (fail-closed),
      // and legacy balances/free passes are still credit-denominated —
      // balances will display wrong by 100x, so paste it before launch.
      const topup = await db().from("users").select("auto_topup", { count: "exact", head: true });
      const moneyUnit = await db().from("config").select("value").eq("key", "money_unit").maybeSingle();
      report.migration9973 =
        topup.error || moneyUnit.error || !moneyUnit.data
          ? {
              applied: false,
              ...(topup.error && { code: topup.error.code, error: topup.error.message }),
              ...(!topup.error && { error: "money_unit config marker missing (ledger not converted)" }),
              fix: "run supabase/migrations/9973_dollar_pricing.sql in the SQL editor",
            }
          : { applied: true };
    } catch (e) {
      report.db = { ok: false, thrown: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(report);
}
