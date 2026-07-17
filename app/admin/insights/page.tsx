import type { Metadata } from "next";
import Link from "next/link";
import { getInsights, type Insights } from "@/lib/insights";
import { listBlocked } from "@/lib/blocklist";
import { adminBlockNumber } from "@/lib/admin-actions";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Insights — ${site.name} admin`,
  robots: { index: false },
};

// Always fresh — never serve cached numbers.
export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90];

function who(address: string): string {
  return /^\d{10}$/.test(address) ? formatPhone(address) : address;
}
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminInsights({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const windowDays = WINDOWS.includes(Number(params.days)) ? Number(params.days) : 30;

  let data: Insights | null = null;
  let failed = false;
  try {
    data = await getInsights(windowDays);
  } catch (e) {
    failed = true;
    console.error("[insights] failed to load:", e);
  }

  let blocked = new Set<string>();
  try {
    blocked = new Set((await listBlocked()).map((b) => b.phone));
  } catch (e) {
    console.error("[insights] blocklist load failed:", e);
  }

  const stat = (label: string, value: number | string) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  // One-click block for a phone-number address (emails can't be blocked).
  const blockCell = (address: string) =>
    /^\d{10}$/.test(address) ? (
      blocked.has(address) ? (
        <span className="status-muted">Blocked</span>
      ) : (
        <form action={adminBlockNumber} className="inline-form">
          <input type="hidden" name="phone" value={address} />
          <input type="hidden" name="reason" value="Blocked from Insights" />
          <input type="hidden" name="back" value="/admin/insights" />
          <button className="btn btn-sm btn-secondary" type="submit">
            Block
          </button>
        </form>
      )
    ) : null;

  return (
    <>
      <h1>Insights</h1>
      <p className="admin-nav" aria-label="Window">
        Window:{" "}
        {WINDOWS.map((d) => (
          <Link key={d} href={`/admin/insights?days=${d}`} aria-current={d === windowDays ? "page" : undefined}>
            {d} days
          </Link>
        ))}
      </p>

      {failed || !data ? (
        <p className="notice" role="status">
          Insights couldn&rsquo;t load. If you just deployed, the database may still need
          migrations <strong>9994</strong> and <strong>9993</strong> — run them in the Supabase
          SQL editor, then reload. The exact error is in the server logs.
        </p>
      ) : (
        <>
          <h2 className="section-h">Activity (last {data.windowDays} days)</h2>
          <dl className="account-facts">
            {stat("Texts received", data.totals.inboundMessages.toLocaleString())}
            {stat("People who texted", data.totals.uniqueSenders.toLocaleString())}
            {stat("Ads posted", data.totals.adsInWindow.toLocaleString())}
            {stat("Bumps", data.totals.bumpsInWindow.toLocaleString())}
            {stat("Credits spent", data.totals.creditsSpentInWindow.toLocaleString())}
            {stat("Credits purchased", data.totals.creditsPurchasedInWindow.toLocaleString())}
          </dl>

          <h2 className="section-h">Ads (all time)</h2>
          <dl className="account-facts">
            {stat("Waiting", data.adFunnel.pending.toLocaleString())}
            {stat("Live", data.adFunnel.approved.toLocaleString())}
            {stat("Sold", data.adFunnel.sold.toLocaleString())}
            {stat("Expired", data.adFunnel.expired.toLocaleString())}
            {stat("Rejected", data.adFunnel.rejected.toLocaleString())}
            {stat("Total bumps", data.totals.bumpsAllTime.toLocaleString())}
          </dl>

          <h2 className="section-h">Top advertisers</h2>
          {data.topAdvertisers.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Advertiser</th>
                    <th>Ads</th>
                    <th>Sold</th>
                    <th>Bumps</th>
                    <th>Credits spent ({data.windowDays}d)</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topAdvertisers.map((a) => (
                    <tr key={a.phone}>
                      <td>{who(a.phone)}</td>
                      <td>{a.adsPosted}</td>
                      <td>{a.adsSold}</td>
                      <td>{a.bumps}</td>
                      <td>{a.creditsSpent}</td>
                      <td className="status-muted">{when(a.lastActiveAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No ads yet.</p>
          )}

          <h2 className="section-h">Who texts the most (last {data.windowDays} days)</h2>
          {data.topSenders.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Texts</th>
                    <th>Picture requests</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.topSenders.map((s) => (
                    <tr key={s.address}>
                      <td>{who(s.address)}</td>
                      <td>{s.messages}</td>
                      <td>{s.pics}</td>
                      <td>{blockCell(s.address)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No texts yet.</p>
          )}

          <h2 className="section-h">Picture requests</h2>
          <p className="fine">
            Numbers pulling the most pictures. Flagged when more than{" "}
            <strong>{data.picThresholdPerDay}</strong> in 24 hours (change it on{" "}
            <Link href="/admin/settings">Settings</Link>).
          </p>
          {data.picHeavy.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Last hour</th>
                    <th>Last 24h</th>
                    <th>Last 7d</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.picHeavy.map((p) => (
                    <tr key={p.address}>
                      <td>{who(p.address)}</td>
                      <td>{p.pics1h}</td>
                      <td>{p.pics24h}</td>
                      <td>{p.pics7d}</td>
                      <td>
                        {p.flagged && <span className="ad-sold">Excessive</span>} {blockCell(p.address)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No picture requests in this window.</p>
          )}

          <h2 className="section-h">Number look-ups (website reveals)</h2>
          <p className="fine">
            Members pressing &ldquo;Show number&rdquo; on the most ads — each count is
            distinct sellers&rsquo; numbers revealed (re-viewing a revealed ad is free and
            not counted). Flagged when more than <strong>{data.revealThresholdPerDay}</strong>{" "}
            in 24 hours — the scraper signature (change it on{" "}
            <Link href="/admin/settings">Settings</Link>).
          </p>
          {data.revealHeavy.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Last 24h</th>
                    <th>Last {data.windowDays}d</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.revealHeavy.map((r) => (
                    <tr key={r.phone}>
                      <td>{who(r.phone)}</td>
                      <td>{r.reveals24h}</td>
                      <td>{r.revealsWindow}</td>
                      <td>
                        {r.flagged && <span className="ad-sold">Excessive</span>}{" "}
                        {blockCell(r.phone)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No numbers revealed in this window.</p>
          )}

          <h2 className="section-h">Most engaged</h2>
          {data.engagement.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Score</th>
                    <th>Texts</th>
                    <th>Ads</th>
                    <th>Pics</th>
                    <th>Bumps</th>
                    <th>Purchases</th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagement.map((e) => (
                    <tr key={e.address}>
                      <td>{who(e.address)}</td>
                      <td>{e.score}</td>
                      <td>{e.messages}</td>
                      <td>{e.ads}</td>
                      <td>{e.pics}</td>
                      <td>{e.bumps}</td>
                      <td>{e.purchases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No activity yet.</p>
          )}

          <h2 className="section-h">Most-bumped ads</h2>
          {data.topBumpedAds.length ? (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ad</th>
                    <th>Advertiser</th>
                    <th>Bumps</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topBumpedAds.map((b) => (
                    <tr key={b.adId}>
                      <td>#{b.adId}</td>
                      <td>{b.ownerPhone ? who(b.ownerPhone) : "—"}</td>
                      <td>{b.bumps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No bumps yet.</p>
          )}
        </>
      )}
    </>
  );
}
