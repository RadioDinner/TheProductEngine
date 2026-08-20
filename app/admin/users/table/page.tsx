import type { Metadata } from "next";
import Link from "next/link";
import { queryUserRows, listSavedViews, type UserRow } from "@/lib/user-table-store";
import { adminSaveUserView, adminDeleteUserView } from "@/lib/admin-actions";
import { readSession } from "@/lib/session";
import {
  DEFAULT_PAGE_SIZE,
  columnDef,
  filterParams,
  parseFilterParams,
  parsePageSize,
  parseSort,
  validColumns,
} from "@/lib/user-table";
import { formatPhone } from "@/lib/phone";
import { formatPrice, site } from "@/lib/config";
import { lineTypeLabel, type LineType } from "@/lib/number-lookup";
import { Tip } from "@/components/Tip";
import { SavedLayoutWidths, UserGrid, type GridRow } from "@/components/UserGrid";

export const metadata: Metadata = {
  title: `All members — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const BASE = "/admin/users/table";

/** One formatter, on the server. The grid renders strings — it never has to
 * know that money is stored in cents or that a line type has a friendly name,
 * and there is no second copy of this to drift. */
function cell(row: UserRow, key: string): string {
  const def = columnDef(key);
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === "") return "—";
  switch (def?.kind) {
    case "phone":
      return formatPhone(String(value));
    case "money":
      return formatPrice(Number(value));
    case "bool":
      return value ? "yes" : "no";
    case "date":
      return new Date(String(value)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
        timeZone: "America/New_York",
      });
    case "number":
      return Number(value).toLocaleString();
    default:
      return key === "line_type" ? lineTypeLabel(String(value) as LineType) : String(value);
  }
}

export default async function AdminUsersTable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const session = await readSession();
  const views = session ? await listSavedViews(session.phone) : [];
  // Opening a saved view carries its id, which is the only way the widths it
  // stored can reach the grid — everything else about a layout rides the URL.
  const opened = params.view ? views.find((v) => String(v.id) === params.view) : undefined;

  const columns = validColumns(params.cols ? params.cols.split(",") : undefined);
  const sort = parseSort(params.sort, params.dir);
  const page = Math.max(0, Number(params.page) || 0);
  const pageSize = parsePageSize(params.size);
  const filters = parseFilterParams(params);

  const result = await queryUserRows({
    filters,
    sortColumn: sort.column,
    sortAscending: sort.ascending,
    page,
    pageSize,
  });

  const base = {
    cols: columns.join(","),
    sort: sort.column,
    dir: sort.ascending ? "asc" : "desc",
    // JSON, not the old comma-joined "col:value" — a filter value with a comma
    // in it used to split into two broken filters on the way into a saved view.
    filters: JSON.stringify(filters),
  };

  if (result === "unsupported") {
    return (
      <>
        <h1>All members</h1>
        <p className="notice" role="status">
          The members table isn&rsquo;t available yet — paste migration{" "}
          <strong>9962</strong> in the Supabase SQL editor. (It doesn&rsquo;t run in
          development: the table is one database view over live data, and the dev fixture
          store has no equivalent.)
        </p>
        <p>
          <Link href="/admin/users">Back to Users</Link>
        </p>
      </>
    );
  }

  const rows: GridRow[] = result.rows.map((row) => ({
    id: row.user_id,
    cells: Object.fromEntries(
      columns.map((key) => [
        key,
        key === "phone" && row.phone
          ? { t: formatPhone(row.phone), h: `/admin/users?phone=${row.phone}` }
          : { t: cell(row, key) },
      ]),
    ),
  }));

  const filterValues = Object.fromEntries(filters.map((f) => [f.column, f.value]));

  return (
    <div className="admin-wide">
      <h1>
        All members <Tip k="users.table" />
      </h1>
      <p className="admin-nav">
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/users">Search &amp; member detail</Link>
      </p>

      <p className="fine">
        Drag a heading&rsquo;s <span aria-hidden="true">⠿</span> handle to move a column,
        drag the line between two headings to resize, type under a heading to filter,
        click a heading to sort. A member&rsquo;s number opens their page.{" "}
        <a href="#grid-help">What the filter boxes take</a>.
      </p>

      {views.length > 0 && (
        <p className="admin-nav" aria-label="Saved views">
          Saved:{" "}
          {views.map((v) => {
            const qs = new URLSearchParams({
              view: String(v.id),
              cols: v.config.columns.join(","),
              sort: v.config.sortColumn,
              dir: v.config.sortAscending ? "asc" : "desc",
              ...filterParams(v.config.filters),
            });
            return (
              <Link key={v.id} href={`${BASE}?${qs.toString()}`}>
                {v.name}
              </Link>
            );
          })}
        </p>
      )}

      <UserGrid
        rows={rows}
        columns={columns}
        sortColumn={sort.column}
        sortAscending={sort.ascending}
        filters={filterValues}
        total={result.total}
        page={page}
        pageSize={pageSize}
        basePath={BASE}
        savedWidths={opened?.config.widths}
        viewKey={opened ? String(opened.id) : ""}
      />

      <details className="ug-views" id="grid-help">
        <summary className="fine">What the filter boxes take…</summary>
        <p className="fine">
          Text columns take <strong>part of a word</strong>, <strong>=exact</strong>, or{" "}
          <strong>!not</strong> — so <code>yoder</code>, <code>=a@b.com</code>,{" "}
          <code>!gmail</code>. Numbers, money and dates mean &ldquo;this much or
          more&rdquo; on their own and accept <strong>&gt;=</strong> <strong>&lt;=</strong>{" "}
          <strong>&gt;</strong> <strong>&lt;</strong> <strong>=</strong> in front —{" "}
          <code>&gt;=100</code>, <code>&lt;=2026-08-01</code>, <code>=2026-08-01</code> for
          one whole day. Money is in dollars, the way the column reads. Yes/no columns take{" "}
          <em>yes</em> or <em>no</em>. A box turns red when the column can&rsquo;t filter
          on what you typed, rather than dropping it quietly.
        </p>
      </details>

      <details className="ug-views">
        <summary className="fine">Saved layouts…</summary>
        <p className="fine">
          Saves the columns, their order and widths, the filters and the sort you have
          now, under a name, for you only. Saving over a name you already used replaces
          it.
        </p>
        <form action={adminSaveUserView} className="review-form">
          <input type="hidden" name="cols" value={base.cols} />
          <input type="hidden" name="sort" value={base.sort} />
          <input type="hidden" name="dir" value={base.dir} />
          <input type="hidden" name="filters" value={base.filters} />
          <SavedLayoutWidths />
          <div className="inline-fields">
            <input name="name" type="text" placeholder="Name this layout…" required />
            <button className="btn btn-sm" type="submit">
              Save layout
            </button>
          </div>
        </form>
        {views.length > 0 && (
          <ul className="myads">
            {views.map((v) => (
              <li key={v.id} className="myad-row">
                <div className="sim-actions">
                  <span className="pack-name">{v.name}</span>
                  <span className="status-muted">
                    {v.config.columns.length} columns
                    {v.config.filters.length > 0 && `, ${v.config.filters.length} filters`}
                  </span>
                  <form action={adminDeleteUserView} className="inline-form">
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="cols" value={base.cols} />
                    <button className="btn btn-sm btn-secondary" type="submit">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>

      {pageSize === DEFAULT_PAGE_SIZE && result.total > 1000 && (
        <p className="fine status-muted">
          {result.total.toLocaleString()} members — filtering narrows the query in the
          database, so it stays quick however long the list gets.
        </p>
      )}
    </div>
  );
}
