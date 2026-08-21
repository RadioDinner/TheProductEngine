/**
 * Where an edited auto-reply lives (session 021).
 *
 * Only OVERRIDES are stored — one row per message the operator has actually
 * changed. Everything else falls through to the default in
 * lib/message-templates.ts, so "Reset to the original wording" is a DELETE and
 * a message nobody has touched has no row at all. That is deliberate: it means
 * a code change to a default reaches production for every message the operator
 * has not personally rewritten, instead of being silently shadowed by a copy of
 * the old text taken the day the table was created.
 *
 * Dual-mode like every other store here: `.data/message-templates.json` in
 * development, the `message_templates` table (migration 9950) in Supabase.
 *
 * ⚠️ A MISSING TABLE READS AS "NO OVERRIDES", NOT AS AN ERROR. Until 9950 is
 * pasted, every message renders its shipped default and the admin page says the
 * table is missing. The alternative — throwing — would take down every inbound
 * text on a deploy that landed before the migration, to protect an edit nobody
 * has made yet.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";

export interface StoredTemplate {
  key: string;
  body: string;
  updatedAt: string;
}

const STORE_PATH = join(process.cwd(), ".data", "message-templates.json");

type FileShape = Record<string, { body: string; updatedAt: string }>;

function loadFile(): FileShape {
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as FileShape;
  } catch {
    return {};
  }
}

function saveFile(shape: FileShape): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(shape, null, 2), "utf8");
}

/** Postgres "relation does not exist" — migration 9950 not pasted yet. */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

/**
 * Every override, keyed. Never throws: a database that can't answer is
 * indistinguishable, for our purposes, from one with no overrides in it, and
 * the difference must not stop a member's text from being answered.
 */
export async function getTemplateOverrides(): Promise<Map<string, StoredTemplate>> {
  const out = new Map<string, StoredTemplate>();
  if (!supabaseConfigured) {
    for (const [key, row] of Object.entries(loadFile())) {
      out.set(key, { key, body: row.body, updatedAt: row.updatedAt });
    }
    return out;
  }
  try {
    const { data, error } = await db().from("message_templates").select("key, body, updated_at");
    if (error) {
      if (!missingTable(error)) console.error("[message-templates] read failed:", error);
      return out;
    }
    for (const row of data ?? []) {
      out.set(row.key as string, {
        key: row.key as string,
        body: row.body as string,
        updatedAt: (row.updated_at as string) ?? "",
      });
    }
  } catch (e) {
    console.error("[message-templates] read threw:", e);
  }
  return out;
}

/** True when the storage is actually there — the admin page says so when not. */
export async function templateStorageReady(): Promise<boolean> {
  if (!supabaseConfigured) return true;
  const { error } = await db().from("message_templates").select("key").limit(1);
  return !error;
}

/** Save one override. Throws — the admin action wants to know. */
export async function saveTemplateOverride(key: string, body: string): Promise<void> {
  if (!supabaseConfigured) {
    const shape = loadFile();
    shape[key] = { body, updatedAt: new Date().toISOString() };
    saveFile(shape);
    return;
  }
  const { error } = await db()
    .from("message_templates")
    .upsert({ key, body, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

/** Drop an override, so the message goes back to the wording in the code. */
export async function clearTemplateOverride(key: string): Promise<void> {
  if (!supabaseConfigured) {
    const shape = loadFile();
    delete shape[key];
    saveFile(shape);
    return;
  }
  const { error } = await db().from("message_templates").delete().eq("key", key);
  if (error) throw error;
}
