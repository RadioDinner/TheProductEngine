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
    } catch (e) {
      report.db = { ok: false, thrown: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(report);
}
