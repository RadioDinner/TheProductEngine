/**
 * The users table's column catalogue and query shaping (feature 41).
 *
 * Pure and dependency-free so the unit suite can pin it — and because BOTH
 * the client component (which renders the column pickers) and the server
 * (which builds the query) read from it. One list, so a column can never be
 * offered in the picker but rejected by the query.
 *
 * The column keys are the view's real column names (migration 9962). That is
 * deliberate: sorting and filtering are done by the DATABASE, so a key here
 * is passed to PostgREST — which is exactly why every key a request supplies
 * must be checked against this list before it goes anywhere near a query.
 */

export type ColumnKind = "text" | "phone" | "email" | "money" | "number" | "date" | "bool";

export interface ColumnDef {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Shown by default — the columns most operators want most of the time. */
  standard?: boolean;
}

/**
 * Every column the table can show. Ordered as they read left to right, so a
 * fresh view lands on something sensible without any configuration.
 */
export const USER_COLUMNS: ColumnDef[] = [
  { key: "phone", label: "Number", kind: "phone", standard: true },
  { key: "member_id", label: "Member id", kind: "text" },
  { key: "email", label: "Email", kind: "email", standard: true },
  { key: "member_since", label: "Member since", kind: "date", standard: true },
  { key: "subscribed_at", label: "Subscribed", kind: "date", standard: true },
  { key: "email_subscribed_at", label: "Email subscribed", kind: "date" },
  { key: "ads_posted", label: "Ads posted", kind: "number", standard: true },
  { key: "ads_sold", label: "Ads sold", kind: "number" },
  { key: "ads_live", label: "Ads live", kind: "number" },
  { key: "spent_cents", label: "Money spent", kind: "money", standard: true },
  { key: "added_cents", label: "Money added", kind: "money" },
  { key: "balance_cents", label: "Balance", kind: "money", standard: true },
  { key: "messages_in", label: "Texts in", kind: "number" },
  { key: "last_active_at", label: "Last active", kind: "date", standard: true },
  { key: "verified_at", label: "Verified", kind: "date" },
  { key: "line_type", label: "Line type", kind: "text" },
  { key: "card_on_file", label: "Card on file", kind: "bool" },
  { key: "auto_topup", label: "Auto top-up", kind: "bool" },
  { key: "starter_granted_at", label: "Starter credit taken", kind: "date" },
  { key: "pic_balance", label: "Picture pulls banked", kind: "number" },
  { key: "offense_count", label: "Strikes", kind: "number" },
  { key: "posting_banned_at", label: "Posting banned", kind: "date" },
  { key: "archived_at", label: "Archived", kind: "date" },
  { key: "blocked", label: "Blocked", kind: "bool" },
];

const BY_KEY = new Map(USER_COLUMNS.map((c) => [c.key, c]));

export function columnDef(key: string): ColumnDef | undefined {
  return BY_KEY.get(key);
}

/** The default layout: the standard columns, in catalogue order. */
export function defaultColumns(): string[] {
  return USER_COLUMNS.filter((c) => c.standard).map((c) => c.key);
}

/**
 * Keep only keys this table actually has, in catalogue order, deduped.
 *
 * Order comes from the catalogue rather than the request on purpose: a saved
 * view written before a column existed still renders sensibly, and the header
 * row and the body cells can never disagree about order.
 */
export function validColumns(keys: unknown): string[] {
  if (!Array.isArray(keys)) return defaultColumns();
  const wanted = new Set(keys.filter((k): k is string => typeof k === "string"));
  const kept = USER_COLUMNS.filter((c) => wanted.has(c.key)).map((c) => c.key);
  // An empty or entirely unrecognised selection would render a table with no
  // columns, which looks like a broken page rather than a chosen layout.
  return kept.length ? kept : defaultColumns();
}

export interface Filter {
  column: string;
  value: string;
}

/**
 * A filter the query can safely run.
 *
 * Returns null for anything unrecognised — an unknown column, an empty value,
 * a number filter that isn't a number. The caller drops nulls, so a bad
 * filter narrows nothing rather than erroring or, worse, being passed through
 * to PostgREST as an unvalidated column name.
 */
export function parseFilter(raw: Partial<Filter>): Filter | null {
  const column = typeof raw.column === "string" ? raw.column : "";
  const def = BY_KEY.get(column);
  if (!def) return null;
  const value = typeof raw.value === "string" ? raw.value.trim().slice(0, 100) : "";
  if (!value) return null;
  if (def.kind === "number" || def.kind === "money") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  }
  if (def.kind === "bool") {
    const v = value.toLowerCase();
    if (v !== "yes" && v !== "no" && v !== "true" && v !== "false") return null;
    return { column, value: v === "yes" || v === "true" ? "true" : "false" };
  }
  return { column, value };
}

/**
 * How a filter is applied, given the column's kind. Text and phone match
 * loosely (an operator typing four digits of a number means "contains"),
 * everything else matches exactly.
 *
 * Money is entered in DOLLARS and compared in CENTS — the operator types 20,
 * not 2000, because the column is labelled "Money spent" and shows dollars.
 * A filter box that silently wanted cents would be a trap.
 */
export function filterPlan(
  filter: Filter,
): { op: "ilike" | "eq" | "gte"; value: string } | null {
  const def = BY_KEY.get(filter.column);
  if (!def) return null;
  switch (def.kind) {
    case "text":
    case "phone":
    case "email":
      return { op: "ilike", value: `%${filter.value}%` };
    case "bool":
      return { op: "eq", value: filter.value };
    case "money":
      return { op: "gte", value: String(Math.round(Number(filter.value) * 100)) };
    case "number":
      return { op: "gte", value: String(Math.floor(Number(filter.value))) };
    case "date":
      // A date filter means "on or after" — the useful question about a date
      // column is nearly always "who since when".
      return { op: "gte", value: filter.value };
    default:
      return null;
  }
}

/** A sort the query can run: a real column, and a direction. */
export function parseSort(
  column: unknown,
  direction: unknown,
): { column: string; ascending: boolean } {
  const key = typeof column === "string" && BY_KEY.has(column) ? column : "last_active_at";
  return { column: key, ascending: direction === "asc" };
}

/** What a saved view stores. Kept small and boring — it is a jsonb blob. */
export interface SavedViewConfig {
  columns: string[];
  filters: Filter[];
  sortColumn: string;
  sortAscending: boolean;
}

/** Normalise a stored view, so an old or hand-edited one can't break the page. */
export function normalizeView(raw: unknown): SavedViewConfig {
  const o = (raw ?? {}) as Partial<SavedViewConfig>;
  const sort = parseSort(o.sortColumn, o.sortAscending ? "asc" : "desc");
  return {
    columns: validColumns(o.columns),
    filters: Array.isArray(o.filters)
      ? o.filters.map((f) => parseFilter(f)).filter((f): f is Filter => f !== null)
      : [],
    sortColumn: sort.column,
    sortAscending: sort.ascending,
  };
}
