/**
 * Town hall events storage (FEATURES item 18, v1). Dual-mode like the rest:
 * a JSON file in dev, the `events` table (migration 9977) in Supabase.
 *
 * Degrade-not-crash: before migration 9977 is pasted, every read reports the
 * board as closed (null / empty) and submissions come back "unsupported" —
 * the homepage sidebar hides, /town-hall says "not open yet", the admin block
 * hides. Nothing on the public render path ever throws.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";
import { upcomingEvents, type TownEventView } from "@/lib/town-hall";

export type EventStatus = "pending" | "approved" | "declined";

/** A stored event — the view fields plus ownership/review state. */
export interface StoredEvent extends TownEventView {
  ownerPhone: string;
  status: EventStatus;
  createdAt: string;
}

export interface EventInput {
  ownerPhone: string;
  title: string;
  eventDate: string; // validated YYYY-MM-DD (lib/town-hall eventDateVerdict)
  timeText: string | null;
  placeText: string | null;
  body: string;
}

// ---------- file implementation (development) ----------

interface TownHallShape {
  events: StoredEvent[];
  nextEventId: number;
}

const TOWN_HALL_PATH = join(process.cwd(), ".data", "town-hall.json");

function load(): TownHallShape {
  try {
    return JSON.parse(readFileSync(TOWN_HALL_PATH, "utf8")) as TownHallShape;
  } catch {
    return { events: [], nextEventId: 1 };
  }
}

function save(shape: TownHallShape): void {
  mkdirSync(dirname(TOWN_HALL_PATH), { recursive: true });
  writeFileSync(TOWN_HALL_PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- supabase helpers ----------

/** Missing 9977 schema → the whole town-hall surface is dormant. */
function schemaMissing(error: { code?: string } | null): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" || // PostgREST: table not in schema cache (pre-paste)
    error?.code === "PGRST204" // PostgREST: payload column not in schema cache
  );
}

const EVENT_SELECT = "id, owner_phone, title, event_date, time_text, place_text, body, status, created_at";

type EventRow = {
  id: number;
  owner_phone: string;
  title: string;
  event_date: string;
  time_text: string | null;
  place_text: string | null;
  body: string;
  status: string;
  created_at: string;
};

function toStored(row: EventRow): StoredEvent {
  return {
    id: row.id,
    ownerPhone: row.owner_phone,
    title: row.title,
    eventDate: row.event_date,
    timeText: row.time_text,
    placeText: row.place_text,
    body: row.body,
    status: (row.status as EventStatus) ?? "pending",
    createdAt: row.created_at,
  };
}

// ---------- public interface ----------

/**
 * Upcoming APPROVED events for the public surfaces: today-or-later, nearest
 * first. Returns null when the board isn't open yet (migration 9977 missing)
 * so callers can hide the surface entirely — vs. [] for "open but quiet".
 */
export async function listUpcomingEvents(
  todayDay: string,
  limit?: number,
): Promise<TownEventView[] | null> {
  if (!supabaseConfigured) {
    const approved = load().events.filter((e) => e.status === "approved");
    const upcoming = upcomingEvents(approved, todayDay);
    return (limit ? upcoming.slice(0, limit) : upcoming).map(strip);
  }
  try {
    let query = db()
      .from("events")
      .select(EVENT_SELECT)
      .eq("status", "approved")
      .gte("event_date", todayDay)
      .order("event_date", { ascending: true })
      .order("id", { ascending: true });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) {
      if (schemaMissing(error)) return null;
      throw error;
    }
    return ((data ?? []) as EventRow[]).map((r) => strip(toStored(r)));
  } catch (e) {
    // Homepage render path — degrade to "board closed", never 500.
    console.error("[town-hall] listUpcomingEvents failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function strip(e: StoredEvent): TownEventView {
  return {
    id: e.id,
    title: e.title,
    eventDate: e.eventDate,
    timeText: e.timeText,
    placeText: e.placeText,
    body: e.body,
  };
}

/** Submit a member event — lands PENDING, same review posture as an ad. */
export async function submitEvent(input: EventInput): Promise<"added" | "unsupported"> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.events.push({
      id: shape.nextEventId,
      ownerPhone: input.ownerPhone,
      title: input.title,
      eventDate: input.eventDate,
      timeText: input.timeText,
      placeText: input.placeText,
      body: input.body,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    shape.nextEventId += 1;
    save(shape);
    return "added";
  }
  const { error } = await db().from("events").insert({
    owner_phone: input.ownerPhone,
    title: input.title,
    event_date: input.eventDate,
    time_text: input.timeText,
    place_text: input.placeText,
    body: input.body,
  });
  if (error) {
    if (schemaMissing(error)) return "unsupported";
    throw error;
  }
  return "added";
}

/** Pending events for the admin review queue — oldest first, [] pre-9977
 * (the review block simply hides). */
export async function listPendingEvents(): Promise<StoredEvent[]> {
  if (!supabaseConfigured) {
    return load()
      .events.filter((e) => e.status === "pending")
      .sort((a, b) => a.id - b.id);
  }
  try {
    const { data, error } = await db()
      .from("events")
      .select(EVENT_SELECT)
      .eq("status", "pending")
      .order("id", { ascending: true });
    if (error) {
      if (schemaMissing(error)) return [];
      throw error;
    }
    return ((data ?? []) as EventRow[]).map(toStored);
  } catch (e) {
    console.error("[town-hall] listPendingEvents failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Approve or decline a pending event (decline is simple in v1 — the listing
 * is free, so there is nothing to refund). */
export async function resolveEvent(
  id: number,
  decision: "approved" | "declined",
): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    const event = shape.events.find((e) => e.id === id && e.status === "pending");
    if (event) {
      event.status = decision;
      save(shape);
    }
    return;
  }
  const { error } = await db()
    .from("events")
    .update({ status: decision })
    .eq("id", id)
    .eq("status", "pending");
  if (error && !schemaMissing(error)) throw error;
}
