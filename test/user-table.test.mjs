// The members table's column catalogue and query shaping (feature 41; the
// database-viewer rebuild is session 019).
//
// This is a SECURITY boundary as much as a display one: sorting and filtering
// happen in the database, so a key that survives these functions is passed to
// PostgREST as a real column name. Anything unrecognised has to die here.
import {
  DEFAULT_PAGE_SIZE,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  PAGE_SIZES,
  USER_COLUMNS,
  columnDef,
  defaultColumns,
  defaultWidth,
  defaultWidths,
  filterClauses,
  filterParams,
  fitColumnWidths,
  nextDay,
  normalizeView,
  parseFilter,
  parseFilterParams,
  parsePageSize,
  parseSort,
  parseWidths,
  serializeWidths,
  validColumns,
} from "../lib/user-table.ts";

export const name = "user-table";

const json = (v) => JSON.stringify(v);

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
  // Order follows the REQUEST since session 019 — that is how a dragged column
  // order travels. The header row and the cells still can't disagree: one
  // array drives both.
  t.eq("order follows the request, not the catalogue",
    validColumns(["email", "phone"]).join(","), "email,phone");
  t.eq("duplicates collapse, keeping the first position",
    validColumns(["email", "phone", "email"]).join(","), "email,phone");
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
  // Comparison prefixes (session 019) survive parsing so the box can show back
  // exactly what was typed.
  t.eq("a >= prefix survives", parseFilter({ column: "spent_cents", value: ">=20" }).value, ">=20");
  t.eq("a < prefix survives", parseFilter({ column: "ads_posted", value: "< 3" }).value, "<3");
  t.eq("a prefix with junk behind it is refused",
    parseFilter({ column: "ads_posted", value: ">=lots" }), null);
  // Dates are validated now: an unparseable one used to reach Postgres as a
  // cast error, which 500s the whole page.
  t.eq("a calendar day passes", parseFilter({ column: "member_since", value: "2026-08-01" }).value, "2026-08-01");
  t.eq("an ISO timestamp passes",
    parseFilter({ column: "member_since", value: "2026-08-01T12:00:00Z" }).value,
    "2026-08-01T12:00:00Z");
  t.eq("a junk date is refused", parseFilter({ column: "member_since", value: "last tuesday" }), null);
  t.eq("a date with a prefix passes",
    parseFilter({ column: "member_since", value: "<=2026-08-01" }).value, "<=2026-08-01");
  // Booleans are normalised so the query always sends the same two strings.
  t.eq("'yes' becomes true", parseFilter({ column: "blocked", value: "yes" }).value, "true");
  t.eq("'NO' becomes false", parseFilter({ column: "blocked", value: "NO" }).value, "false");
  t.eq("'true' stays true", parseFilter({ column: "blocked", value: "true" }).value, "true");
  t.eq("junk on a bool column is refused", parseFilter({ column: "blocked", value: "maybe" }), null);
  // Long values are clipped rather than passed through.
  t.eq("a long value is clipped", parseFilter({ column: "email", value: "z".repeat(500) }).value.length, 100);

  // ---- filterClauses: how each kind is matched ----
  t.eq("text matches loosely",
    json(filterClauses({ column: "email", value: "yoder" })),
    '[{"op":"ilike","value":"%yoder%"}]');
  t.eq("phone matches loosely",
    filterClauses({ column: "phone", value: "5551" })[0].value, "%5551%");
  t.eq("=exact drops the wildcards",
    json(filterClauses({ column: "email", value: "=a@b.com" })),
    '[{"op":"ilike","value":"a@b.com"}]');
  t.eq("!not excludes", filterClauses({ column: "email", value: "!yoder" })[0].op, "nilike");
  t.eq("a bool matches exactly", filterClauses({ column: "blocked", value: "true" })[0].op, "eq");
  // Money is typed in DOLLARS and compared in CENTS. A box that silently
  // wanted cents would be a trap — the column is labelled in dollars.
  t.eq("money converts dollars to cents",
    filterClauses({ column: "spent_cents", value: "20" })[0].value, "2000");
  t.eq("money rounds cleanly",
    filterClauses({ column: "spent_cents", value: "19.99" })[0].value, "1999");
  t.eq("money means at-least by default",
    filterClauses({ column: "spent_cents", value: "20" })[0].op, "gte");
  t.eq("money honours <=", filterClauses({ column: "spent_cents", value: "<=20" })[0].op, "lte");
  t.eq("money honours a converted <=",
    filterClauses({ column: "spent_cents", value: "<=20" })[0].value, "2000");
  t.eq("counts mean at-least", filterClauses({ column: "ads_posted", value: "3" })[0].op, "gte");
  t.eq("counts floor a decimal", filterClauses({ column: "ads_posted", value: "3.7" })[0].value, "3");
  t.eq("counts honour >", filterClauses({ column: "ads_posted", value: ">3" })[0].op, "gt");
  t.eq("an unknown column has no clauses", filterClauses({ column: "nope", value: "x" }).length, 0);

  // Dates against a TIMESTAMP column: a bare day is a whole day, not midnight.
  t.eq("dates mean on-or-after", filterClauses({ column: "member_since", value: "2026-08-01" })[0].op, "gte");
  t.eq("'on this day' is a range",
    json(filterClauses({ column: "member_since", value: "=2026-08-01" })),
    '[{"op":"gte","value":"2026-08-01"},{"op":"lt","value":"2026-08-02"}]');
  t.eq("'on or before' includes the whole day",
    json(filterClauses({ column: "member_since", value: "<=2026-08-01" })),
    '[{"op":"lt","value":"2026-08-02"}]');
  t.eq("'after' starts the next day",
    json(filterClauses({ column: "member_since", value: ">2026-08-01" })),
    '[{"op":"gte","value":"2026-08-02"}]');
  t.eq("'before' cuts at the day itself",
    json(filterClauses({ column: "member_since", value: "<2026-08-01" })),
    '[{"op":"lt","value":"2026-08-01"}]');
  t.eq("a month rolls over", nextDay("2026-08-31"), "2026-09-01");
  t.eq("a leap day rolls over", nextDay("2028-02-28"), "2028-02-29");
  t.eq("a year rolls over", nextDay("2026-12-31"), "2027-01-01");

  // ---- parseSort ----
  t.eq("a known sort column passes", parseSort("spent_cents", "asc").column, "spent_cents");
  t.eq("ascending is honoured", parseSort("spent_cents", "asc").ascending, true);
  t.eq("anything else is descending", parseSort("spent_cents", "whatever").ascending, false);
  // An unknown sort column must fall back, never reach the query.
  t.eq("an unknown sort column falls back", parseSort("; drop", "asc").column, "last_active_at");
  t.eq("a missing sort column falls back", parseSort(undefined, undefined).column, "last_active_at");

  // ---- filters on the URL (session 019: one parameter per column) ----
  t.eq("a per-column parameter parses",
    json(parseFilterParams({ "f.email": "yoder" })),
    '[{"column":"email","value":"yoder"}]');
  t.eq("an unknown per-column parameter is dropped",
    parseFilterParams({ "f.secret": "x" }).length, 0);
  t.eq("a non-filter parameter is ignored",
    parseFilterParams({ cols: "phone,email", sort: "phone" }).length, 0);
  // A comma in a value used to split one filter into two broken ones.
  t.eq("a comma in a value survives",
    parseFilterParams({ "f.email": "smith, john" })[0].value, "smith, john");
  // The old comma-joined form still reads, so a bookmark keeps working.
  t.eq("the legacy f= form still parses",
    json(parseFilterParams({ f: "email:yoder" })),
    '[{"column":"email","value":"yoder"}]');
  t.eq("a per-column parameter beats the legacy one",
    parseFilterParams({ f: "email:old", "f.email": "new" })[0].value, "new");
  t.eq("round-tripping a filter set is lossless",
    json(parseFilterParams(filterParams([{ column: "email", value: "yoder" }]))),
    '[{"column":"email","value":"yoder"}]');

  // ---- page size ----
  t.eq("a known page size passes", parsePageSize("100"), 100);
  t.eq("an unknown page size falls back", parsePageSize("9999"), DEFAULT_PAGE_SIZE);
  t.eq("junk falls back", parsePageSize("all"), DEFAULT_PAGE_SIZE);
  t.eq("the default is one of the offered sizes", PAGE_SIZES.includes(DEFAULT_PAGE_SIZE), true);

  // ---- widths: the answer to "remove the horizontal scrollbar" ----
  t.eq("every column has a starting width",
    USER_COLUMNS.every((c) => defaultWidth(c.key) >= MIN_COLUMN_WIDTH), true);
  t.eq("an unknown column still gets a width", defaultWidth("nope") > 0, true);

  const three = ["phone", "email", "ads_posted"];
  const fitted = fitColumnWidths(three, defaultWidths(three), 900);
  t.eq("a fitted row fills the space EXACTLY",
    three.reduce((n, k) => n + fitted[k], 0), 900);
  t.eq("fitting keeps the proportions in order",
    fitted.email > fitted.phone && fitted.phone > fitted.ads_posted, true);
  // Idempotence matters: the grid refits on every resize, and a drifting
  // width would creep a pixel per refit until something overflowed.
  const again = fitColumnWidths(three, fitted, 900);
  t.eq("refitting an already-fitted row changes nothing", json(again), json(fitted));

  const wide = fitColumnWidths(three, defaultWidths(three), 3000);
  t.eq("a wide screen still fills exactly",
    three.reduce((n, k) => n + wide[k], 0), 3000);
  const narrow = fitColumnWidths(three, defaultWidths(three), 400);
  t.eq("a narrow screen still fills exactly",
    three.reduce((n, k) => n + narrow[k], 0), 400);
  t.eq("nothing is squeezed below the minimum",
    three.every((k) => narrow[k] >= MIN_COLUMN_WIDTH), true);

  // The one honest scroll: more columns than can fit at their minimum.
  const all = USER_COLUMNS.map((c) => c.key);
  const crammed = fitColumnWidths(all, defaultWidths(all), 600);
  t.eq("too many columns keeps them readable instead of fitting",
    all.every((k) => crammed[k] >= MIN_COLUMN_WIDTH), true);
  t.eq("too many columns overflows on purpose",
    all.reduce((n, k) => n + crammed[k], 0) > 600, true);

  // No measurement yet (the server render) hands back natural widths.
  t.eq("an unmeasured container uses natural widths",
    json(fitColumnWidths(three, defaultWidths(three), 0)), json(defaultWidths(three)));
  t.eq("no columns is not a crash", json(fitColumnWidths([], {}, 900)), "{}");

  // ---- widths in and out of storage ----
  t.eq("unknown keys are dropped", json(serializeWidths({ phone: 120, nope: 300 })), '{"phone":120}');
  t.eq("a silly width is clamped up", serializeWidths({ phone: 4 }).phone, MIN_COLUMN_WIDTH);
  t.eq("a runaway width is clamped down", serializeWidths({ phone: 99999 }).phone, MAX_COLUMN_WIDTH);
  t.eq("junk widths are dropped", json(serializeWidths({ phone: "wide" })), "{}");
  t.eq("parseWidths refuses a non-object", json(parseWidths("phone:120")), "{}");
  t.eq("parseWidths refuses an array", json(parseWidths([120])), "{}");
  t.eq("parseWidths refuses null", json(parseWidths(null)), "{}");

  // ---- normalizeView: what comes back out of the database ----
  const v = normalizeView({
    columns: ["phone", "bogus", "email"],
    filters: [{ column: "email", value: "yoder" }, { column: "bogus", value: "x" }],
    sortColumn: "ads_posted",
    sortAscending: true,
    widths: { phone: 140, bogus: 200 },
  });
  t.eq("stored columns are re-validated", v.columns.join(","), "phone,email");
  t.eq("stored filters are re-validated", v.filters.length, 1);
  t.eq("stored sort survives", v.sortColumn, "ads_posted");
  t.eq("stored direction survives", v.sortAscending, true);
  t.eq("stored widths are re-validated", json(v.widths), '{"phone":140}');
  // A saved view is read back and turned into a query, so garbage in it must
  // not become a query — including a view hand-edited in the database.
  const empty = normalizeView(null);
  t.eq("a null view still renders", empty.columns.length > 0, true);
  t.eq("a null view has no filters", empty.filters.length, 0);
  t.eq("a junk view falls back", normalizeView({ columns: "nope", filters: "nope" }).filters.length, 0);
  t.eq("a junk view has no widths", json(normalizeView({ widths: "wide" }).widths), "{}");
}
