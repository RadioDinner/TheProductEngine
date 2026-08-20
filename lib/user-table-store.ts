/**
 * Reading the users table view, and storing saved views (feature 41,
 * migration 9962).
 *
 * Supabase only. The dev fixture store has no aggregate view and building a
 * second implementation of this would mean two versions of the filtering to
 * keep in step — the table degrades to a clear message in dev instead.
 */
import { db, supabaseConfigured } from "@/lib/db";
import {
  filterPlan,
  normalizeView,
  type Filter,
  type SavedViewConfig,
} from "@/lib/user-table";

export interface UserRow {
  user_id: string;
  phone: string | null;
  email: string | null;
  member_id: string | null;
  member_since: string;
  subscribed_at: string | null;
  email_subscribed_at: string | null;
  verified_at: string | null;
  posting_banned_at: string | null;
  archived_at: string | null;
  offense_count: number;
  starter_granted_at: string | null;
  line_type: string | null;
  pic_balance: number;
  card_on_file: boolean;
  auto_topup: boolean;
  blocked: boolean;
  ads_posted: number;
  ads_sold: number;
  ads_live: number;
  balance_cents: number;
  spent_cents: number;
  added_cents: number;
  last_active_at: string | null;
  messages_in: number;
}

export interface TableQuery {
  filters: Filter[];
  sortColumn: string;
  sortAscending: boolean;
  page: number;
  pageSize: number;
}

export interface TableResult {
  rows: UserRow[];
  total: number;
}

/**
 * One query, with filtering, sorting and paging all done in the database.
 *
 * Every column name reaching PostgREST has already been checked against the
 * catalogue (lib/user-table.ts) — filterPlan returns null for anything it
 * doesn't recognise, and parseSort falls back to a known column. Nothing from
 * a request is interpolated as a column name without passing through those.
 */
export async function queryUserRows(
  q: TableQuery,
): Promise<TableResult | "unsupported"> {
  if (!supabaseConfigured) return "unsupported";
  let query = db()
    .from("admin_user_rows")
    .select("*", { count: "exact" });

  for (const filter of q.filters) {
    const plan = filterPlan(filter);
    if (!plan) continue;
    if (plan.op === "ilike") query = query.ilike(filter.column, plan.value);
    else if (plan.op === "eq") query = query.eq(filter.column, plan.value);
    else query = query.gte(filter.column, plan.value);
  }

  const from = Math.max(0, q.page) * q.pageSize;
  const { data, error, count } = await query
    // nullsFirst false: a member who has never done anything sorts last on a
    // "last active" descending sort, which is where they belong.
    .order(q.sortColumn, { ascending: q.sortAscending, nullsFirst: false })
    .range(from, from + q.pageSize - 1);

  if (error) {
    // 42P01 = the view isn't there yet (migration 9962 pending).
    if (error.code === "42P01" || error.code === "PGRST205") return "unsupported";
    throw error;
  }
  return { rows: (data ?? []) as UserRow[], total: count ?? 0 };
}

export interface SavedView {
  id: number;
  name: string;
  config: SavedViewConfig;
}

export async function listSavedViews(
  ownerPhone: string,
): Promise<SavedView[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await db()
    .from("admin_saved_views")
    .select("id, name, config")
    .eq("owner_phone", ownerPhone)
    .order("name");
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as number,
    name: r.name as string,
    config: normalizeView(r.config),
  }));
}

/** Save (or overwrite) a named view for this operator. */
export async function saveView(
  ownerPhone: string,
  name: string,
  config: SavedViewConfig,
): Promise<"saved" | "unsupported"> {
  if (!supabaseConfigured) return "unsupported";
  const { error } = await db()
    .from("admin_saved_views")
    .upsert(
      { owner_phone: ownerPhone, name, config },
      { onConflict: "owner_phone,name" },
    );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "unsupported";
    throw error;
  }
  return "saved";
}

export async function deleteView(ownerPhone: string, id: number): Promise<void> {
  if (!supabaseConfigured) return;
  // Scoped to the owner as well as the id: an operator can only ever delete
  // their own layout, never another's.
  await db().from("admin_saved_views").delete().eq("id", id).eq("owner_phone", ownerPhone);
}
