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
  const { data, error } = await db()
    .from("blocked_numbers")
    .select("phone")
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
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
  const { data, error } = await db()
    .from("blocked_numbers")
    .select("phone, reason, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    phone: r.phone as string,
    reason: (r.reason as string) ?? "",
    createdAt: (r.created_at as string) ?? new Date(0).toISOString(),
    ...(r.created_by ? { createdBy: r.created_by as string } : {}),
  }));
}
