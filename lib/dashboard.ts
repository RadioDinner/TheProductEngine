/**
 * The numbers on the admin dashboard (/admin, session 019).
 *
 * The user's ask was three figures to start with — "current SMS subscribers",
 * "current email subscribers", "active ads" — plus the system-health verdict
 * (lib/system-health.ts). Everything here is either a head-count query or a
 * count the admin pages already run, so the dashboard is a cheap page even
 * once the member list is long.
 *
 * Dual-mode like the rest of the stores: exact counts from the small local
 * fixture store in development, head counts in Supabase. The counts are
 * defined to match the pages they link to — the Subscribers tab and the Ads
 * tab — because a dashboard figure that disagrees with its own detail page is
 * worse than no figure at all.
 */
import { db, supabaseConfigured } from "@/lib/db";
import { getAllAds, countAdsAwaitingPictures, queuedOutboxCount } from "@/lib/engine-store";
import { listEmailSubscribers, listSmsSubscribers } from "@/lib/store";

export interface DashboardStats {
  /** Numbers currently subscribed to the ad texts (a STOP clears this). */
  smsSubscribers: number;
  /** Addresses currently subscribed to the email editions. */
  emailSubscribers: number;
  /** Ads running right now: approved, not sold, not expired, not deleted. */
  activeAds: number;
  /** Of those, the ones that have broadcast and so appear on the website. */
  liveOnSite: number;
  /** Approved but not yet broadcast — they ride the next batch. */
  awaitingBroadcast: number;
  /** Ads waiting for a human in the review queue. */
  pendingReview: number;
  /** Picture ads still collecting pictures, deliberately not in the queue. */
  settlingPictures: number;
  /** Sends sitting in the outbox waiting to drain. */
  queuedDeliveries: number;
}

type CountQuery = { count: number | null; error: { message: string; code?: string } | null };

/** A count with no rows fetched. Returns null when the shape isn't there yet
 * (a pending migration), so a caller can degrade rather than 500. */
async function headCount(
  table: string,
  // supabase-js's filtered query builder is a moving target to type precisely;
  // a count/head query only needs the filter chain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (q: any) => PromiseLike<CountQuery>,
): Promise<number | null> {
  const { count, error } = await build(db().from(table).select("*", { count: "exact", head: true }));
  if (error) return null;
  return count ?? 0;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [settlingPictures, queuedDeliveries] = await Promise.all([
    countAdsAwaitingPictures(),
    queuedOutboxCount(),
  ]);

  if (!supabaseConfigured) {
    const [sms, email, approved, pending] = await Promise.all([
      listSmsSubscribers(),
      listEmailSubscribers(),
      getAllAds(undefined, "approved", 1000),
      getAllAds(undefined, "pending", 1000),
    ]);
    const liveOnSite = approved.filter((a) => a.broadcastAt).length;
    return {
      smsSubscribers: sms.length,
      emailSubscribers: email.length,
      activeAds: approved.length,
      liveOnSite,
      awaitingBroadcast: approved.length - liveOnSite,
      pendingReview: pending.length,
      settlingPictures,
      queuedDeliveries,
    };
  }

  const [smsSubscribers, emailSubscribers, activeAds, liveOnSite, pendingReview] =
    await Promise.all([
      // Same definitions the Subscribers tab lists, so the two always agree.
      headCount("users", (q) => q.not("subscribed_at", "is", null).not("phone", "is", null)),
      headCount("users", (q) =>
        q.not("email_subscribed_at", "is", null).not("email", "is", null),
      ),
      // "Active" = still running. sold/expired/rejected/deleted are all out.
      headCount("ads", (q) => q.eq("status", "approved")),
      // The website only shows an ad once it has actually gone out.
      headCount("ads", (q) => q.eq("status", "approved").not("broadcast_at", "is", null)),
      headCount("ads", (q) => q.eq("status", "pending")),
    ]);

  const active = activeAds ?? 0;
  const live = liveOnSite ?? 0;
  return {
    smsSubscribers: smsSubscribers ?? 0,
    emailSubscribers: emailSubscribers ?? 0,
    activeAds: active,
    liveOnSite: live,
    awaitingBroadcast: Math.max(0, active - live),
    pendingReview: pendingReview ?? 0,
    settlingPictures,
    queuedDeliveries,
  };
}
