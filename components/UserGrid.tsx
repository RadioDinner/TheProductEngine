"use client";

/**
 * The members grid (/admin/users/table) — session 019.
 *
 * The user's ask: "remove the horizontal scrollbar … I want it more TABLE
 * looking. Like a pervasive database viewer table or excel, I want to be able
 * to drag and drop columns, resize them, filter by columns, sort by columns."
 *
 * How each of those is met, and why this way:
 *
 * - NO HORIZONTAL SCROLLBAR. The rendered column widths are always refitted to
 *   the width the grid actually has (lib/user-table.ts, fitColumnWidths), so
 *   stored widths behave as PROPORTIONS, not pixels. Dragging a column wider
 *   takes the space from its neighbour rather than from the page, so the total
 *   never changes. The one case that still scrolls is more columns ticked on
 *   than can fit at MIN_COLUMN_WIDTH each — untick some, and the page says so.
 *   Long values are clipped with an ellipsis and carry the full text as a
 *   tooltip, which is what makes a fixed-width grid readable at all.
 *
 * - FILTER AND SORT STAY IN THE DATABASE. The filter row and the heading
 *   clicks push the URL and the server re-queries. Doing either in the browser
 *   would only filter the 50 rows on screen, which is worse than useless — it
 *   looks right and is wrong. It also means a filtered layout is still a
 *   shareable link, which is how this page has always worked.
 *
 * - DRAG AND RESIZE ARE LOCAL. Column ORDER rides the URL (`cols`), so it
 *   survives a reload and rides a saved view; widths live in this operator's
 *   browser (and in a saved view when they save one), because they are a
 *   comfort setting, not a query.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DEFAULT_PAGE_SIZE,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  PAGE_SIZES,
  USER_COLUMNS,
  WIDTH_STORAGE_KEY,
  columnDef,
  defaultColumns,
  defaultWidths,
  filterHint,
  fitColumnWidths,
  parseFilter,
  parseWidths,
  serializeWidths,
  type ColumnKind,
} from "@/lib/user-table";

export interface GridCell {
  /** Already formatted by the server — one formatter, not two. */
  t: string;
  /** Where the cell links, if it links (the member's number does). */
  h?: string;
}

export interface GridRow {
  id: string;
  cells: Record<string, GridCell>;
}

export interface UserGridProps {
  rows: GridRow[];
  columns: string[];
  sortColumn: string;
  sortAscending: boolean;
  /** column key -> the raw filter value, exactly as it will be shown back. */
  filters: Record<string, string>;
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  /** Widths carried by a saved view the operator just opened, and the id of
   * that view. The id is what makes "apply these widths" happen ONCE, on the
   * load that opened the view — re-applying them on every later navigation
   * would quietly undo any column the operator dragged afterwards. */
  savedWidths?: Record<string, number>;
  viewKey?: string;
}

/** The row-number gutter, in pixels. Fixed, and outside the fit arithmetic. */
const GUTTER = 54;

/** Numbers, money and dates read better right-aligned — the same reason a
 * ledger column is right-aligned on paper. */
function alignRight(kind: ColumnKind | undefined): boolean {
  return kind === "money" || kind === "number" || kind === "date";
}

function readStoredWidths(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    return raw ? parseWidths(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Carries the operator's current column widths into the save-a-view form.
 *
 * The form itself is a plain server-action form on the page — it already
 * knows the columns, sort and filters, because all three ride the URL. Widths
 * are the one part of a layout that never touches the server, so this reads
 * them straight back out of the same browser store the grid writes.
 */
export function SavedLayoutWidths() {
  const [value, setValue] = useState("");
  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(WIDTH_STORAGE_KEY) ?? "");
    } catch {
      /* no store, no widths — the view just opens at the default sizes */
    }
  }, []);
  return <input type="hidden" name="widths" value={value} readOnly />;
}

export function UserGrid(props: UserGridProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [order, setOrder] = useState<string[]>(props.columns);
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    defaultWidths(props.columns),
  );
  const [available, setAvailable] = useState(0);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(props.filters);
  const [rejected, setRejected] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState(false);

  // A navigation finished: adopt whatever the server just rendered. This is
  // what makes the Back button, a saved view and a bookmarked link all land
  // on the right columns and the right filter boxes.
  useEffect(() => setOrder(props.columns), [props.columns]);
  useEffect(() => setDrafts(props.filters), [props.filters]);

  // ---- measuring ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // clientWidth EXCLUDES the vertical scrollbar, which is the whole trick:
    // measuring the border box instead would leave the grid ~15px too wide
    // and put back the horizontal scrollbar we are here to remove.
    const measure = () => setAvailable(Math.max(0, el.clientWidth - GUTTER));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const persist = useCallback((next: Record<string, number>) => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(serializeWidths(next)));
    } catch {
      /* a full or blocked localStorage is not worth breaking the page over */
    }
  }, []);

  // ---- widths: stored proportions, refitted to the space we have ----
  const savedWidths = props.savedWidths;
  const viewKey = props.viewKey ?? "";
  useEffect(() => {
    // A saved view's widths win on the load that opened it; otherwise this
    // browser's own last layout. Keyed on the VIEW ID, not the object, so it
    // happens once per opened view rather than on every re-render.
    const stored = { ...readStoredWidths(), ...(viewKey ? (savedWidths ?? {}) : {}) };
    if (Object.keys(stored).length) setWidths((current) => ({ ...current, ...stored }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useEffect(() => {
    setWidths((current) => {
      const next = fitColumnWidths(order, current, available);
      // fitColumnWidths is idempotent once fitted, so this settles in one
      // pass — but bail explicitly rather than trusting that.
      const same = order.every((k) => next[k] === current[k]);
      if (same) return current;
      // Remember the layout as soon as it settles, not only when something is
      // dragged: saving a view reads this back, and an operator who never
      // touches a divider still deserves their column set remembered.
      if (available > 0) persist(next);
      return { ...current, ...next };
    });
  }, [order, available, persist]);

  // ---- navigation ----
  const go = useCallback(
    (changes: Record<string, string | null>, nextOrder?: string[]) => {
      const params = new URLSearchParams();
      params.set("cols", (nextOrder ?? order).join(","));
      params.set("sort", props.sortColumn);
      params.set("dir", props.sortAscending ? "asc" : "desc");
      if (props.page > 0) params.set("page", String(props.page));
      if (props.pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(props.pageSize));
      for (const [key, value] of Object.entries(props.filters)) {
        params.set(`f.${key}`, value);
      }
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      router.push(`${props.basePath}?${params.toString()}`);
    },
    [order, props, router],
  );

  const sortBy = useCallback(
    (key: string) => {
      const flip = props.sortColumn === key && !props.sortAscending;
      go({ sort: key, dir: flip ? "asc" : "desc", page: null });
    },
    [go, props.sortAscending, props.sortColumn],
  );

  const commitFilter = useCallback(
    (key: string, raw: string) => {
      const value = raw.trim();
      if (value === (props.filters[key] ?? "")) return;
      // The server drops a filter it can't parse — "last tuesday" on a date
      // column, "lots" on a count. Catching it here means the box says so
      // instead of the typing quietly vanishing on the next render.
      if (value && !parseFilter({ column: key, value })) {
        setRejected((r) => ({ ...r, [key]: true }));
        return;
      }
      setRejected((r) => (r[key] ? { ...r, [key]: false } : r));
      go({ [`f.${key}`]: value || null, page: null });
    },
    [go, props.filters],
  );

  const clearFilters = useCallback(() => {
    const cleared: Record<string, string | null> = { page: null };
    for (const key of Object.keys(props.filters)) cleared[`f.${key}`] = null;
    go(cleared);
  }, [go, props.filters]);

  // ---- reorder ----
  const moveColumn = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = order.filter((k) => k !== from);
      const at = next.indexOf(to);
      next.splice(toIdx > fromIdx ? at + 1 : at, 0, from);
      setOrder(next);
      go({ cols: next.join(",") }, next);
    },
    [go, order],
  );

  const nudge = useCallback(
    (key: string, delta: number) => {
      const idx = order.indexOf(key);
      const target = order[idx + delta];
      if (target) moveColumn(key, target);
    },
    [moveColumn, order],
  );

  // ---- resize ----
  const startResize = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, key: string) => {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const idx = order.indexOf(key);
      // The neighbour that gives up (or takes back) the space, so the row's
      // total width never changes and no scrollbar can appear.
      const neighbour = order[idx + 1] ?? order[idx - 1] ?? null;
      const startX = event.clientX;
      const startW = widths[key] ?? MIN_COLUMN_WIDTH;
      const startN = neighbour ? (widths[neighbour] ?? MIN_COLUMN_WIDTH) : 0;
      const rightward = order[idx + 1] === neighbour;
      let latest: Record<string, number> | null = null;

      const onMove = (ev: PointerEvent) => {
        const raw = ev.clientX - startX;
        const grow = neighbour
          ? Math.min(startN - MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH - startW)
          : MAX_COLUMN_WIDTH - startW;
        const shrink = startW - MIN_COLUMN_WIDTH;
        const delta = Math.max(-shrink, Math.min(grow, Math.round(raw)));
        setWidths((current) => {
          const next = { ...current, [key]: startW + delta };
          // Dragging the LAST column's edge moves the boundary it shares with
          // the column on its left, so that one moves the other way.
          if (neighbour) next[neighbour] = startN + (rightward ? -delta : delta);
          latest = next;
          return next;
        });
      };
      const finish = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          /* already released */
        }
        if (latest) persist(latest);
      };
      handle.setPointerCapture(event.pointerId);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    },
    [order, persist, widths],
  );

  const resetLayout = useCallback(() => {
    try {
      window.localStorage.removeItem(WIDTH_STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
    const fresh = defaultColumns();
    setOrder(fresh);
    setWidths(fitColumnWidths(fresh, defaultWidths(fresh), available));
    go({ cols: fresh.join(","), sort: "last_active_at", dir: "desc", page: null }, fresh);
  }, [available, go]);

  // ---- derived ----
  const measured = available > 0;
  const naturalTotal = useMemo(
    () => order.reduce((sum, key) => sum + (widths[key] ?? MIN_COLUMN_WIDTH), 0),
    [order, widths],
  );
  const tooMany = measured && order.length * MIN_COLUMN_WIDTH > available;
  const activeFilters = Object.keys(props.filters).length;
  const start = props.page * props.pageSize;
  const lastPage = Math.max(0, Math.ceil(props.total / props.pageSize) - 1);

  return (
    <div className="ug">
      {/* ---------------- toolbar ---------------- */}
      <div className="ug-bar">
        <span className="ug-count">
          <strong>{props.total.toLocaleString()}</strong> member
          {props.total === 1 ? "" : "s"}
          {activeFilters > 0 && " matching"}
          {props.rows.length > 0 && (
            <span className="status-muted">
              {" "}
              · rows {start + 1}–{start + props.rows.length}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
        >
          Columns ({order.length})
        </button>
        {activeFilters > 0 && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={clearFilters}>
            Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-secondary" onClick={resetLayout}>
          Reset layout
        </button>
        <label className="ug-size">
          Rows{" "}
          <select
            className="admin-select"
            value={props.pageSize}
            onChange={(e) => go({ size: e.target.value, page: null })}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {picking && (
        <div className="ug-picker">
          <p className="fine">
            Ticked columns show in the order below — drag the ⠿ handle in a heading (or
            focus it and press ← →) to change it.
          </p>
          <div className="col-picker">
            {[...order, ...USER_COLUMNS.map((c) => c.key).filter((k) => !order.includes(k))].map(
              (key) => {
                const def = columnDef(key)!;
                const on = order.includes(key);
                return (
                  <label key={key} className="sim-photo-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = on
                          ? order.filter((k) => k !== key)
                          : [...order, key];
                        if (next.length === 0) return; // a grid with no columns reads as broken
                        setOrder(next);
                        go({ cols: next.join(",") }, next);
                      }}
                    />{" "}
                    {def.label}
                  </label>
                );
              },
            )}
          </div>
        </div>
      )}

      {tooMany && (
        <p className="fine ug-warn">
          More columns are ticked on than fit this screen, so the grid scrolls sideways.
          Untick a few and it will fit again.
        </p>
      )}

      {/* ---------------- the grid ---------------- */}
      <div className="ug-scroll" ref={scrollRef}>
        <table
          className="ug-table"
          style={measured ? { width: GUTTER + naturalTotal } : { width: "100%" }}
        >
          <colgroup>
            <col style={{ width: GUTTER }} />
            {order.map((key) => (
              <col
                key={key}
                style={{
                  width: measured
                    ? widths[key]
                    : `${(((widths[key] ?? MIN_COLUMN_WIDTH) / (naturalTotal || 1)) * 100).toFixed(4)}%`,
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="ug-head">
              <th className="ug-gutter" scope="col">
                <span className="visually-hidden">Row</span>
              </th>
              {order.map((key) => {
                const def = columnDef(key)!;
                const sorted = props.sortColumn === key;
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      sorted ? (props.sortAscending ? "ascending" : "descending") : undefined
                    }
                    className={[
                      "ug-th",
                      sorted ? "ug-th--sorted" : "",
                      overKey === key && dragKey && dragKey !== key ? "ug-th--over" : "",
                      dragKey === key ? "ug-th--dragging" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onDragOver={(e) => {
                      if (!dragKey) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOverKey(key);
                    }}
                    onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragKey ?? e.dataTransfer.getData("text/plain");
                      setDragKey(null);
                      setOverKey(null);
                      if (from) moveColumn(from, key);
                    }}
                  >
                    <span
                      className="ug-drag"
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-label={`Move the ${def.label} column`}
                      title={`Drag to move the ${def.label} column`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", key);
                        e.dataTransfer.effectAllowed = "move";
                        setDragKey(key);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setOverKey(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") {
                          e.preventDefault();
                          nudge(key, -1);
                        } else if (e.key === "ArrowRight") {
                          e.preventDefault();
                          nudge(key, 1);
                        }
                      }}
                    >
                      ⠿
                    </span>
                    <button
                      type="button"
                      className={`ug-sort${alignRight(def.kind) ? " ug-sort--right" : ""}`}
                      onClick={() => sortBy(key)}
                      title={`Sort by ${def.label}`}
                    >
                      <span className="ug-label">{def.label}</span>
                      <span className="ug-arrow" aria-hidden="true">
                        {sorted ? (props.sortAscending ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                    <span
                      className="ug-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize the ${def.label} column`}
                      onPointerDown={(e) => startResize(e, key)}
                      onDoubleClick={() => {
                        const next = { ...widths, [key]: 0 };
                        const fitted = fitColumnWidths(order, next, available);
                        setWidths(fitted);
                        persist(fitted);
                      }}
                    />
                  </th>
                );
              })}
            </tr>
            <tr className="ug-filters">
              <th className="ug-gutter" scope="col">
                <span className="visually-hidden">Filters</span>
              </th>
              {order.map((key) => {
                const def = columnDef(key)!;
                return (
                  <th key={key} scope="col">
                    <input
                      className={`ug-filter${rejected[key] ? " ug-filter--bad" : ""}`}
                      type="text"
                      inputMode={
                        def.kind === "money" || def.kind === "number" ? "decimal" : "text"
                      }
                      aria-label={`Filter by ${def.label}`}
                      aria-invalid={rejected[key] ? true : undefined}
                      title={
                        rejected[key]
                          ? `${def.label} can't filter on that — try ${filterHint(key)}`
                          : undefined
                      }
                      placeholder={filterHint(key)}
                      value={drafts[key] ?? ""}
                      onChange={(e) => {
                        setDrafts({ ...drafts, [key]: e.target.value });
                        if (rejected[key]) setRejected({ ...rejected, [key]: false });
                      }}
                      onBlur={(e) => commitFilter(key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitFilter(key, e.currentTarget.value);
                        if (e.key === "Escape") {
                          setDrafts({ ...drafts, [key]: props.filters[key] ?? "" });
                          setRejected({ ...rejected, [key]: false });
                        }
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, i) => (
              <tr key={row.id}>
                <td className="ug-gutter">{start + i + 1}</td>
                {order.map((key) => {
                  const cell = row.cells[key] ?? { t: "—" };
                  const def = columnDef(key)!;
                  return (
                    <td
                      key={key}
                      className={alignRight(def.kind) ? "ug-num" : undefined}
                      title={cell.t}
                    >
                      {cell.h ? <Link href={cell.h}>{cell.t}</Link> : cell.t}
                    </td>
                  );
                })}
              </tr>
            ))}
            {props.rows.length === 0 && (
              <tr>
                <td className="ug-empty" colSpan={order.length + 1}>
                  No members match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- paging ---------------- */}
      {props.total > props.pageSize && (
        <p className="ug-pages">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={props.page <= 0}
            onClick={() => go({ page: props.page > 1 ? String(props.page - 1) : null })}
          >
            ← Previous
          </button>
          <span className="status-muted">
            Page {props.page + 1} of {lastPage + 1}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={props.page >= lastPage}
            onClick={() => go({ page: String(props.page + 1) })}
          >
            Next →
          </button>
        </p>
      )}
    </div>
  );
}
