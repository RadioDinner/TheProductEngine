/**
 * Built-in page-view analytics. Server-side and cookie-free, so it counts
 * visitors even without JavaScript (this audience often has it disabled).
 * Supabase-backed (page_views table + bump_page_view/visit_stats functions,
 * migration 9998); a no-op with zero counts when Supabase isn't configured.
 */
import { db, supabaseConfigured } from "@/lib/db";
import { etParts } from "@/lib/et";

export interface VisitStats {
  today: number;
  last7: number;
  total: number;
}

/** Fire-and-forget from a public page; never throws, never blocks rendering. */
export async function recordVisit(path: string): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const { day } = etParts(new Date());
    await db().rpc("bump_page_view", { p_day: day, p_path: path });
  } catch (e) {
    console.error("[analytics] recordVisit failed:", e);
  }
}

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
