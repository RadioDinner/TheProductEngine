/**
 * Featured sidebar spot storage (FEATURES item 19). Dual-mode like the rest:
 * a JSON file in dev, the `featured_spots` table (migration 9977 — shared
 * with the town-hall events table) in Supabase.
 *
 * Degrade-not-crash: pre-migration the homepage reads [] (the Featured
 * sidebar hides entirely — visitors never see scaffolding) and the admin
 * page reads null (it shows the run-the-migration note). Nothing on the
 * public render path ever throws.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";
import type { FeaturedSpotView } from "@/lib/featured";

/** A stored spot — the view fields plus the admin-facing state. */
export interface FeaturedSpot extends FeaturedSpotView {
  active: boolean;
  createdAt: string;
}

export interface FeaturedSpotInput {
  slot: number; // 1 | 2
  position: number; // 1..3
  src: string; // already stored image URL (bucket, or data: URI in dev)
  caption: string | null;
  linkUrl: string | null;
  active: boolean;
}

// ---------- file implementation (development) ----------

interface FeaturedShape {
  spots: FeaturedSpot[];
  nextSpotId: number;
}

const FEATURED_PATH = join(process.cwd(), ".data", "featured.json");

function load(): FeaturedShape {
  try {
    return JSON.parse(readFileSync(FEATURED_PATH, "utf8")) as FeaturedShape;
  } catch {
    return { spots: [], nextSpotId: 1 };
  }
}

function save(shape: FeaturedShape): void {
  mkdirSync(dirname(FEATURED_PATH), { recursive: true });
  writeFileSync(FEATURED_PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- supabase helpers ----------

/** Missing 9977 schema → the whole featured surface is dormant. */
function schemaMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "42703";
}

const SPOT_SELECT = "id, slot, position, src, caption, link_url, active, created_at";

type SpotRow = {
  id: number;
  slot: number;
  position: number;
  src: string;
  caption: string | null;
  link_url: string | null;
  active: boolean;
  created_at: string;
};

function toSpot(row: SpotRow): FeaturedSpot {
  return {
    id: row.id,
    slot: row.slot,
    position: row.position,
    src: row.src,
    caption: row.caption,
    linkUrl: row.link_url,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

// ---------- public interface ----------

/** ACTIVE spots for the homepage sidebar — [] pre-migration or when the
 * operator has nothing running (the sidebar hides in both cases). */
export async function listActiveFeaturedSpots(): Promise<FeaturedSpotView[]> {
  if (!supabaseConfigured) {
    return load().spots.filter((s) => s.active);
  }
  try {
    const { data, error } = await db()
      .from("featured_spots")
      .select(SPOT_SELECT)
      .eq("active", true)
      .order("slot", { ascending: true })
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      if (schemaMissing(error)) return [];
      throw error;
    }
    return ((data ?? []) as SpotRow[]).map(toSpot);
  } catch (e) {
    // Homepage render path — hide the sidebar, never 500.
    console.error("[featured] listActiveFeaturedSpots failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Every spot for the admin page — null = migration 9977 not applied yet. */
export async function listFeaturedSpots(): Promise<FeaturedSpot[] | null> {
  if (!supabaseConfigured) {
    return [...load().spots].sort(
      (a, b) => a.slot - b.slot || a.position - b.position || a.id - b.id,
    );
  }
  try {
    const { data, error } = await db()
      .from("featured_spots")
      .select(SPOT_SELECT)
      .order("slot", { ascending: true })
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      if (schemaMissing(error)) return null;
      throw error;
    }
    return ((data ?? []) as SpotRow[]).map(toSpot);
  } catch (e) {
    console.error("[featured] listFeaturedSpots failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function addFeaturedSpot(input: FeaturedSpotInput): Promise<"added" | "unsupported"> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.spots.push({
      id: shape.nextSpotId,
      slot: input.slot,
      position: input.position,
      src: input.src,
      caption: input.caption,
      linkUrl: input.linkUrl,
      active: input.active,
      createdAt: new Date().toISOString(),
    });
    shape.nextSpotId += 1;
    save(shape);
    return "added";
  }
  const { error } = await db().from("featured_spots").insert({
    slot: input.slot,
    position: input.position,
    src: input.src,
    caption: input.caption,
    link_url: input.linkUrl,
    active: input.active,
  });
  if (error) {
    if (schemaMissing(error)) return "unsupported";
    throw error;
  }
  return "added";
}

export async function setFeaturedSpotActive(id: number, active: boolean): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    const spot = shape.spots.find((s) => s.id === id);
    if (spot) {
      spot.active = active;
      save(shape);
    }
    return;
  }
  const { error } = await db().from("featured_spots").update({ active }).eq("id", id);
  if (error && !schemaMissing(error)) throw error;
}

/** Delete a spot; returns its image src so the caller can clean up storage. */
export async function deleteFeaturedSpot(id: number): Promise<string | null> {
  if (!supabaseConfigured) {
    const shape = load();
    const spot = shape.spots.find((s) => s.id === id);
    shape.spots = shape.spots.filter((s) => s.id !== id);
    save(shape);
    return spot?.src ?? null;
  }
  const { data, error } = await db()
    .from("featured_spots")
    .delete()
    .eq("id", id)
    .select("src")
    .maybeSingle();
  if (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }
  return (data?.src as string | undefined) ?? null;
}
