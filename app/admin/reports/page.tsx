import type { Metadata } from "next";
import { getReportSummary } from "@/lib/reports";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Reports — ${site.name} admin`,
  robots: { index: false },
};

// Always fresh — never serve cached numbers.
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

export default async function AdminReports() {
  const r = await getReportSummary();

  const stat = (label: string, value: number | string, note?: string) => (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <span className="status-muted"> {note}</span>}
      </dd>
    </div>
  );

  return (
    <>
      <h1>Reports</h1>

      <h2 className="section-h">Subscribers</h2>
      <dl className="account-facts">
        {stat("Active text subscribers", r.smsSubscribers.toLocaleString())}
        {stat("Email subscribers", r.emailSubscribers.toLocaleString())}
        {stat("New subscribers (last 7 days)", r.newSubscribers7d.toLocaleString())}
      </dl>

      <h2 className="section-h">Website visits</h2>
      <dl className="account-facts">
        {stat("Today", r.visits.today.toLocaleString())}
        {stat("Last 7 days", r.visits.last7.toLocaleString())}
        {stat("All time", r.visits.total.toLocaleString())}
      </dl>
      <p className="fine">
        Counted server-side on the homepage and ad pages — no cookies, and it counts visitors
        even with JavaScript turned off. Requires migration 0002 to be applied.
      </p>

      <h2 className="section-h">Ads</h2>
      <dl className="account-facts">
        {stat("Waiting for review", r.adsPending.toLocaleString())}
        {stat("Posted (last 7 days)", r.ads7d.toLocaleString())}
        {stat("Posted (all time)", r.adsTotal.toLocaleString())}
      </dl>

      <h2 className="section-h">Recent subscribers</h2>
      {r.recentSubscribers.length ? (
        <ul className="myads">
          {r.recentSubscribers.map((s) => (
            <li key={s.phone + s.at} className="myad-row">
              <span className="myad-title">{formatPhone(s.phone)}</span>
              <span className="myad-dates"> subscribed {when(s.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No subscribers yet.</p>
      )}
    </>
  );
}
