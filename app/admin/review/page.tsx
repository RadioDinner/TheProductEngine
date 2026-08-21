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
import { getAdCategories, getAdsOwed, getPendingAds, listOwedAds } from "@/lib/engine-store";
import { categoriesSupported, getAccount, getCreditBalance, listChatReports } from "@/lib/store";
import { purseForAd } from "@/lib/ad-funding";
import { CATEGORIES } from "@/lib/categories";
import { findLinks } from "@/lib/content-filter";
import { formatPhone } from "@/lib/phone";
import { formatPrice, site } from "@/lib/config";
import { etParts } from "@/lib/et";
import { formatEventDay } from "@/lib/town-hall";
import { listPendingEvents } from "@/lib/town-hall-store";
import { countAdsAwaitingPictures } from "@/lib/engine-store";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Review queue — ${site.name} admin`,
};

// The queue lived at /admin until session 019, when the dashboard took that
// address. Everything that used to send you back here — approve, reject,
// resolve a report, decide an event — now redirects to /admin/review.
export const dynamic = "force-dynamic";

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
  // Picture ads still collecting photos are deliberately NOT in the queue yet
  // (session 016) — surfaced as a count so a "missing" ad is never a mystery.
  const settling = await countAdsAwaitingPictures();
  // Member-reported chat messages (item 13) — empty until migration 9980.
  const reports = await listChatReports();
  // Town hall submissions (item 18) — empty until migration 9977.
  const pendingEvents = await listPendingEvents();
  const todayDay = etParts(new Date()).day;
  // Category dropdown (item 22): the operator assigns the category here at
  // review. Hidden until migration 9976 — approvals then work exactly as
  // before. A web-posted ad's seller suggestion pre-fills the dropdown.
  const withCategories = await categoriesSupported();
  const adCategories = withCategories
    ? await getAdCategories(pending.map((ad) => ad.id))
    : new Map<number, string | null>();

  // Whether each waiting ad is paid for (session 021). An ad is collected for
  // when it RUNS, so one can reach this queue unfunded and be approved — the
  // user hit exactly that and asked to be able to tell. Approving an unfunded
  // ad is still the right move: it keeps its place and goes out the moment the
  // money lands. The badge is so the decision is made knowing which it is.
  const owed = await getAdsOwed(pending.map((ad) => ad.id)).catch(
    () => new Map<number, number>(),
  );
  const payment = new Map<number, string>();
  if (owed.size) {
    // One pass per SELLER, not per ad, and capped: an operator who lets the
    // queue run to hundreds should not turn this page into hundreds of
    // sequential round trips. Past the cap the badges are simply omitted —
    // the ads still review normally.
    const sellers = [...new Set(pending.map((ad) => ad.ownerPhone))].slice(0, 40);
    const funding = new Map<string, { purse: (id: number) => number; hasCard: boolean }>();
    await Promise.all(
      sellers.map(async (phone) => {
        try {
          const [balance, owedAds, account] = await Promise.all([
            getCreditBalance(phone),
            listOwedAds(phone),
            getAccount(phone),
          ]);
          funding.set(phone, {
            purse: (id: number) => purseForAd(owedAds, id, balance),
            // The CHEAP card signal on purpose: a stored Stripe customer. The
            // thorough check (lib/ad-billing cardOnFile) can make a Stripe
            // call per member, and an admin page listing forty sellers is not
            // the place for forty of those.
            hasCard: Boolean(account?.stripeCustomerId),
          });
        } catch (e) {
          console.error(`[admin/review] funding unreadable for ${phone}:`, e);
        }
      }),
    );
    for (const ad of pending) {
      const due = owed.get(ad.id) ?? 0;
      if (!due) continue;
      const f = funding.get(ad.ownerPhone);
      if (!f) continue;
      // A card on file means it pays itself when it runs, however small the
      // balance — labelling that "waiting for payment" would send the operator
      // chasing a member who owes nothing.
      const covered = f.hasCard || f.purse(ad.id) >= due;
      payment.set(
        ad.id,
        covered ? `${formatPrice(due)} — pays when it runs` : `${formatPrice(due)} — waiting for payment`,
      );
    }
  }

  return (
    <>
      <h1>
        Review queue <Tip k="review.queue" />
      </h1>
      <p className="fine">
        Badges mark word-filter matches <Tip k="review.flagged" />, links{" "}
        <Tip k="review.linkBadge" />, and pictures <Tip k="review.pictureBadge" />. Edit
        freely before approving <Tip k="review.editText" />, file the ad with the category
        dropdown <Tip k="review.category" />, and settle the money with the right reject
        button <Tip k="review.reject" />.
      </p>
      {pending.length === 0 && settling === 0 && <p>Nothing waiting for review.</p>}
      {settling > 0 && (
        <p className="fine">
          {settling === 1
            ? "1 picture ad is still collecting pictures"
            : `${settling} picture ads are still collecting pictures`}{" "}
          — they appear here once the seller stops sending (about 10 minutes) or hits the
          4-picture maximum, so you never approve an ad that is only half its photos.
        </p>
      )}
      <ul className="sim-pending">
        {pending.map((ad) => {
          const links = findLinks(ad.body);
          return (
          <li key={ad.id} className="myad-row">
            <p className="myad-title">
              #{ad.id} from {formatPhone(ad.ownerPhone)}
              {payment.get(ad.id) && (
                <span className="ad-sold"> {payment.get(ad.id)}</span>
              )}
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
              {withCategories && (
                <p className="fine">
                  <label htmlFor={`category-${ad.id}`}>Category </label>
                  <select
                    id={`category-${ad.id}`}
                    name="category"
                    defaultValue={adCategories.get(ad.id) ?? ""}
                    className="admin-select"
                  >
                    <option value="">Uncategorized — rides every digest</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label} — {c.menu}
                      </option>
                    ))}
                  </select>
                </p>
              )}
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
          <h2 className="section-h">
            Reported chat messages <Tip k="review.chatReports" />
          </h2>
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
          <h2 className="section-h">
            Town hall events <Tip k="review.townHall" />
          </h2>
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
