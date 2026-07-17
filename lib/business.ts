/**
 * Business advertising packages (FEATURES item 17) — storage. Dual-mode like
 * the rest: a JSON file in dev, the `business_packages` table (migration
 * 9978) in Supabase. Pure tier/clock logic lives in lib/business-packages.ts.
 *
 * Graceful degradation (repo convention): before migration 9978 is pasted,
 * every reader returns empty/null, `businessPackagesAvailable()` is false so
 * /advertising says "not available yet" instead of taking money, and
 * `createBusinessPackage` returns "unsupported" so the Stripe webhook can log
 * LOUDLY that a paid package could not be stored — a paid-but-unstorable
 * package must never disappear silently.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";

export type BusinessPackageStatus = "pending_review" | "active" | "declined" | "expired";

export interface BusinessPackage {
  id: number;
  businessName: string;
  adText: string;
  link: string | null;
  phone: string | null;
  tier: string;
  daysPurchased: number;
  priceCents: number;
  stripeRef: string;
  status: BusinessPackageStatus;
  paidAt: string;
  approvedAt: string | null;
  /** Set at approval — the run clock starts here, not at payment. */
  startsAt: string | null;
  /** Scheduled end (starts + days). Display only — the real end is daysRan = daysPurchased. */
  endsAt: string | null;
  daysRan: number;
  /** ET day (YYYY-MM-DD) the sponsor line last rode a digest. */
  lastRanOn: string | null;
  /** That digest's slot key — the email edition mirrors the sponsor by this. */
  lastRanKey: string | null;
  declinedAt: string | null;
  /** Operator marked the manual Stripe refund done (decline = manual refund in v1). */
  refundedAt: string | null;
  createdAt: string;
}

export interface BusinessPackageInput {
  businessName: string;
  adText: string;
  link: string | null;
  phone: string | null;
  tier: string;
  daysPurchased: number;
  priceCents: number;
  stripeRef: string;
}

export type CreatePackageOutcome =
  | { outcome: "created"; id: number }
  | { outcome: "duplicate" }
  | { outcome: "unsupported" };

// ---------- file implementation ----------

interface BusinessShape {
  nextId: number;
  packages: BusinessPackage[];
}

const BUSINESS_PATH = join(process.cwd(), ".data", "business.json");

function load(): BusinessShape {
  try {
    return JSON.parse(readFileSync(BUSINESS_PATH, "utf8")) as BusinessShape;
  } catch {
    return { nextId: 1, packages: [] };
  }
}

function save(shape: BusinessShape): void {
  mkdirSync(dirname(BUSINESS_PATH), { recursive: true });
  writeFileSync(BUSINESS_PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- supabase helpers ----------

/** Table/column absent — migration 9978 not applied yet. */
function schemaMissing(error: { code?: string } | null): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" || // PostgREST: table not in schema cache (pre-paste)
    error?.code === "PGRST204" // PostgREST: payload column not in schema cache
  );
}

const ROW_SELECT =
  "id, business_name, ad_text, link, phone, tier, days_purchased, price_cents, " +
  "stripe_ref, status, paid_at, approved_at, starts_at, ends_at, days_ran, " +
  "last_ran_on, last_ran_key, declined_at, refunded_at, created_at";

// Supabase rows come back loosely typed; one mapper keeps the shape honest.
/* eslint-disable @typescript-eslint/no-explicit-any */
function toPackage(r: any): BusinessPackage {
  return {
    id: Number(r.id),
    businessName: r.business_name as string,
    adText: r.ad_text as string,
    link: (r.link as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    tier: r.tier as string,
    daysPurchased: Number(r.days_purchased),
    priceCents: Number(r.price_cents),
    stripeRef: r.stripe_ref as string,
    status: r.status as BusinessPackageStatus,
    paidAt: r.paid_at as string,
    approvedAt: (r.approved_at as string | null) ?? null,
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    daysRan: Number(r.days_ran ?? 0),
    lastRanOn: (r.last_ran_on as string | null) ?? null,
    lastRanKey: (r.last_ran_key as string | null) ?? null,
    declinedAt: (r.declined_at as string | null) ?? null,
    refundedAt: (r.refunded_at as string | null) ?? null,
    createdAt: (r.created_at as string) ?? new Date(0).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- public interface ----------

/**
 * Can packages be stored right now? Drives the /advertising purchase form:
 * when the migration isn't applied (or the DB errors) the page must say "not
 * available yet" rather than take a payment it can't record.
 */
export async function businessPackagesAvailable(): Promise<boolean> {
  if (!supabaseConfigured) return true;
  const { error } = await db()
    .from("business_packages")
    .select("id", { count: "exact", head: true });
  return !error;
}

/**
 * Store a PAID package (called by the Stripe webhook / dev simulate) as
 * pending_review. stripeRef is the idempotency key: a duplicate (Stripe
 * retry/replay) is reported, never double-inserted.
 */
export async function createBusinessPackage(
  input: BusinessPackageInput,
): Promise<CreatePackageOutcome> {
  const now = new Date().toISOString();
  if (!supabaseConfigured) {
    const shape = load();
    if (shape.packages.some((p) => p.stripeRef === input.stripeRef)) {
      return { outcome: "duplicate" };
    }
    const id = shape.nextId++;
    shape.packages.push({
      id,
      businessName: input.businessName,
      adText: input.adText,
      link: input.link,
      phone: input.phone,
      tier: input.tier,
      daysPurchased: input.daysPurchased,
      priceCents: input.priceCents,
      stripeRef: input.stripeRef,
      status: "pending_review",
      paidAt: now,
      approvedAt: null,
      startsAt: null,
      endsAt: null,
      daysRan: 0,
      lastRanOn: null,
      lastRanKey: null,
      declinedAt: null,
      refundedAt: null,
      createdAt: now,
    });
    save(shape);
    return { outcome: "created", id };
  }
  const { data, error } = await db()
    .from("business_packages")
    .insert({
      business_name: input.businessName,
      ad_text: input.adText,
      link: input.link,
      phone: input.phone,
      tier: input.tier,
      days_purchased: input.daysPurchased,
      price_cents: input.priceCents,
      stripe_ref: input.stripeRef,
      status: "pending_review",
      paid_at: now,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { outcome: "duplicate" };
    if (schemaMissing(error)) return { outcome: "unsupported" };
    throw error;
  }
  return { outcome: "created", id: Number(data.id) };
}

/** Every package, newest first — the admin Business page. [] pre-migration. */
export async function listBusinessPackages(): Promise<BusinessPackage[]> {
  if (!supabaseConfigured) {
    return [...load().packages].sort((a, b) => b.id - a.id);
  }
  const { data, error } = await db()
    .from("business_packages")
    .select(ROW_SELECT)
    .order("id", { ascending: false })
    .limit(500);
  if (error) {
    if (schemaMissing(error)) return [];
    throw error;
  }
  return (data ?? []).map(toPackage);
}

export async function getBusinessPackage(id: number): Promise<BusinessPackage | null> {
  if (!supabaseConfigured) {
    return load().packages.find((p) => p.id === id) ?? null;
  }
  const { data, error } = await db()
    .from("business_packages")
    .select(ROW_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }
  return data ? toPackage(data) : null;
}

/**
 * Approve a pending package: the SAME human gate as regular ads. The run
 * clock starts NOW (user decision: approval, not payment) — starts_at set,
 * scheduled ends_at = now + days. Only pending_review transitions.
 */
export async function approveBusinessPackage(id: number): Promise<boolean> {
  const now = new Date();
  if (!supabaseConfigured) {
    const shape = load();
    const p = shape.packages.find((x) => x.id === id);
    if (!p || p.status !== "pending_review") return false;
    p.status = "active";
    p.approvedAt = now.toISOString();
    p.startsAt = now.toISOString();
    p.endsAt = new Date(now.getTime() + p.daysPurchased * 86_400_000).toISOString();
    save(shape);
    return true;
  }
  const existing = await getBusinessPackage(id);
  if (!existing || existing.status !== "pending_review") return false;
  const { data, error } = await db()
    .from("business_packages")
    .update({
      status: "active",
      approved_at: now.toISOString(),
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + existing.daysPurchased * 86_400_000).toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_review") // double-submit-safe: only one call transitions
    .select("id");
  if (error) {
    if (schemaMissing(error)) return false;
    throw error;
  }
  return (data ?? []).length > 0;
}

/**
 * Decline a pending package. NO auto-refund in v1 (deliberate): the package
 * never ran, so per the refund policy the money goes back — but the operator
 * does it BY HAND in the Stripe dashboard; the admin page keeps a "refund
 * due" note (with amount + payment ref) until they mark it done.
 */
export async function declineBusinessPackage(id: number): Promise<boolean> {
  const now = new Date().toISOString();
  if (!supabaseConfigured) {
    const shape = load();
    const p = shape.packages.find((x) => x.id === id);
    if (!p || p.status !== "pending_review") return false;
    p.status = "declined";
    p.declinedAt = now;
    save(shape);
    return true;
  }
  const { data, error } = await db()
    .from("business_packages")
    .update({ status: "declined", declined_at: now })
    .eq("id", id)
    .eq("status", "pending_review")
    .select("id");
  if (error) {
    if (schemaMissing(error)) return false;
    throw error;
  }
  return (data ?? []).length > 0;
}

/** Operator confirms the manual Stripe refund happened (declined packages only). */
export async function markBusinessRefunded(id: number): Promise<void> {
  const now = new Date().toISOString();
  if (!supabaseConfigured) {
    const shape = load();
    const p = shape.packages.find((x) => x.id === id);
    if (p && p.status === "declined" && !p.refundedAt) {
      p.refundedAt = now;
      save(shape);
    }
    return;
  }
  const { error } = await db()
    .from("business_packages")
    .update({ refunded_at: now })
    .eq("id", id)
    .eq("status", "declined")
    .is("refunded_at", null);
  if (error && !schemaMissing(error)) throw error;
}

/**
 * Active packages due to ride the digest composing for ET day `day` — still
 * has paid days left and hasn't ridden today (the once-a-day rule; the first
 * composed digest of the day picks them all up). [] pre-migration, so the
 * digest engine composes exactly as before.
 */
export async function listDueSponsors(day: string): Promise<BusinessPackage[]> {
  if (!supabaseConfigured) {
    return load()
      .packages.filter(
        (p) => p.status === "active" && p.daysRan < p.daysPurchased && p.lastRanOn !== day,
      )
      .sort((a, b) => a.id - b.id);
  }
  const { data, error } = await db()
    .from("business_packages")
    .select(ROW_SELECT)
    .eq("status", "active")
    .or(`last_ran_on.is.null,last_ran_on.neq.${day}`)
    .order("id", { ascending: true })
    .limit(50);
  if (error) {
    if (schemaMissing(error)) return [];
    throw error;
  }
  // days_ran < days_purchased is a column-to-column compare — cheapest done here.
  return (data ?? []).map(toPackage).filter((p) => p.daysRan < p.daysPurchased);
}

/**
 * Record that a package's sponsor line rode a digest: consumes ONE paid day,
 * remembers the day (once-a-day dedup) and the slot key (the email edition
 * mirrors the sponsor by it), and expires the package when its last paid day
 * is ridden. Guarded so a concurrent double-compose can't double-count a day.
 */
export async function markSponsorRan(id: number, day: string, key: string): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    const p = shape.packages.find((x) => x.id === id);
    if (!p || p.status !== "active" || p.lastRanOn === day) return;
    p.lastRanOn = day;
    p.lastRanKey = key;
    p.daysRan += 1;
    if (p.daysRan >= p.daysPurchased) p.status = "expired";
    save(shape);
    return;
  }
  const existing = await getBusinessPackage(id);
  if (!existing || existing.status !== "active" || existing.lastRanOn === day) return;
  const ran = existing.daysRan + 1;
  const { error } = await db()
    .from("business_packages")
    .update({
      last_ran_on: day,
      last_ran_key: key,
      days_ran: ran,
      ...(ran >= existing.daysPurchased && { status: "expired" }),
    })
    .eq("id", id)
    .eq("status", "active")
    .or(`last_ran_on.is.null,last_ran_on.neq.${day}`); // lost race = someone else counted it
  if (error && !schemaMissing(error)) throw error;
}

/**
 * Packages whose sponsor line rode the digest with this slot key — the email
 * edition mirrors exactly what the SMS digest carried (status-agnostic: the
 * ride may have been the package's last day).
 */
export async function listSponsorsRanWithKey(key: string): Promise<BusinessPackage[]> {
  if (!supabaseConfigured) {
    return load()
      .packages.filter((p) => p.lastRanKey === key)
      .sort((a, b) => a.id - b.id);
  }
  const { data, error } = await db()
    .from("business_packages")
    .select(ROW_SELECT)
    .eq("last_ran_key", key)
    .order("id", { ascending: true })
    .limit(50);
  if (error) {
    if (schemaMissing(error)) return [];
    throw error;
  }
  return (data ?? []).map(toPackage);
}
