/**
 * Storage for "I need help!" reports (feature 39). Dual-mode like the rest —
 * a JSON file in dev, the `help_reports` table in Supabase.
 *
 * Degrades the way every late-migration feature here does: before 9965 is
 * pasted, filing a report still EMAILS the operator and simply isn't queued.
 * A member asking for help must never be told "no" because a migration is
 * outstanding.
 *
 * Split from lib/help-reports.ts (the pure shape) because the help button is
 * a client component: keeping node:fs out of its import graph is the whole
 * reason these are two files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";
import type { HelpDiagnostics, HelpReport } from "@/lib/help-reports";

// ---------- file implementation ----------

interface Shape {
  reports: HelpReport[];
  nextId: number;
}
const PATH = join(process.cwd(), ".data", "help-reports.json");

function load(): Shape {
  try {
    return JSON.parse(readFileSync(PATH, "utf8")) as Shape;
  } catch {
    return { reports: [], nextId: 1 };
  }
}
function save(shape: Shape): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- public interface ----------

export interface NewHelpReport extends HelpDiagnostics {
  phone: string | null;
  memberId: string | null;
  hasEmail: boolean;
}

/** File a report. "unsupported" = migration 9965 pending; the caller still
 * emails, so the operator hears about it either way. */
export async function addHelpReport(
  input: NewHelpReport,
): Promise<"saved" | "unsupported"> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.reports.unshift({
      ...input,
      id: shape.nextId++,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedNote: null,
    });
    save(shape);
    return "saved";
  }
  const { error } = await db().from("help_reports").insert({
    note: input.note ?? null,
    phone: input.phone,
    member_id: input.memberId,
    has_email: input.hasEmail,
    path: input.path,
    referrer: input.referrer ?? null,
    user_agent: input.userAgent ?? null,
    viewport: input.viewport ?? null,
    timezone: input.timezone ?? null,
    last_error: input.lastError ?? null,
  });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "unsupported";
    throw error;
  }
  return "saved";
}

/** Newest first. `openOnly` is the working view. */
export async function listHelpReports(
  openOnly: boolean,
  limit = 200,
): Promise<HelpReport[] | "unsupported"> {
  if (!supabaseConfigured) {
    const all = load().reports;
    return (openOnly ? all.filter((r) => !r.resolvedAt) : all).slice(0, limit);
  }
  let q = db()
    .from("help_reports")
    .select(
      "id, note, phone, member_id, has_email, path, referrer, user_agent, viewport, timezone, last_error, resolved_at, resolved_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (openOnly) q = q.is("resolved_at", null);
  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "unsupported";
    throw error;
  }
  return (data ?? []).map((r) => ({
    id: r.id as number,
    note: (r.note as string | null) ?? undefined,
    phone: (r.phone as string | null) ?? null,
    memberId: (r.member_id as string | null) ?? null,
    hasEmail: Boolean(r.has_email),
    path: r.path as string,
    referrer: (r.referrer as string | null) ?? undefined,
    userAgent: (r.user_agent as string | null) ?? undefined,
    viewport: (r.viewport as string | null) ?? undefined,
    timezone: (r.timezone as string | null) ?? undefined,
    lastError: (r.last_error as string | null) ?? undefined,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedNote: (r.resolved_note as string | null) ?? null,
  }));
}

/** Mark one dealt with (or reopen it). */
export async function resolveHelpReport(
  id: number,
  note: string,
  resolved: boolean,
): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    const row = shape.reports.find((r) => r.id === id);
    if (row) {
      row.resolvedAt = resolved ? new Date().toISOString() : null;
      row.resolvedNote = resolved ? note || null : null;
    }
    save(shape);
    return;
  }
  const { error } = await db()
    .from("help_reports")
    .update({
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_note: resolved ? note || null : null,
    })
    .eq("id", id);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
}

/** How many are waiting — for the admin nav badge. */
export async function countOpenHelpReports(): Promise<number> {
  if (!supabaseConfigured) return load().reports.filter((r) => !r.resolvedAt).length;
  const { count, error } = await db()
    .from("help_reports")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  if (error) return 0;
  return count ?? 0;
}
