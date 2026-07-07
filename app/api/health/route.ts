/**
 * Deployment diagnostics: which data-layer mode is active, which env vars
 * are present (booleans and key *kinds* only — never values), and a live
 * database round-trip. Safe to leave in place.
 */
import { NextResponse } from "next/server";
import { db, supabaseConfigured } from "@/lib/db";

function keyKind(key: string | undefined): string {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "sb_secret (correct)";
  if (key.startsWith("sb_publishable_")) return "sb_publishable (WRONG — this is the public key)";
  if (key.startsWith("eyJ")) return "legacy JWT (fine if it's the service_role one)";
  return "unrecognized format";
}

export async function GET() {
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
