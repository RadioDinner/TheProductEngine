// The members table's column catalogue and query shaping (feature 41).
//
// This is a SECURITY boundary as much as a display one: sorting and filtering
// happen in the database, so a key that survives these functions is passed to
// PostgREST as a real column name. Anything unrecognised has to die here.
import {
  USER_COLUMNS,
  columnDef,
  defaultColumns,
  filterPlan,
  normalizeView,
  parseFilter,
  parseSort,
  validColumns,
} from "../lib/user-table.ts";

export const name = "user-table";

export function run(t) {
  // ---- the catalogue ----
  t.eq("every column has a key, label and kind",
    USER_COLUMNS.every((c) => c.key && c.label && c.kind), true);
  const keys = USER_COLUMNS.map((c) => c.key);
  t.eq("keys are unique", new Set(keys).size, keys.length);
  t.eq("some columns are standard", defaultColumns().length > 0, true);
  t.eq("standard columns are real columns",
    defaultColumns().every((k) => columnDef(k) !== undefined), true);
  // The two an operator will always want.
  t.eq("phone is standard", defaultColumns().includes("phone"), true);
  t.eq("money spent is standard", defaultColumns().includes("spent_cents"), true);

  // ---- validColumns: what reaches the query ----
  t.eq("known columns pass", validColumns(["phone", "email"]).join(","), "phone,email");
  t.eq("unknown columns are dropped",
    validColumns(["phone", "; drop table users"]).join(","), "phone");
  // Order comes from the catalogue, not the request, so headings and cells
  // can never disagree and an old saved view still renders sensibly.
  t.eq("order follows the catalogue, not the input",
    validColumns(["email", "phone"]).join(","), "phone,email");
  t.eq("duplicates collapse", validColumns(["phone", "phone"]).join(","), "phone");
  // A table with no columns looks broken, so these fall back rather than
  // rendering nothing.
  t.eq("an empty list falls back", validColumns([]).join(","), defaultColumns().join(","));
  t.eq("all-unknown falls back", validColumns(["nope"]).join(","), defaultColumns().join(","));
  t.eq("a non-array falls back", validColumns("phone").join(","), defaultColumns().join(","));
  t.eq("undefined falls back", validColumns(undefined).join(","), defaultColumns().join(","));

  // ---- parseFilter: the other thing that reaches the query ----
  t.eq("a text filter parses", parseFilter({ column: "email", value: "yoder" }).value, "yoder");
  t.eq("an unknown column is refused", parseFilter({ column: "secret", value: "x" }), null);
  t.eq("an empty value is refused", parseFilter({ column: "email", value: "" }), null);
  t.eq("whitespace is refused", parseFilter({ column: "email", value: "   " }), null);
  t.eq("a non-string column is refused", parseFilter({ column: 5, value: "x" }), null);
  // Numbers must actually be numbers — a text value on a numeric column would
  // reach the database as a comparison it can't make.
  t.eq("a non-numeric number filter is refused", parseFilter({ column: "ads_posted", value: "lots" }), null);
  t.eq("a numeric filter passes", parseFilter({ column: "ads_posted", value: "3" }).value, "3");
  t.eq("a decimal money filter passes", parseFilter({ column: "spent_cents", value: "19.99" }).value, "19.99");
  t.eq("a negative number is allowed", parseFilter({ column: "balance_cents", value: "-5" }).value, "-5");
  // Booleans are normalised so the query always sends the same two strings.
  t.eq("'yes' becomes true", parseFilter({ column: "blocked", value: "yes" }).value, "true");
  t.eq("'NO' becomes false", parseFilter({ column: "blocked", value: "NO" }).value, "false");
  t.eq("'true' stays true", parseFilter({ column: "blocked", value: "true" }).value, "true");
  t.eq("junk on a bool column is refused", parseFilter({ column: "blocked", value: "maybe" }), null);
  // Long values are clipped rather than passed through.
  t.eq("a long value is clipped", parseFilter({ column: "email", value: "z".repeat(500) }).value.length, 100);

  // ---- filterPlan: how each kind is matched ----
  t.eq("text matches loosely",
    JSON.stringify(filterPlan({ column: "email", value: "yoder" })),
    '{"op":"ilike","value":"%yoder%"}');
  t.eq("phone matches loosely",
    filterPlan({ column: "phone", value: "5551" }).value, "%5551%");
  t.eq("a bool matches exactly", filterPlan({ column: "blocked", value: "true" }).op, "eq");
  // Money is typed in DOLLARS and compared in CENTS. A box that silently
  // wanted cents would be a trap — the column is labelled in dollars.
  t.eq("money converts dollars to cents",
    filterPlan({ column: "spent_cents", value: "20" }).value, "2000");
  t.eq("money rounds cleanly",
    filterPlan({ column: "spent_cents", value: "19.99" }).value, "1999");
  t.eq("money means at-least", filterPlan({ column: "spent_cents", value: "20" }).op, "gte");
  t.eq("counts mean at-least", filterPlan({ column: "ads_posted", value: "3" }).op, "gte");
  t.eq("counts floor a decimal", filterPlan({ column: "ads_posted", value: "3.7" }).value, "3");
  t.eq("dates mean on-or-after", filterPlan({ column: "member_since", value: "2026-08-01" }).op, "gte");
  t.eq("an unknown column has no plan", filterPlan({ column: "nope", value: "x" }), null);

  // ---- parseSort ----
  t.eq("a known sort column passes", parseSort("spent_cents", "asc").column, "spent_cents");
  t.eq("ascending is honoured", parseSort("spent_cents", "asc").ascending, true);
  t.eq("anything else is descending", parseSort("spent_cents", "whatever").ascending, false);
  // An unknown sort column must fall back, never reach the query.
  t.eq("an unknown sort column falls back", parseSort("; drop", "asc").column, "last_active_at");
  t.eq("a missing sort column falls back", parseSort(undefined, undefined).column, "last_active_at");

  // ---- normalizeView: what comes back out of the database ----
  const v = normalizeView({
    columns: ["phone", "bogus", "email"],
    filters: [{ column: "email", value: "yoder" }, { column: "bogus", value: "x" }],
    sortColumn: "ads_posted",
    sortAscending: true,
  });
  t.eq("stored columns are re-validated", v.columns.join(","), "phone,email");
  t.eq("stored filters are re-validated", v.filters.length, 1);
  t.eq("stored sort survives", v.sortColumn, "ads_posted");
  t.eq("stored direction survives", v.sortAscending, true);
  // A saved view is read back and turned into a query, so garbage in it must
  // not become a query — including a view hand-edited in the database.
  const empty = normalizeView(null);
  t.eq("a null view still renders", empty.columns.length > 0, true);
  t.eq("a null view has no filters", empty.filters.length, 0);
  t.eq("a junk view falls back", normalizeView({ columns: "nope", filters: "nope" }).filters.length, 0);
}
