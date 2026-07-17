/**
 * Number blocklist for UNDER ATTACK response. A blocked number is dropped at
 * the top of the inbound engine — no account, no reply, no charge — and is
 * excluded from digest recipients and any outbound send. Dual-mode like the
 * rest: a JSON file in dev, the `blocked_numbers` table in Supabase.
 *
 * Phones are stored as the app's canonical 10-digit form (lib/phone
 * normalizePhone), so callers should pass already-normalized numbers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";

export interface BlockedNumber {
  phone: string;
  reason: string;
  createdAt: string;
  createdBy?: string;
}

// ---------- file implementation ----------

interface BlockShape {
  numbers: BlockedNumber[];
}

const BLOCK_PATH = join(process.cwd(), ".data", "blocked.json");

function load(): BlockShape {
  try {
    return JSON.parse(readFileSync(BLOCK_PATH, "utf8")) as BlockShape;
  } catch {
    return { numbers: [] };
  }
}

function save(shape: BlockShape): void {
  mkdirSync(dirname(BLOCK_PATH), { recursive: true });
  writeFileSync(BLOCK_PATH, JSON.stringify(shape, null, 2), "utf8");
}

// ---------- public interface ----------

/** True if this (normalized) number is on the blocklist. Hot path — keep cheap. */
export async function isBlockedNumber(phone: string): Promise<boolean> {
  if (!phone) return false;
  if (!supabaseConfigured) {
    return load().numbers.some((n) => n.phone === phone);
  }
  try {
    const { data, error } = await db()
      .from("blocked_numbers")
      .select("phone")
      .eq("phone", phone)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  } catch (e) {
    // Fail OPEN: this runs on EVERY inbound and outbound send, so a missing
    // blocked_numbers table (migration 9992 not applied) or a transient DB
    // error must never take down the message path — the blocklist is an added
    // protection, not a gate the whole system depends on.
    console.error("[blocklist] isBlockedNumber failed (treating as not-blocked):", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function blockNumber(phone: string, reason: string, by?: string): Promise<void> {
  if (!phone) return;
  const clean = reason.trim() || "Blocked from admin";
  if (!supabaseConfigured) {
    const shape = load();
    if (!shape.numbers.some((n) => n.phone === phone)) {
      shape.numbers.push({
        phone,
        reason: clean,
        createdAt: new Date().toISOString(),
        ...(by && { createdBy: by }),
      });
      save(shape);
    }
    return;
  }
  const { error } = await db()
    .from("blocked_numbers")
    .upsert({ phone, reason: clean, created_by: by ?? null }, { onConflict: "phone" });
  if (error) throw error;
}

export async function unblockNumber(phone: string): Promise<void> {
  if (!phone) return;
  if (!supabaseConfigured) {
    const shape = load();
    shape.numbers = shape.numbers.filter((n) => n.phone !== phone);
    save(shape);
    return;
  }
  const { error } = await db().from("blocked_numbers").delete().eq("phone", phone);
  if (error) throw error;
}

export async function listBlocked(): Promise<BlockedNumber[]> {
  if (!supabaseConfigured) {
    return [...load().numbers].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  try {
    // Page through ALL rows: the digest broadcaster builds its block-set from
    // this list, so a 500-row cap meant blocked numbers past 500 kept receiving
    // broadcasts. PostgREST caps a single response at ~1000, so loop.
    const PAGE = 1000;
    const out: BlockedNumber[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("blocked_numbers")
        .select("phone, reason, created_by, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = data ?? [];
      out.push(
        ...rows.map((r) => ({
          phone: r.phone as string,
          reason: (r.reason as string) ?? "",
          createdAt: (r.created_at as string) ?? new Date(0).toISOString(),
          ...(r.created_by ? { createdBy: r.created_by as string } : {}),
        })),
      );
      if (rows.length < PAGE) break;
    }
    return out;
  } catch (e) {
    // Empty (not an error) if the table isn't there yet — the digest drain and
    // admin pages must keep working before migration 9992 is applied.
    console.error("[blocklist] listBlocked failed (treating as empty):", e instanceof Error ? e.message : e);
    return [];
  }
}
