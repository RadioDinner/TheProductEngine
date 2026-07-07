/**
 * Admin reporting aggregates. Supabase path uses head-count queries (cheap,
 * and immune to the row-limit that plagues the list endpoints); the file path
 * is best-effort for local dev.
 */
import { db, supabaseConfigured } from "@/lib/db";
import { getVisitStats, type VisitStats } from "@/lib/analytics";
import {
  listEmailRecipients,
  listSubscriberPhones,
  type Account,
  searchAccounts,
} from "@/lib/store";
import { getAllAds } from "@/lib/engine-store";

export interface ReportSummary {
  smsSubscribers: number;
  emailSubscribers: number;
  newSubscribers7d: number;
  adsTotal: number;
  ads7d: number;
  adsPending: number;
  recentSubscribers: { phone: string; at: string }[];
  visits: VisitStats;
}

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

// supabase-js's filtered query builder is a moving target to type precisely;
// count/head queries only need the filter chain, so a local loose type is fine.
type CountQuery = { count: number | null; error: { message: string } | null };
async function headCount(
  table: string,
  build: (q: any) => PromiseLike<CountQuery>,
): Promise<number> {
  const { count, error } = await build(db().from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getReportSummary(): Promise<ReportSummary> {
  const visits = await getVisitStats();

  if (!supabaseConfigured) {
    // Dev/file mode: exact counts from the small local store.
    const phones = await listSubscriberPhones();
    const emails = await listEmailRecipients();
    const ads = await getAllAds(undefined, undefined, 1000);
    const recent = (await searchAccounts("", 500))
      .filter((a: Account) => a.subscribedAt)
      .sort((a, b) => Date.parse(b.subscribedAt!) - Date.parse(a.subscribedAt!))
      .slice(0, 10)
      .map((a) => ({ phone: a.phone, at: a.subscribedAt! }));
    const since = Date.parse(sevenDaysAgo());
    return {
      smsSubscribers: phones.length,
      emailSubscribers: emails.length,
      newSubscribers7d: recent.filter((r) => Date.parse(r.at) >= since).length,
      adsTotal: ads.length,
      ads7d: ads.filter((a) => Date.parse(a.createdAt) >= since).length,
      adsPending: ads.filter((a) => a.status === "pending").length,
      recentSubscribers: recent,
      visits,
    };
  }

  const since = sevenDaysAgo();
  const [
    smsSubscribers,
    emailSubscribers,
    newSubscribers7d,
    adsTotal,
    ads7d,
    adsPending,
    recent,
  ] = await Promise.all([
    headCount("users", (q) => q.not("subscribed_at", "is", null).not("phone", "is", null)),
    headCount("users", (q) => q.not("email_subscribed_at", "is", null)),
    headCount("users", (q) => q.gte("subscribed_at", since)),
    headCount("ads", (q) => q),
    headCount("ads", (q) => q.gte("created_at", since)),
    headCount("ads", (q) => q.eq("status", "pending")),
    db()
      .from("users")
      .select("phone, subscribed_at")
      .not("subscribed_at", "is", null)
      .not("phone", "is", null)
      .order("subscribed_at", { ascending: false })
      .limit(10),
  ]);

  if (recent.error) throw recent.error;
  const recentSubscribers = (recent.data ?? []).map((r) => ({
    phone: r.phone as string,
    at: r.subscribed_at as string,
  }));

  return {
    smsSubscribers,
    emailSubscribers,
    newSubscribers7d,
    adsTotal,
    ads7d,
    adsPending,
    recentSubscribers,
    visits,
  };
}
