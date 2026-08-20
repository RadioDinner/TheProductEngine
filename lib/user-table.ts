/**
 * The users table's column catalogue and query shaping (feature 41; the
 * database-viewer rebuild is session 019).
 *
 * Pure and dependency-free so the unit suite can pin it — and because BOTH
 * the client component (which renders the grid, the per-column filter row and
 * the drag/resize handles) and the server (which builds the query) read from
 * it. One list, so a column can never be offered in the picker but rejected
 * by the query.
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
  /** Starting width in pixels. Only a starting point: the grid always scales
   * the whole row to the width it actually has (see fitColumnWidths). */
  width?: number;
}

/**
 * Every column the table can show. Ordered as they read left to right, so a
 * fresh view lands on something sensible without any configuration.
 */
export const USER_COLUMNS: ColumnDef[] = [
  { key: "phone", label: "Number", kind: "phone", standard: true, width: 130 },
  { key: "member_id", label: "Member id", kind: "text", width: 110 },
  { key: "email", label: "Email", kind: "email", standard: true, width: 210 },
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
  { key: "line_type", label: "Line type", kind: "text", width: 120 },
  { key: "card_on_file", label: "Card on file", kind: "bool" },
  { key: "auto_topup", label: "Auto top-up", kind: "bool" },
  { key: "starter_granted_at", label: "Starter credit taken", kind: "date", width: 150 },
  { key: "pic_balance", label: "Picture pulls banked", kind: "number", width: 150 },
  { key: "offense_count", label: "Strikes", kind: "number", width: 90 },
  { key: "posting_banned_at", label: "Posting banned", kind: "date" },
  { key: "archived_at", label: "Archived", kind: "date" },
  { key: "blocked", label: "Blocked", kind: "bool", width: 90 },
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
 * Keep only keys this table actually has, in the order they were ASKED for,
 * deduped.
 *
 * Request order (not catalogue order) since session 019, because columns are
 * now dragged into the order the operator wants and `cols` in the URL is how
 * that order is carried. The header row and the body cells still can never
 * disagree: one array drives both.
 */
export function validColumns(keys: unknown): string[] {
  if (!Array.isArray(keys)) return defaultColumns();
  const kept: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string" || !BY_KEY.has(k) || kept.includes(k)) continue;
    kept.push(k);
  }
  // An empty or entirely unrecognised selection would render a table with no
  // columns, which looks like a broken page rather than a chosen layout.
  return kept.length ? kept : defaultColumns();
}

// ---------- column widths ----------

/** Nothing may be dragged narrower than this — a 20px column is a bug, not a
 * layout. It is also what decides whether a set of columns can fit at all. */
export const MIN_COLUMN_WIDTH = 72;
/** Nothing sensible is wider than this, and a runaway drag can't wreck a view. */
export const MAX_COLUMN_WIDTH = 720;

const WIDTH_BY_KIND: Record<ColumnKind, number> = {
  text: 140,
  phone: 130,
  email: 200,
  money: 115,
  number: 105,
  date: 120,
  bool: 105,
};

/** Where a column starts before anyone drags anything. */
export function defaultWidth(key: string): number {
  const def = BY_KEY.get(key);
  if (!def) return WIDTH_BY_KIND.text;
  return def.width ?? WIDTH_BY_KIND[def.kind];
}

export function defaultWidths(columns: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of columns) out[key] = defaultWidth(key);
  return out;
}

/**
 * Scale a set of column widths so the row fills EXACTLY the space available.
 *
 * This is the whole answer to the user's session-019 complaint ("remove the
 * horizontal scrollbar"): the rendered widths are always refitted to the
 * container, so stored widths behave as proportions rather than pixels. Drag a
 * column wider and its neighbour gives up the space; resize the browser and
 * every column rescales. A scrollbar appears only in the one case where it
 * has to — more columns ticked on than can fit at MIN_COLUMN_WIDTH each.
 *
 * Returns widths summing to `available` whenever that is achievable.
 */
export function fitColumnWidths(
  columns: string[],
  current: Record<string, number>,
  available: number,
  min: number = MIN_COLUMN_WIDTH,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (columns.length === 0) return out;

  const naturals = columns.map((key) => {
    const raw = Number(current[key]);
    const base = Number.isFinite(raw) && raw > 0 ? raw : defaultWidth(key);
    return Math.min(MAX_COLUMN_WIDTH, Math.max(min, Math.round(base)));
  });

  // No measurement yet (server render, or a hidden container) — hand back the
  // natural widths so the first paint is sane rather than collapsed.
  const fits = Number.isFinite(available) && available > 0 && columns.length * min <= available;
  if (!fits) {
    columns.forEach((key, i) => (out[key] = naturals[i]));
    return out;
  }

  const sum = naturals.reduce((a, b) => a + b, 0);
  const scale = available / sum;
  let used = 0;
  columns.forEach((key, i) => {
    const w = Math.max(min, Math.round(naturals[i] * scale));
    out[key] = w;
    used += w;
  });

  // Rounding (and any column that hit the floor) leaves a few pixels of drift.
  // Spend it from the right, skipping columns with no room to give.
  let drift = available - used;
  for (let i = columns.length - 1; i >= 0 && drift !== 0; i--) {
    const key = columns[i];
    const room = drift > 0 ? drift : Math.max(-(out[key] - min), drift);
    out[key] += room;
    drift -= room;
  }
  return out;
}

/** Serialize widths for localStorage / a saved view. Unknown keys are dropped. */
export function serializeWidths(widths: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(widths)) {
    if (!BY_KEY.has(key)) continue;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, n));
  }
  return out;
}

/** Read widths back — from localStorage, or a jsonb view someone hand-edited. */
export function parseWidths(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return serializeWidths(raw as Record<string, number>);
}

// ---------- filters ----------

export interface Filter {
  column: string;
  value: string;
}

/** Comparisons an operator can type in front of a filter value. Longest first
 * so ">=" is never read as ">". */
const NUMERIC_OPS = [">=", "<=", "!=", ">", "<", "="] as const;
export type NumericOp = (typeof NUMERIC_OPS)[number];

function splitOp(value: string): { op: NumericOp | ""; rest: string } {
  for (const op of NUMERIC_OPS) {
    if (value.startsWith(op)) return { op, rest: value.slice(op.length).trim() };
  }
  return { op: "", rest: value };
}

/** A bare ET calendar day, the only date shape a filter box accepts alongside
 * a full ISO timestamp. Anything else would reach Postgres as a cast error. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** "2026-08-01" -> "2026-08-02". Pure UTC arithmetic: the input is a calendar
 * day, not a moment, so no timezone can slide it. */
export function nextDay(day: string): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  return new Date(at + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * A filter the query can safely run.
 *
 * Returns null for anything unrecognised — an unknown column, an empty value,
 * a number filter that isn't a number, a date that isn't a date. The caller
 * drops nulls, so a bad filter narrows nothing rather than erroring or, worse,
 * being passed through to PostgREST as an unvalidated column name.
 *
 * The value KEEPS its comparison prefix (">=20", "<2026-01-01", "=yoder",
 * "!yoder"). filterClauses is what turns that into query operators, and the
 * filter box shows the operator back to the operator exactly as typed.
 */
export function parseFilter(raw: Partial<Filter>): Filter | null {
  const column = typeof raw.column === "string" ? raw.column : "";
  const def = BY_KEY.get(column);
  if (!def) return null;
  const value = typeof raw.value === "string" ? raw.value.trim().slice(0, 100) : "";
  if (!value) return null;

  if (def.kind === "bool") {
    const v = value.toLowerCase();
    if (v !== "yes" && v !== "no" && v !== "true" && v !== "false") return null;
    return { column, value: v === "yes" || v === "true" ? "true" : "false" };
  }

  if (def.kind === "number" || def.kind === "money") {
    const { op, rest } = splitOp(value);
    if (!/^-?\d+(\.\d+)?$/.test(rest)) return null;
    return { column, value: `${op}${rest}` };
  }

  if (def.kind === "date") {
    const { op, rest } = splitOp(value);
    if (!DAY_RE.test(rest) && !ISO_RE.test(rest)) return null;
    return { column, value: `${op}${rest}` };
  }

  // Text-ish. "=x" is an exact (case-insensitive) match, "!x" excludes, and a
  // bare value is the loose "contains" an operator typing four digits of a
  // phone number means.
  return { column, value };
}

export interface FilterClause {
  op: "ilike" | "nilike" | "eq" | "neq" | "gte" | "lte" | "gt" | "lt";
  value: string;
}

function compare(op: NumericOp | "", value: string): FilterClause[] {
  switch (op) {
    case "<=":
      return [{ op: "lte", value }];
    case ">":
      return [{ op: "gt", value }];
    case "<":
      return [{ op: "lt", value }];
    case "=":
      return [{ op: "eq", value }];
    case "!=":
      return [{ op: "neq", value }];
    default:
      // No operator typed means "at least" / "on or after" — the useful
      // question about a count, an amount or a date is nearly always that.
      return [{ op: "gte", value }];
  }
}

/**
 * How a filter is applied, given the column's kind — as a list of clauses,
 * because "on this day" against a timestamp column is two comparisons.
 *
 * Money is entered in DOLLARS and compared in CENTS — the operator types 20,
 * not 2000, because the column is labelled "Money spent" and shows dollars.
 * A filter box that silently wanted cents would be a trap.
 */
export function filterClauses(filter: Filter): FilterClause[] {
  const def = BY_KEY.get(filter.column);
  if (!def) return [];
  switch (def.kind) {
    case "text":
    case "phone":
    case "email": {
      const value = filter.value;
      if (value.startsWith("=")) {
        const rest = value.slice(1).trim();
        // ilike with no wildcards is an exact match that ignores case, which
        // is what someone typing "=" into a text box means.
        return rest ? [{ op: "ilike", value: rest }] : [];
      }
      if (value.startsWith("!")) {
        const rest = value.slice(1).trim();
        return rest ? [{ op: "nilike", value: `%${rest}%` }] : [];
      }
      return [{ op: "ilike", value: `%${value}%` }];
    }
    case "bool":
      return [{ op: "eq", value: filter.value }];
    case "money": {
      const { op, rest } = splitOp(filter.value);
      return compare(op, String(Math.round(Number(rest) * 100)));
    }
    case "number": {
      const { op, rest } = splitOp(filter.value);
      return compare(op, String(Math.floor(Number(rest))));
    }
    case "date": {
      const { op, rest } = splitOp(filter.value);
      // A bare calendar day against a timestamp column: "> the 1st" means
      // after the 1st ENDS, "on the 1st" is the whole day, and "on or before
      // the 1st" includes it. Comparing the raw day string would quietly mean
      // midnight and cut a day short.
      if (DAY_RE.test(rest)) {
        switch (op) {
          case ">":
            return [{ op: "gte", value: nextDay(rest) }];
          case "<=":
            return [{ op: "lt", value: nextDay(rest) }];
          case "<":
            return [{ op: "lt", value: rest }];
          case "=":
            return [
              { op: "gte", value: rest },
              { op: "lt", value: nextDay(rest) },
            ];
          case "!=":
            return [{ op: "neq", value: rest }];
          default:
            return [{ op: "gte", value: rest }];
        }
      }
      return compare(op, rest);
    }
    default:
      return [];
  }
}

/** What the filter box should say when it is empty, per column kind. */
export function filterHint(key: string): string {
  const def = BY_KEY.get(key);
  switch (def?.kind) {
    case "money":
      return "≥ $";
    case "number":
      return "≥";
    case "date":
      return "≥ YYYY-MM-DD";
    case "bool":
      return "yes / no";
    default:
      return "contains…";
  }
}

/** Where this operator's column widths live in their own browser. Shared so
 * the grid and the save-a-view form can never read different keys. */
export const WIDTH_STORAGE_KEY = "pe.userTable.widths.v1";

/** Rows per page an operator may choose. 250 is the ceiling on purpose: this
 * is one database view over live data and the page renders every row. */
export const PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;

export function parsePageSize(raw: unknown): number {
  const n = Number(raw);
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
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
  /** Column widths, in pixels at the width they were saved. Refitted to
   * whatever screen opens the view, so they behave as proportions. */
  widths?: Record<string, number>;
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
    widths: parseWidths(o.widths),
  };
}

// ---------- filters on the URL ----------

/**
 * Each filter rides its OWN query parameter, `f.<column>=<value>`.
 *
 * The old shape packed them into one comma-joined `f=` value, which meant a
 * filter value containing a comma silently split into two broken filters. One
 * parameter per column has no separator to collide with. `f=` is still READ,
 * so a bookmark or a link someone was handed keeps working.
 */
export const FILTER_PREFIX = "f.";

export function parseFilterParams(params: Record<string, string | undefined>): Filter[] {
  const filters: Filter[] = [];
  const push = (f: Filter | null) => {
    if (!f) return;
    const idx = filters.findIndex((x) => x.column === f.column);
    // Two filters on one column would just return nothing, which reads as a
    // broken table rather than a mistake. Last one wins.
    if (idx >= 0) filters[idx] = f;
    else filters.push(f);
  };

  // Legacy comma-joined form first, so a per-column parameter overrides it.
  for (const pair of (params.f ?? "").split(",")) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    push(parseFilter({ column: pair.slice(0, idx), value: pair.slice(idx + 1) }));
  }

  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(FILTER_PREFIX) || typeof value !== "string") continue;
    push(parseFilter({ column: key.slice(FILTER_PREFIX.length), value }));
  }
  return filters;
}

/** The query parameters that carry a filter set — the inverse of the above. */
export function filterParams(filters: Filter[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) out[`${FILTER_PREFIX}${f.column}`] = f.value;
  return out;
}
