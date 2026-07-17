/**
 * Supabase implementation of the ads interface (see lib/ads.ts for the
 * fixtures implementation and the shared types). DB `approved` maps to the
 * site's `available`.
 */
import { db } from "@/lib/db";
import type { Ad, AdPage, AdQuery, AdStatus } from "@/lib/ads";

interface PhotoRow {
  src: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  position: number;
}

interface AdRowDb {
  id: number;
  body: string;
  status: string;
  approved_at: string;
  expires_at: string | null;
  users: { phone: string | null } | null;
  ad_photos: PhotoRow[];
}

const SELECT =
  "id, body, status, approved_at, expires_at, users!inner(phone), ad_photos(src, width, height, alt, position)";

function toAd(row: AdRowDb): Ad {
  // Position order: 0 is the MMS/digest picture, 1+ are approved emailed-in
  // extras — the website shows the whole gallery (FEATURES item 1).
  const photos = [...(row.ad_photos ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      src: p.src,
      alt: p.alt ?? "",
      width: p.width ?? 800,
      height: p.height ?? 600,
    }));
  return {
    id: row.id,
    body: row.body,
    status: (row.status === "approved" ? "available" : row.status) as AdStatus,
    approvedAt: new Date(row.approved_at),
    ...(row.expires_at && { expiresAt: new Date(row.expires_at) }),
    ownerPhone: row.users?.phone ?? "",
    ...(photos[0] && { photo: photos[0], photos }),
  };
}

export async function listAds({
  q,
  category,
  page = 1,
  perPage = 15,
}: AdQuery = {}): Promise<AdPage> {
  const buildQuery = () => {
    let query = db()
      .from("ads")
      .select(SELECT, { count: "exact" })
      .in("status", ["approved", "sold"])
      // Only ads that have actually gone out in a digest appear on the site.
      .not("broadcast_at", "is", null)
      .order("approved_at", { ascending: false })
      .order("id", { ascending: false });
    // Homepage browse filter (item 25). Callers gate on categoriesSupported(),
    // so the column exists whenever this arrives.
    if (category) query = query.eq("category", category);
    if (q?.trim()) query = query.ilike("body", `%${q.trim()}%`);
    return query;
  };

  let current = Math.max(1, page);
  let { data, count, error } = await buildQuery().range(
    (current - 1) * perPage,
    current * perPage - 1,
  );
  // PGRST103 = requested range beyond the result set; clamp to the last page.
  if (error && error.code !== "PGRST103") {
    console.error("[ads-supabase] listAds failed:", error.code, error.message);
    throw error;
  }
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if ((error || (data?.length ?? 0) === 0) && total > 0 && current > totalPages) {
    current = totalPages;
    const retry = await buildQuery().range((current - 1) * perPage, current * perPage - 1);
    if (retry.error) throw retry.error;
    data = retry.data;
  }
  return {
    ads: ((data ?? []) as unknown as AdRowDb[]).map(toAd),
    total,
    page: current,
    totalPages,
  };
}

export async function getAd(id: number): Promise<Ad | null> {
  const { data, error } = await db()
    .from("ads")
    .select(SELECT)
    .eq("id", id)
    .in("status", ["approved", "sold", "expired"])
    // Hidden from the public site until it has ridden a digest.
    .not("broadcast_at", "is", null)
    .maybeSingle();
  if (error) {
    console.error("[ads-supabase] getAd failed:", error.code, error.message);
    throw error;
  }
  return data ? toAd(data as unknown as AdRowDb) : null;
}

/** Live ad count per category (homepage row graying). One paged column scan —
 * the listed-ad population is small; no aggregate RPC needed. */
export async function countLiveAdsByCategory(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("ads")
      .select("category")
      .in("status", ["approved", "sold"])
      .not("broadcast_at", "is", null)
      .not("category", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      if (error.code === "42703") return counts; // pre-9976 — caller hides the row anyway
      throw error;
    }
    for (const row of data ?? []) {
      const key = row.category as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return counts;
}

export async function listAdsByOwner(phone: string): Promise<Ad[]> {
  const { data, error } = await db()
    .from("ads")
    .select(SELECT)
    .eq("users.phone", phone)
    .in("status", ["approved", "sold", "expired"])
    .order("approved_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as AdRowDb[]).map(toAd);
}
