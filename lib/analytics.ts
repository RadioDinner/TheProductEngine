/**
 * Built-in page-view analytics. Server-side and cookie-free, so it counts
 * visitors even without JavaScript (this audience often has it disabled).
 * Supabase-backed (page_views table + bump_page_view/visit_stats functions,
 * migration 9998); a no-op with zero counts when Supabase isn't configured.
 *
 * Since migration 9961 it also records WHERE a visit came from and roughly how
 * many DIFFERENT people came, via bump_visit. That upgrade is why this file
 * still matters now that Google Analytics exists: GA cannot see a visitor with
 * JavaScript off — a real share of this audience — and its data retention tops
 * out at 14 months. Anything that has to be answerable in three years lives
 * here, in our own database, with no third party involved.
 *
 * PRIVACY: no IP address and no user agent is ever stored. The visitor token is
 * a salted hash that INCLUDES the calendar day, so it cannot follow anyone from
 * one day to the next — not by us, not later, not deliberately. That is what
 * keeps the promise on /privacy true.
 */
import { headers } from "next/headers";
import { db, supabaseConfigured } from "@/lib/db";
import { etParts } from "@/lib/et";
import { dailyVisitorHash } from "@/analytics/src/ids";
import { ANALYTICS_SALT } from "@/analytics/src/config";

export interface VisitStats {
  today: number;
  last7: number;
  total: number;
}

/** Where a visit came from, when the caller knows. */
export interface VisitSource {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** Referring HOST only — never the full URL, which can carry search terms
 *  and, from some sites, identifiers. */
function refHostOf(referer: string | null): string {
  if (!referer) return "";
  try {
    return new URL(referer).hostname.slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * PostgREST codes meaning "that function/table isn't there yet" — i.e. the
 * migration hasn't been pasted. 42P01 is Postgres's own; PGRST202/205 are what
 * PostgREST actually returns for a missing RPC or an unknown schema entry, and
 * matching only 42P01 is a mistake this repo has made before.
 */
function isMissingObject(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST202" || code === "PGRST205";
}

/** Fire-and-forget from a public page; never throws, never blocks rendering. */
export async function recordVisit(path: string, source?: VisitSource): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const { day } = etParts(new Date());
    let refHost = "";
    let visitorHash = "";
    try {
      const h = await headers();
      refHost = refHostOf(h.get("referer"));
      visitorHash = dailyVisitorHash(
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
        h.get("user-agent") ?? "",
        ANALYTICS_SALT,
        day,
      );
    } catch {
      // Called outside a request (a script, a test): the day counter below
      // still works, we just cannot say where the visit came from.
    }

    const { error } = await db().rpc("bump_visit", {
      p_day: day,
      p_path: path,
      p_ref_host: refHost,
      p_utm_source: source?.utmSource ?? "",
      p_utm_medium: source?.utmMedium ?? "",
      p_utm_campaign: source?.utmCampaign ?? "",
      p_visitor_hash: visitorHash,
    });
    if (!error) return;

    if (isMissingObject(error.code)) {
      // Migration 9961 not pasted yet. Fall back to the original counter so the
      // figures on /admin keep moving, and say so ONCE rather than on every
      // page view — a per-request log line is how a warning becomes invisible.
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn(
          "[analytics] bump_visit missing — paste supabase/migrations/9961_analytics_upgrade.sql. " +
            "Falling back to bump_page_view; referrer and visitor counts are not being recorded.",
        );
      }
      await db().rpc("bump_page_view", { p_day: day, p_path: path });
      return;
    }
    console.error("[analytics] recordVisit failed:", error.message);
  } catch (e) {
    console.error("[analytics] recordVisit failed:", e);
  }
}

let warnedMissing = false;

export async function getVisitStats(): Promise<VisitStats> {
  if (!supabaseConfigured) return { today: 0, last7: 0, total: 0 };
  const { data, error } = await db().rpc("visit_stats");
  if (error || !data?.length) return { today: 0, last7: 0, total: 0 };
  const row = data[0] as { today: number; last7: number; total: number };
  return {
    today: Number(row.today) || 0,
    last7: Number(row.last7) || 0,
    total: Number(row.total) || 0,
  };
}

export interface VisitStatsV2 extends VisitStats {
  peopleToday: number;
  peopleLast7: number;
}

/**
 * Views AND unique people. Falls back to the original three numbers with zero
 * people when 9961 isn't pasted, so a caller can render either way.
 */
export async function getVisitStatsV2(): Promise<VisitStatsV2> {
  if (!supabaseConfigured) return { today: 0, last7: 0, total: 0, peopleToday: 0, peopleLast7: 0 };
  const { data, error } = await db().rpc("visit_stats_v2");
  if (error || !data?.length) {
    const base = await getVisitStats();
    return { ...base, peopleToday: 0, peopleLast7: 0 };
  }
  const row = data[0] as {
    today: number;
    last7: number;
    total: number;
    people_today: number;
    people_last7: number;
  };
  return {
    today: Number(row.today) || 0,
    last7: Number(row.last7) || 0,
    total: Number(row.total) || 0,
    peopleToday: Number(row.people_today) || 0,
    peopleLast7: Number(row.people_last7) || 0,
  };
}

export interface VisitSourceRow {
  refHost: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  views: number;
}

/** Where visits came from over a window. Empty when 9961 isn't pasted. */
export async function getVisitSources(days = 30): Promise<VisitSourceRow[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await db().rpc("visit_sources", { p_days: days });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    refHost: String(r.ref_host ?? ""),
    utmSource: String(r.utm_source ?? ""),
    utmMedium: String(r.utm_medium ?? ""),
    utmCampaign: String(r.utm_campaign ?? ""),
    views: Number(r.views) || 0,
  }));
}
