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
  users: { phone: string | null } | null;
  ad_photos: PhotoRow[];
}

const SELECT =
  "id, body, status, approved_at, users!inner(phone), ad_photos(src, width, height, alt, position)";

function toAd(row: AdRowDb): Ad {
  const photo = [...(row.ad_photos ?? [])].sort((a, b) => a.position - b.position)[0];
  return {
    id: row.id,
    body: row.body,
    status: (row.status === "approved" ? "available" : row.status) as AdStatus,
    approvedAt: new Date(row.approved_at),
    ownerPhone: row.users?.phone ?? "",
    ...(photo && {
      photo: {
        src: photo.src,
        alt: photo.alt ?? "",
        width: photo.width ?? 800,
        height: photo.height ?? 600,
      },
    }),
  };
}

export async function listAds({ q, page = 1, perPage = 15 }: AdQuery = {}): Promise<AdPage> {
  const buildQuery = () => {
    let query = db()
      .from("ads")
      .select(SELECT, { count: "exact" })
      .in("status", ["approved", "sold"])
      .order("approved_at", { ascending: false })
      .order("id", { ascending: false });
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
    .maybeSingle();
  if (error) {
    console.error("[ads-supabase] getAd failed:", error.code, error.message);
    throw error;
  }
  return data ? toAd(data as unknown as AdRowDb) : null;
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
