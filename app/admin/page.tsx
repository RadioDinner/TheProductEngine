import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  adminApprove,
  adminApproveEvent,
  adminDeclineEvent,
  adminReject,
  adminResolveChatReport,
} from "@/lib/admin-actions";
import { getPendingAds } from "@/lib/engine-store";
import { listChatReports } from "@/lib/store";
import { findLinks } from "@/lib/content-filter";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";
import { etParts } from "@/lib/et";
import { formatEventDay } from "@/lib/town-hall";
import { listPendingEvents } from "@/lib/town-hall-store";

export const metadata: Metadata = {
  title: `Review queue — ${site.name} admin`,
};

function submitted(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminReview() {
  const pending = await getPendingAds();
  // Member-reported chat messages (item 13) — empty until migration 9980.
  const reports = await listChatReports();
  // Town hall submissions (item 18) — empty until migration 9977.
  const pendingEvents = await listPendingEvents();
  const todayDay = etParts(new Date()).day;

  return (
    <>
      <h1>Review queue</h1>
      {pending.length === 0 && <p>Nothing waiting for review.</p>}
      <ul className="sim-pending">
        {pending.map((ad) => {
          const links = findLinks(ad.body);
          return (
          <li key={ad.id} className="myad-row">
            <p className="myad-title">
              #{ad.id} from {formatPhone(ad.ownerPhone)}
              {ad.flagged && <span className="ad-sold"> Flagged</span>}
              {links.length > 0 && <span className="ad-sold"> 🔗 Link</span>}
              {ad.photo && <span className="ad-sold"> 📷 Picture ad</span>}
              <span className="status-muted"> · {submitted(ad.createdAt)}</span>
            </p>
            {links.length > 0 && (
              <p className="myad-dates">
                Contains a link ({links.join(", ")}) — edit it out before approving, or reject.
              </p>
            )}
            {ad.photo && (
              <a href={ad.photo.src} target="_blank" rel="noreferrer" title="Open full-size photo">
                <Image
                  className="ad-thumb"
                  src={ad.photo.src}
                  alt={ad.photo.alt}
                  width={88}
                  height={88}
                />
              </a>
            )}
            <form action={adminApprove} className="review-form">
              <input type="hidden" name="id" value={ad.id} />
              <label className="visually-hidden" htmlFor={`body-${ad.id}`}>
                Ad text (editable)
              </label>
              <textarea id={`body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
              <button className="btn btn-sm" type="submit">
                Approve
              </button>
            </form>
            <form action={adminReject} className="review-form review-reject">
              <input type="hidden" name="id" value={ad.id} />
              <label className="visually-hidden" htmlFor={`reason-${ad.id}`}>
                Rejection reason
              </label>
              <input
                id={`reason-${ad.id}`}
                name="reason"
                type="text"
                placeholder="Reason texted to the seller (optional — a default is used)"
              />
              <div className="sim-actions">
                <button className="btn btn-sm btn-secondary" name="kind" value="benign" type="submit">
                  Reject — refund
                </button>
                <button className="btn btn-sm btn-secondary" name="kind" value="violation" type="submit">
                  Reject — violation (strike)
                </button>
              </div>
            </form>
          </li>
          );
        })}
      </ul>
      {reports.length > 0 && (
        <>
          <h2 className="section-h">Reported chat messages</h2>
          <p className="fine">
            A member pressed &ldquo;Report this message&rdquo; in their conversation. The full
            thread is in the <Link href="/admin/messages">message log</Link> (filter by the
            sender&apos;s number). Resolving or dismissing only clears the report — any real
            action stays yours on the sender&apos;s user page.
          </p>
          <ul className="sim-pending">
            {reports.map((r) => (
              <li key={r.messageId} className="myad-row">
                <p className="myad-title">
                  Chat #{r.chatId}
                  {r.adId ? <> · about ad #{r.adId}</> : null} · from{" "}
                  <Link href={`/admin/users?phone=${r.senderPhone}`}>
                    {r.senderMemberId ? `Member ${r.senderMemberId}` : formatPhone(r.senderPhone)}
                  </Link>{" "}
                  ({formatPhone(r.senderPhone)})
                  <span className="status-muted">
                    {" "}
                    · sent {submitted(r.at)} · reported {submitted(r.reportedAt)} by{" "}
                    {formatPhone(r.reporterPhone)}
                  </span>
                </p>
                {r.photo && (
                  <a href={r.photo} target="_blank" rel="noreferrer" title="Open full-size photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.photo}
                      alt={`Reported picture in chat #${r.chatId}`}
                      style={{ maxWidth: 160, maxHeight: 120, border: "1px solid #ccc" }}
                    />
                  </a>
                )}
                <p className="sim-body">{r.body || "(picture only)"}</p>
                <form action={adminResolveChatReport} className="sim-actions">
                  <input type="hidden" name="id" value={r.messageId} />
                  <button className="btn btn-sm" name="decision" value="resolved" type="submit">
                    Resolved — clear it
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    name="decision"
                    value="dismissed"
                    type="submit"
                  >
                    Dismiss report
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
      {pendingEvents.length > 0 && (
        <>
          <h2 className="section-h">Town hall events</h2>
          <p className="fine">
            Community events for the <Link href="/town-hall">town hall board</Link>.
            Listings are free in v1, so declining charges nothing and refunds nothing.
            Approved events show on the homepage sidebar and /town-hall until their date
            passes, then drop off by themselves.
          </p>
          <ul className="sim-pending">
            {pendingEvents.map((event) => (
              <li key={event.id} className="myad-row">
                <p className="myad-title">
                  {event.title}
                  <span className="status-muted">
                    {" "}
                    · from {formatPhone(event.ownerPhone)} · submitted{" "}
                    {submitted(event.createdAt)}
                  </span>
                </p>
                <p className="myad-dates">
                  {formatEventDay(event.eventDate)}
                  {event.timeText ? ` · ${event.timeText}` : ""}
                  {event.placeText ? ` · ${event.placeText}` : ""}
                  {event.eventDate < todayDay && (
                    <span className="ad-sold"> Date already passed</span>
                  )}
                </p>
                <p className="sim-body">{event.body}</p>
                <div className="sim-actions">
                  <form action={adminApproveEvent}>
                    <input type="hidden" name="id" value={event.id} />
                    <button className="btn btn-sm" type="submit">
                      Approve
                    </button>
                  </form>
                  <form action={adminDeclineEvent}>
                    <input type="hidden" name="id" value={event.id} />
                    <button className="btn btn-sm btn-secondary" type="submit">
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
