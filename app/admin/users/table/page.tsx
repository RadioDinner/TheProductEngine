import type { Metadata } from "next";
import Link from "next/link";
import { queryUserRows, listSavedViews, type UserRow } from "@/lib/user-table-store";
import { adminSaveUserView, adminDeleteUserView } from "@/lib/admin-actions";
import { readSession } from "@/lib/session";
import {
  USER_COLUMNS,
  columnDef,
  parseFilter,
  parseSort,
  validColumns,
  type Filter,
} from "@/lib/user-table";
import { formatPhone } from "@/lib/phone";
import { formatPrice, site } from "@/lib/config";
import { lineTypeLabel, type LineType } from "@/lib/number-lookup";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `All members — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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

/** Rebuild the current URL with one thing changed — every control is a link,
 * so a filtered layout is shareable and survives a reload. */
function href(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/users/table${s ? `?${s}` : ""}`;
}

export default async function AdminUsersTable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const columns = validColumns(params.cols ? params.cols.split(",") : undefined);
  const sort = parseSort(params.sort, params.dir);
  const page = Math.max(0, Number(params.page) || 0);

  // Filters ride the URL as "column:value" pairs, so a filtered view can be
  // bookmarked or handed to someone else.
  const filters: Filter[] = (params.f ? params.f.split(",") : [])
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx < 0) return null;
      return parseFilter({ column: pair.slice(0, idx), value: pair.slice(idx + 1) });
    })
    .filter((f): f is Filter => f !== null);

  // The "add filter" form is a plain GET with its own two fields; fold it into
  // the list here so the form stays simple and the URL stays the one source of
  // truth. Adding a filter for a column already filtered REPLACES it — two
  // conflicting filters on one column would just return nothing, which reads
  // as a broken table rather than a mistake.
  const added = parseFilter({ column: params.fcol, value: params.fval });
  if (added) {
    const idx = filters.findIndex((f) => f.column === added.column);
    if (idx >= 0) filters[idx] = added;
    else filters.push(added);
  }

  const result = await queryUserRows({
    filters,
    sortColumn: sort.column,
    sortAscending: sort.ascending,
    page,
    pageSize: PAGE_SIZE,
  });

  const session = await readSession();
  const views = session ? await listSavedViews(session.phone) : [];

  const base = {
    cols: columns.join(","),
    sort: sort.column,
    dir: sort.ascending ? "asc" : "desc",
    f: filters.map((f) => `${f.column}:${f.value}`).join(","),
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

  const shown = result.rows.length;
  const start = page * PAGE_SIZE;

  return (
    <>
      <h1>
        All members <Tip k="users.table" />
      </h1>
      <p className="admin-nav">
        <Link href="/admin/users">Search &amp; member detail</Link>
      </p>

      <p className="fine">
        {result.total.toLocaleString()} member{result.total === 1 ? "" : "s"}
        {filters.length > 0 && " matching your filters"}
        {shown > 0 && ` · showing ${start + 1}–${start + shown}`}. Click a column heading
        to sort by it. Click a member&rsquo;s number to open their page.
      </p>

      {/* ---- saved views ---- */}
      {views.length > 0 && (
        <p className="admin-nav" aria-label="Saved views">
          Saved:{" "}
          {views.map((v) => (
            <Link
              key={v.id}
              href={href({
                cols: v.config.columns.join(","),
                sort: v.config.sortColumn,
                dir: v.config.sortAscending ? "asc" : "desc",
                f: v.config.filters.map((f) => `${f.column}:${f.value}`).join(","),
              })}
            >
              {v.name}
            </Link>
          ))}
        </p>
      )}

      <details>
        <summary className="fine">Columns, filters and saved views…</summary>

        <h3 className="subsection-h">Columns</h3>
        <p className="fine">
          Tick what you want to see. The order is fixed so the headings and the cells can
          never drift apart.
        </p>
        <form method="get" className="review-form">
          <input type="hidden" name="sort" value={base.sort} />
          <input type="hidden" name="dir" value={base.dir} />
          <input type="hidden" name="f" value={base.f} />
          <div className="col-picker">
            {USER_COLUMNS.map((c) => (
              <label key={c.key} className="sim-photo-toggle">
                <input
                  type="checkbox"
                  name="cols"
                  value={c.key}
                  defaultChecked={columns.includes(c.key)}
                />{" "}
                {c.label}
              </label>
            ))}
          </div>
          <button className="btn btn-sm" type="submit">
            Show these columns
          </button>
        </form>

        <h3 className="subsection-h">Filter</h3>
        <p className="fine">
          Text and numbers match loosely (part of a number, part of an email). Money and
          counts mean &ldquo;this much or more&rdquo;, dates mean &ldquo;on or
          after&rdquo;, and yes/no columns take <em>yes</em> or <em>no</em>. Money is in
          dollars, the way the column reads.
        </p>
        <form method="get" className="review-form">
          <input type="hidden" name="cols" value={base.cols} />
          <input type="hidden" name="sort" value={base.sort} />
          <input type="hidden" name="dir" value={base.dir} />
          <div className="inline-fields">
            <select name="fcol" aria-label="Column to filter">
              {USER_COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <input name="fval" type="text" placeholder="is / at least…" />
            <button className="btn btn-sm" type="submit">
              Add filter
            </button>
          </div>
        </form>
        {filters.length > 0 && (
          <p className="fine">
            Filtering:{" "}
            {filters.map((f) => (
              <span key={`${f.column}:${f.value}`}>
                {columnDef(f.column)?.label} = {f.value}{" "}
                <Link
                  href={href({
                    ...base,
                    f: filters
                      .filter((x) => x.column !== f.column || x.value !== f.value)
                      .map((x) => `${x.column}:${x.value}`)
                      .join(","),
                  })}
                >
                  (remove)
                </Link>{" "}
              </span>
            ))}
          </p>
        )}

        <h3 className="subsection-h">Save this view</h3>
        <p className="fine">
          Saves the columns, filters and sort you have now, under a name, for you only.
          Saving over a name you already used replaces it.
        </p>
        <form action={adminSaveUserView} className="review-form">
          <input type="hidden" name="cols" value={base.cols} />
          <input type="hidden" name="sort" value={base.sort} />
          <input type="hidden" name="dir" value={base.dir} />
          <input type="hidden" name="f" value={base.f} />
          <div className="inline-fields">
            <input name="name" type="text" placeholder="Name this view…" required />
            <button className="btn btn-sm" type="submit">
              Save view
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

      {/* ---- the table ---- */}
      {result.rows.length === 0 ? (
        <p className="status-muted">No members match.</p>
      ) : (
        <div className="table-scroll" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((key) => {
                  const def = columnDef(key)!;
                  const isSort = sort.column === key;
                  return (
                    <th key={key} aria-sort={isSort ? (sort.ascending ? "ascending" : "descending") : undefined}>
                      <Link
                        href={href({
                          ...base,
                          sort: key,
                          // Clicking the current sort column flips it.
                          dir: isSort && !sort.ascending ? "asc" : "desc",
                        })}
                      >
                        {def.label}
                        {isSort ? (sort.ascending ? " ▲" : " ▼") : ""}
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.user_id}>
                  {columns.map((key) => (
                    <td key={key}>
                      {key === "phone" && row.phone ? (
                        <Link href={`/admin/users?phone=${row.phone}`}>
                          {formatPhone(row.phone)}
                        </Link>
                      ) : (
                        cell(row, key)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.total > PAGE_SIZE && (
        <p className="admin-nav">
          {page > 0 && <Link href={href({ ...base, page: String(page - 1) })}>← Previous</Link>}
          {start + shown < result.total && (
            <Link href={href({ ...base, page: String(page + 1) })}>Next →</Link>
          )}
        </p>
      )}
    </>
  );
}
