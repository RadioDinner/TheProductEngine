/**
 * The featured / premium-listing request queue (session 019, migration 9956).
 *
 * The user's rule: "if I have 3 confirmed businesses for the month, and 2 more
 * people apply, if both are valid/approvable, the first one submitted will get
 * the 4th spot." So queue order is `submitted_at`, stored — never the order
 * the operator happens to work through them on a slow afternoon.
 *
 * Dual-mode like the rest of the stores, and degrade-not-crash: before
 * migration 9956 the public request page reads an empty queue and says the
 * board is open rather than 500ing at a stranger.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";

export type FeaturedRequestKind = "featured_ad" | "business";
export type FeaturedRequestStatus = "pending" | "approved" | "declined" | "cancelled";

export interface FeaturedRequest {
  id: number;
  kind: FeaturedRequestKind;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Where the spot goes when clicked — an external link they chose… */
  linkUrl: string | null;
  /** …or one of their own ads, which opens that ad's page. */
  adId: number | null;
  note: string | null;
  status: FeaturedRequestStatus;
  submittedAt: string;
  scheduledStartDay: string | null;
}

export interface FeaturedRequestInput {
  kind: FeaturedRequestKind;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  linkUrl: string | null;
  adId: number | null;
  note: string | null;
}

/** 42P01 = table missing, PGRST205 = PostgREST hasn't seen it, 42703 = a
 * column this build expects isn't there. All three mean "9956 is pending". */
function schemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "42703";
}

// ---------- file implementation (development) ----------

interface RequestShape {
  requests: FeaturedRequest[];
  nextId: number;
}

const PATH = join(process.cwd(), ".data", "featured-requests.json");

function load(): RequestShape {
  try {
    return JSON.parse(readFileSync(PATH, "utf8")) as RequestShape;
  } catch {
    return { requests: [], nextId: 1 };
  }
}

function save(shape: RequestShape): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- shared ----------

interface RequestRow {
  id: number;
  kind: string;
  business_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  link_url: string | null;
  ad_id: number | null;
  note: string | null;
  status: string;
  submitted_at: string;
  scheduled_start_day: string | null;
}

const SELECT =
  "id, kind, business_name, contact_name, phone, email, link_url, ad_id, note, status, submitted_at, scheduled_start_day";

function toRequest(row: RequestRow): FeaturedRequest {
  return {
    id: row.id,
    kind: row.kind === "featured_ad" ? "featured_ad" : "business",
    businessName: row.business_name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    linkUrl: row.link_url,
    adId: row.ad_id,
    note: row.note,
    status: (["pending", "approved", "declined", "cancelled"] as const).includes(
      row.status as FeaturedRequestStatus,
    )
      ? (row.status as FeaturedRequestStatus)
      : "pending",
    submittedAt: row.submitted_at,
    scheduledStartDay: row.scheduled_start_day,
  };
}

// ---------- reads ----------

/**
 * Everyone still waiting, oldest FIRST. The order is the promise: index 0 gets
 * the next slot that frees.
 */
export async function listPendingRequests(): Promise<FeaturedRequest[]> {
  if (!supabaseConfigured) {
    return load()
      .requests.filter((r) => r.status === "pending")
      .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id - b.id);
  }
  try {
    const { data, error } = await db()
      .from("featured_requests")
      .select(SELECT)
      .eq("status", "pending")
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      if (schemaMissing(error)) return [];
      throw error;
    }
    return ((data ?? []) as RequestRow[]).map(toRequest);
  } catch (e) {
    // Public page render path — an empty queue reads as "the board is open",
    // which is the safe thing to tell a stranger while the table is missing.
    console.error("[featured] listPendingRequests failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Every request, newest first — the admin queue. null = 9956 is pending. */
export async function listAllRequests(): Promise<FeaturedRequest[] | null> {
  if (!supabaseConfigured) {
    return [...load().requests].sort(
      (a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || b.id - a.id,
    );
  }
  try {
    const { data, error } = await db()
      .from("featured_requests")
      .select(SELECT)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);
    if (error) {
      if (schemaMissing(error)) return null;
      throw error;
    }
    return ((data ?? []) as RequestRow[]).map(toRequest);
  } catch (e) {
    console.error("[featured] listAllRequests failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * The start days of every run that is booked — approved requests plus any
 * scheduled spot. This is what lib/featured-schedule.ts reads to work out when
 * the next slot frees.
 */
export async function listBookedStartDays(): Promise<string[]> {
  if (!supabaseConfigured) {
    return load()
      .requests.filter((r) => r.status === "approved" && r.scheduledStartDay)
      .map((r) => r.scheduledStartDay as string);
  }
  try {
    const { data, error } = await db()
      .from("featured_requests")
      .select("scheduled_start_day")
      .eq("status", "approved")
      .not("scheduled_start_day", "is", null);
    if (error) {
      if (schemaMissing(error)) return [];
      throw error;
    }
    return (data ?? [])
      .map((r) => (r as { scheduled_start_day: string | null }).scheduled_start_day)
      .filter((d): d is string => Boolean(d));
  } catch (e) {
    console.error("[featured] listBookedStartDays failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------- writes ----------

export async function addFeaturedRequest(
  input: FeaturedRequestInput,
): Promise<"added" | "unsupported"> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.requests.push({
      id: shape.nextId,
      ...input,
      status: "pending",
      submittedAt: new Date().toISOString(),
      scheduledStartDay: null,
    });
    shape.nextId += 1;
    save(shape);
    return "added";
  }
  const { error } = await db().from("featured_requests").insert({
    kind: input.kind,
    business_name: input.businessName,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
    link_url: input.linkUrl,
    ad_id: input.adId,
    note: input.note,
  });
  if (error) {
    if (schemaMissing(error)) return "unsupported";
    throw error;
  }
  return "added";
}

/**
 * Approve a request and book it a start day, or turn it down.
 *
 * The start day is computed by the CALLER from lib/featured-schedule.ts and
 * written here, so the day quoted on the public page and the day actually
 * booked come from one piece of arithmetic.
 */
export async function decideFeaturedRequest(
  id: number,
  decision: "approved" | "declined" | "cancelled",
  scheduledStartDay: string | null,
): Promise<"saved" | "unsupported"> {
  if (!supabaseConfigured) {
    const shape = load();
    const row = shape.requests.find((r) => r.id === id);
    if (!row) return "saved";
    row.status = decision;
    row.scheduledStartDay = decision === "approved" ? scheduledStartDay : null;
    save(shape);
    return "saved";
  }
  const { error } = await db()
    .from("featured_requests")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      scheduled_start_day: decision === "approved" ? scheduledStartDay : null,
    })
    .eq("id", id);
  if (error) {
    if (schemaMissing(error)) return "unsupported";
    throw error;
  }
  return "saved";
}
