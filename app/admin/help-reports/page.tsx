import type { Metadata } from "next";
import Link from "next/link";
import { listHelpReports } from "@/lib/help-report-store";
import { adminResolveHelpReport } from "@/lib/admin-actions";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Help reports — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminHelpReports({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const showAll = (await searchParams).all === "1";
  const reports = await listHelpReports(!showAll);

  if (reports === "unsupported") {
    return (
      <>
        <h1>Help reports</h1>
        <p className="notice" role="status">
          Reports aren&rsquo;t being queued yet — paste migration <strong>9965</strong> in
          the Supabase SQL editor. Until then the button still works and still emails you;
          nothing is lost, it just isn&rsquo;t collected here.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>
        Help reports <Tip k="help.reports" />
      </h1>
      <p className="fine">
        Filed by the &ldquo;I need help!&rdquo; button. Each one carries what the person
        was doing, so you rarely need to ask. <strong>Look for patterns</strong> — three
        reports from the same page in an hour is a bug report even when no single one of
        them reads like one.
      </p>
      <p className="admin-nav">
        <Link href="/admin/help-reports" aria-current={!showAll ? "page" : undefined}>
          Waiting
        </Link>
        <Link href="/admin/help-reports?all=1" aria-current={showAll ? "page" : undefined}>
          All
        </Link>
      </p>

      {reports.length === 0 ? (
        <p className="status-muted">
          {showAll ? "No reports yet." : "Nothing waiting. "}
          {!showAll && <Link href="/admin/help-reports?all=1">See all</Link>}
        </p>
      ) : (
        <ul className="myads">
          {reports.map((r) => (
            <li key={r.id} className="myad-row">
              <p>
                <strong>{r.path}</strong>{" "}
                <span className="status-muted">· {when(r.createdAt)}</span>{" "}
                {r.resolvedAt && <span className="status-muted">· done</span>}
              </p>
              {(r.firstName || r.contactPhone || r.contactEmail) && (
                <p>
                  <strong>
                    Get back to{" "}
                    {[r.firstName, r.lastName].filter(Boolean).join(" ") || "them"}
                  </strong>
                  {r.contactPhone ? ` · ${formatPhone(r.contactPhone)}` : ""}
                  {r.contactEmail ? ` · ${r.contactEmail}` : ""}
                </p>
              )}
              {r.note ? (
                <p>&ldquo;{r.note}&rdquo;</p>
              ) : (
                <p className="status-muted">They didn&rsquo;t type anything.</p>
              )}
              <p className="fine">
                {r.phone ? (
                  <>
                    <Link href={`/admin/users?phone=${r.phone}`}>{formatPhone(r.phone)}</Link>
                    {r.memberId ? ` · id ${r.memberId}` : ""} · email on file:{" "}
                    {r.hasEmail ? "yes" : "no"}
                  </>
                ) : (
                  <>Not signed in</>
                )}
                {r.referrer ? ` · came from ${r.referrer}` : ""}
                {r.viewport ? ` · screen ${r.viewport}` : ""}
                {r.timezone ? ` · ${r.timezone}` : ""}
              </p>
              {r.userAgent && <p className="fine status-muted">{r.userAgent}</p>}
              {r.lastError && (
                <p className="fine">
                  <span className="ad-sold">Page error:</span> {r.lastError}
                </p>
              )}
              {r.resolvedNote && <p className="fine">Note: {r.resolvedNote}</p>}
              <form action={adminResolveHelpReport} className="review-form">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="resolved" value={r.resolvedAt ? "no" : "yes"} />
                <input type="hidden" name="all" value={showAll ? "1" : ""} />
                <div className="inline-fields">
                  {!r.resolvedAt && (
                    <input name="note" type="text" placeholder="What you did (optional)" />
                  )}
                  <button className="btn btn-sm btn-secondary" type="submit">
                    {r.resolvedAt ? "Reopen" : "Mark done"}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
