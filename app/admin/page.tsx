import type { Metadata } from "next";
import Link from "next/link";
import { getDashboardStats } from "@/lib/dashboard";
import { getEngineSettings } from "@/lib/settings";
import { hourLabel, nextSendLabel, smsWindowOpen } from "@/lib/digest-engine";
import { systemHealth, type HealthLevel } from "@/lib/system-health";
import { countOpenHelpReports } from "@/lib/help-report-store";
import type { HandbookKey } from "@/lib/admin-handbook";
import { supabaseConfigured } from "@/lib/db";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Dashboard — ${site.name} admin`,
};

export const dynamic = "force-dynamic";

/** Past this many undelivered sends, a queue is a backlog worth a look rather
 * than the normal few-minutes-of-draining. */
const BACKLOG = 40;

function Stat({
  label,
  value,
  note,
  href,
  tip,
}: {
  label: string;
  value: number;
  note?: string;
  href: string;
  tip?: HandbookKey;
}) {
  return (
    <Link href={href} className="stat-tile">
      <span className="stat-label">
        {label}
        {tip ? <Tip k={tip} /> : null}
      </span>
      <span className="stat-value">{value.toLocaleString()}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </Link>
  );
}

function dot(level: HealthLevel): string {
  return level === "go" ? "●" : level === "attention" ? "▲" : "■";
}

export default async function AdminDashboard() {
  const settings = await getEngineSettings();
  const stats = await getDashboardStats();
  const openHelp = await countOpenHelpReports();

  const now = new Date();
  const windowOpen = smsWindowOpen(now, settings);
  const health = systemHealth({
    adsPaused: settings.adsPaused,
    outboundPaused: settings.outboundPaused,
    underAttack: settings.underAttack,
    windowOpen,
    windowLabel: `${hourLabel(settings.smsWindowStartHour)}–${hourLabel(
      settings.smsWindowEndHour,
    )}, Mon–Sat`,
    nextSendLabel: nextSendLabel(now, settings),
    queuedDeliveries: stats.queuedDeliveries,
    backlogThreshold: BACKLOG,
    databaseLive: supabaseConfigured,
    textingConfigured: Boolean(process.env.TELNYX_API_KEY),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    paymentsConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });

  return (
    <>
      <h1>
        Dashboard <Tip k="dashboard.overview" />
      </h1>

      {/* ---------------- the numbers ---------------- */}
      <div className="stat-grid">
        <Stat
          label="SMS subscribers"
          value={stats.smsSubscribers}
          note="numbers getting the ad texts"
          href="/admin/subscribers"
          tip="dashboard.smsSubscribers"
        />
        <Stat
          label="Email subscribers"
          value={stats.emailSubscribers}
          note="addresses getting the editions"
          href="/admin/subscribers"
          tip="dashboard.emailSubscribers"
        />
        <Stat
          label="Active ads"
          value={stats.activeAds}
          note={
            stats.awaitingBroadcast > 0
              ? `${stats.liveOnSite.toLocaleString()} on the website · ${stats.awaitingBroadcast.toLocaleString()} waiting to go out`
              : `${stats.liveOnSite.toLocaleString()} on the website`
          }
          href="/admin/ads?status=approved"
          tip="dashboard.activeAds"
        />
        <Stat
          label="Waiting for review"
          value={stats.pendingReview}
          note={
            stats.settlingPictures > 0
              ? `${stats.settlingPictures} more still collecting pictures`
              : stats.pendingReview === 0
                ? "nothing waiting on you"
                : "ads need your yes or no"
          }
          href="/admin/review"
          tip="dashboard.pendingReview"
        />
      </div>

      {/* ---------------- system health ---------------- */}
      <section className={`health health--${health.level}`} aria-labelledby="health-h">
        <p className="health-head">
          <span className="health-dot" aria-hidden="true">
            {dot(health.level)}
          </span>
          <strong id="health-h">{health.headline}</strong> <Tip k="dashboard.health" />
        </p>
        <p className="health-summary">{health.summary}</p>
        <ul className="health-list">
          {health.items.map((item) => (
            <li key={item.key} className={`health-item health-item--${item.level}`}>
              <span className="health-dot" aria-hidden="true">
                {dot(item.level)}
              </span>
              <span className="health-label">{item.label}</span>
              <span className="health-state">{item.state}</span>
              {/* Spell it out only where it earns the line: anything that isn't
               * green, and the send window, which is the one green state that
               * still explains why nothing is moving. Eight rows of prose
               * saying "this is fine" is how a panel stops being read. */}
              {item.detail && (item.level !== "go" || item.key === "window") ? (
                <span className="health-detail">{item.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="fine">
          Both pauses live on <Link href="/admin/settings">Settings</Link>. Turning one ON
          texts subscribers a notice only if you tick the box; turning one off is always
          silent.
        </p>
      </section>

      {/* ---------------- what needs a person ---------------- */}
      {(stats.pendingReview > 0 || openHelp > 0) && (
        <>
          <h2 className="section-h">Waiting on you</h2>
          <ul className="myads">
            {stats.pendingReview > 0 && (
              <li className="myad-row">
                <Link href="/admin/review">
                  {stats.pendingReview} ad{stats.pendingReview === 1 ? "" : "s"} in the
                  review queue
                </Link>{" "}
                <span className="status-muted">
                  — nothing broadcasts or appears on the website without your yes.
                </span>
              </li>
            )}
            {openHelp > 0 && (
              <li className="myad-row">
                <Link href="/admin/help-reports">
                  {openHelp} open help report{openHelp === 1 ? "" : "s"}
                </Link>{" "}
                <span className="status-muted">
                  — a member pressed &ldquo;I need help!&rdquo; and is waiting.
                </span>
              </li>
            )}
          </ul>
        </>
      )}

      <p className="fine">
        Version {site.version}. Deeper numbers live on{" "}
        <Link href="/admin/reports">Reports</Link> and{" "}
        <Link href="/admin/insights">Insights</Link>; every member is on the{" "}
        <Link href="/admin/users/table">members table</Link>.
      </p>
    </>
  );
}
