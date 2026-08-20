/**
 * "I need help!" report SHAPE and the pure helpers around it (feature 39).
 *
 * Deliberately free of any storage import. The help button is a client
 * component and needs the note cap and the types; when this module also held
 * the file store, `node:fs` followed it into the browser bundle and the build
 * refused outright. Storage lives in lib/help-report-store.ts.
 */

/** What the browser can tell us. All optional — a report with nothing but a
 * path is still worth having. */
export interface HelpDiagnostics {
  path: string;
  referrer?: string;
  userAgent?: string;
  viewport?: string;
  timezone?: string;
  lastError?: string;
  note?: string;
}

export interface HelpReport extends HelpDiagnostics {
  id: number;
  phone: string | null;
  memberId: string | null;
  hasEmail: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
}

/** Ceilings. A help report is diagnostics, not an essay, and every field here
 * arrives from the client — an unbounded string is somebody else's storage
 * bill. */
export const NOTE_MAX = 1000;
const FIELD_MAX = 400;
const PATH_MAX = 300;

/**
 * Clean and bound whatever the browser sent. Pure.
 *
 * `path` is forced to a site-relative path: it is displayed in the admin list
 * and turned into a link, so a full URL from another origin would make an
 * operator-facing page that links off-site on a stranger's say-so.
 */
export function sanitizeDiagnostics(raw: Partial<HelpDiagnostics>): HelpDiagnostics {
  const clip = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const s = v.replace(/\s+/g, " ").trim().slice(0, max);
    return s || undefined;
  };
  let path = clip(raw.path, PATH_MAX) ?? "/";
  if (!path.startsWith("/") || path.startsWith("//")) path = "/";
  return {
    path,
    referrer: clip(raw.referrer, FIELD_MAX),
    userAgent: clip(raw.userAgent, FIELD_MAX),
    viewport: clip(raw.viewport, 40),
    timezone: clip(raw.timezone, 60),
    lastError: clip(raw.lastError, FIELD_MAX),
    note: clip(raw.note, NOTE_MAX),
  };
}

/**
 * A one-line summary for the operator's email subject, so a phone
 * notification is useful without opening anything.
 */
export function reportSummary(report: {
  path: string;
  phone?: string | null;
  note?: string;
}): string {
  const who = report.phone ? report.phone : "a signed-out visitor";
  const note = report.note ? `: "${report.note.slice(0, 60)}${report.note.length > 60 ? "…" : ""}"` : "";
  return `Help needed on ${report.path} from ${who}${note}`;
}
