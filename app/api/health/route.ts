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
    },
  };

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
      // reported_at ships in the same paste as the photo/chat_nudged_at
      // columns, the 'chat' enum value, and send_chat(), so this column probe
      // stands in for the whole of 9980 (chat reports/pictures/perf).
      const chatUpgrade = await db()
        .from("chat_messages")
        .select("reported_at", { count: "exact", head: true });
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
    } catch (e) {
      report.db = { ok: false, thrown: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(report);
}
