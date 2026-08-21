import type { Metadata } from "next";
import Link from "next/link";
import {
  adminDeleteAd,
  adminEditAd,
  adminPromoteAdToFeatured,
  adminQueueBump,
  adminResolvePhotoSubmission,
} from "@/lib/admin-actions";
import {
  getAdCategories,
  getAdDelivery,
  getAdRecord,
  getAllAds,
  getQueuedBumps,
  listPhotoSubmissions,
  type PhotoSubmission,
  type AdDelivery,
  type StoredAd,
  type StoredAdStatus,
} from "@/lib/engine-store";
import { categoriesSupported, getLedger } from "@/lib/store";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { isPicReplaceSubmission } from "@/lib/myads";
import { textedAdPhotos } from "@/lib/photo-collage";
import { formatPhone } from "@/lib/phone";
import { formatPrice, site } from "@/lib/config";
import { getEngineSettings } from "@/lib/settings";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `All ads — ${site.name} admin`,
};

// "unpaid" first after pending: a held ad is money waiting to be collected,
// and the operator should be able to see who is one phone call from posting.
const STATUSES: StoredAdStatus[] = [
  "pending",
  "unpaid",
  "approved",
  "rejected",
  "sold",
  "expired",
  "deleted",
];

// Colour on a status marker is meaning, never decoration (DESIGN.md, The
// Second Ink Rule): full-strength ink for an ad that is LIVE, the second ink
// for one that is WAITING on the operator, muted for one that is finished
// with. Red is kept for the flag, so a scan of the list finds it instantly —
// which it could not when the picture marker was red on every other row.
function statusTone(status: StoredAdStatus): string {
  if (status === "approved") return " adcard-tag--live";
  if (status === "pending" || status === "unpaid") return " adcard-tag--waiting";
  return "";
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Where this ad has actually been delivered, as one line per channel (user
 * request, session 022).
 *
 * ⚠️ **Texted and "on the website" are the SAME moment, and the line says so
 * rather than inventing a second timestamp.** Every public query in
 * lib/ads-supabase.ts requires `broadcast_at IS NOT NULL`, so an ad becomes
 * visible on the site exactly when its batch goes out — there is no separate
 * publish step, and reporting one would be reporting a stage that does not
 * exist. It is also why a paused ad is not on the website: it never broadcast.
 */
function deliveryLines(sent: AdDelivery | undefined, status: StoredAdStatus): string[] {
  const lines: string[] = [];
  if (!sent) return lines;
  if (sent.broadcastAt) {
    lines.push(`Texted ${when(sent.broadcastAt)} · on the website since`);
  } else if (status === "approved") {
    lines.push("Not texted yet — and not on the website until it is");
  }
  if (sent.emailedAt) {
    lines.push(
      sent.emailDigestNo !== null
        ? `Emailed ${when(sent.emailedAt)} · Digest No. ${sent.emailDigestNo}`
        : `Emailed ${when(sent.emailedAt)}`,
    );
  } else if (sent.broadcastAt) {
    lines.push("Not in an email edition yet");
  }
  return lines;
}

/**
 * What happens to picture number `i` of an ad — the three fates are genuinely
 * different, and lumping them together would misreport what the seller bought.
 *
 *  - **Picture 1 BROADCASTS.** `resolveBroadcastPictures` sends exactly
 *    `textedAdPhotos(...)[0]`, so one picture ad = one picture message however
 *    many pictures it holds.
 *  - **Pictures 2-3 are PIC-on-request.** They're texted only when a member
 *    replies PIC, which is what keeps a three-picture ad from costing three
 *    times as much to send to the whole list.
 *  - **Anything past `MAX_COMBINED_PHOTOS` is website-only** — an emailed-in
 *    extra nobody was charged to broadcast.
 */
function pictureRole(index: number, textedCount: number): { tag: string | null; title: string } {
  if (index === 0) return { tag: "texts", title: "goes out with the batch" };
  if (index < textedCount) return { tag: "PIC", title: "texted only if someone replies PIC" };
  return { tag: null, title: "website only" };
}

/**
 * What an edit in THIS status actually reaches, said before the operator
 * types rather than after they wonder.
 *
 * Keyed off status on purpose. The obvious line to write is "this ad already
 * went out by text" — but `broadcastAt` is deliberately left out of the shared
 * Supabase ad select (so /admin never hard-depends on migration 9993), which
 * means it reads `undefined` for EVERY ad in production. A note built on it
 * would tell the operator "not sent yet" about ads that went out days ago,
 * confidently and always. Status is a fact this page really holds.
 */
function editScope(status: StoredAdStatus): string | null {
  switch (status) {
    case "unpaid":
      return "Held for payment — your edit is what goes out when the seller's card lands.";
    case "rejected":
      return "A rejected ad isn't on the website; editing only changes what's on file.";
    case "approved":
    case "sold":
    case "expired":
      return "This ad has been out. The website listing updates right away, but a text that already sent can't be changed.";
    default:
      return null; // pending — it hasn't gone anywhere yet.
  }
}

export default async function AdminAds({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    delete?: string;
    deleted?: string;
    saved?: string;
    id?: string;
    error?: string;
    promoted?: string;
    slot?: string;
    billed?: string;
    short?: string;
    phone?: string;
  }>;
}) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as StoredAdStatus)
    ? (params.status as StoredAdStatus)
    : undefined;
  const ads = await getAllAds(params.q, status);
  const settings = await getEngineSettings();
  const featuredPrice = settings.featuredMonthlyCents;
  const bumpQueued = new Set((await getQueuedBumps()).map((b) => b.adId));
  // Where each ad has actually been delivered (session 022). Its own read,
  // so a missing migration costs this line and not the page.
  const delivery = await getAdDelivery(ads.map((ad) => ad.id));
  // Inline category editing (item 22) — hidden until migration 9976.
  const withCategories = await categoriesSupported();
  const adCategories = withCategories
    ? await getAdCategories(ads.map((ad) => ad.id))
    : new Map<number, string | null>();
  // Emailed-in extra pictures awaiting review, grouped per ad (FEATURES item 1).
  const submissionsByAd = new Map<number, PhotoSubmission[]>();
  for (const submission of await listPhotoSubmissions()) {
    const list = submissionsByAd.get(submission.adId) ?? [];
    list.push(submission);
    submissionsByAd.set(submission.adId, list);
  }

  // Filter-preserving links: Cancel and per-row Delete… keep q/status intact.
  const listParams = new URLSearchParams();
  if (params.q) listParams.set("q", params.q);
  if (status) listParams.set("status", status);
  const listHref = `/admin/ads${listParams.size ? `?${listParams}` : ""}`;
  const deleteHref = (id: number) => {
    const p = new URLSearchParams(listParams);
    p.set("delete", String(id));
    return `/admin/ads?${p}`;
  };

  // Two-step delete: ?delete=<id> renders the confirm box with the seller's
  // charge for this ad surfaced (no refund happens on delete — that stays
  // admin judgement via Grant credits on the user's page).
  const confirmId = Number(params.delete);
  let confirmTarget: StoredAd | null = null;
  let chargeLine = "";
  if (Number.isInteger(confirmId) && confirmId > 0) {
    confirmTarget = await getAdRecord(confirmId);
    if (confirmTarget?.status === "deleted") confirmTarget = null; // already gone
    if (confirmTarget) {
      const ledger = await getLedger(confirmTarget.ownerPhone);
      const charge = ledger.find(
        (entry) =>
          entry.kind === "spend" &&
          (entry.note.includes(`Ad #${confirmId} (`) || entry.note.includes(`ad #${confirmId} (`)),
      );
      chargeLine = !charge
        ? "No charge is on record for this ad."
        : charge.delta < 0
          ? `The seller paid ${formatPrice(-charge.delta)} for this ad.`
          : "The seller used a legacy free ad pass for this ad.";
    }
  }

  return (
    <>
      <h1>
        All ads <Tip k="ads.list" />
      </h1>
      <p className="fine">
        Bump re-runs an ad free <Tip k="ads.bump" />, Edit changes the public text or
        category <Tip k="ads.edit" />, Delete removes without refunding or notifying{" "}
        <Tip k="ads.delete" />, and emailed-in pictures wait on their ad&apos;s row for
        your review <Tip k="ads.photoSubmissions" />.
      </p>
      {params.deleted && (
        <p className="notice" role="status">
          Deleted ad #{Number(params.deleted) || params.deleted}. It&apos;s off the website and
          out of the send queue; past batches and the message log keep its number.
        </p>
      )}
      {params.saved && (
        <p className="notice" role="status">
          Saved ad #{Number(params.saved) || params.saved}. The seller is not notified, and
          what they originally wrote is still on file.
        </p>
      )}
      {params.promoted && (
        <p className="notice" role="status">
          Ad #{Number(params.promoted) || params.promoted} is now a Featured spot in slot{" "}
          {params.slot}
          {params.billed
            ? `, and ${formatPrice(Number(params.billed) || 0)} came off the seller's balance.`
            : ", on the house — nothing was billed."}{" "}
          <Link href="/admin/featured">Arrange the slots</Link>.
        </p>
      )}
      {params.error === "promotenopic" && (
        <p className="form-error" role="alert">
          Ad #{Number(params.id) || params.id} has no picture, and a Featured spot is a
          picture — add one to the ad first, or build the spot by hand on{" "}
          <Link href="/admin/featured">Featured</Link>.
        </p>
      )}
      {params.error === "promotefunds" && (
        <p className="form-error" role="alert">
          Nothing was promoted and nothing was charged: the seller of ad #
          {Number(params.id) || params.id} is {formatPrice(Number(params.short) || 0)} short of
          the {formatPrice(featuredPrice)} featured price. Take payment on their{" "}
          <Link href={`/admin/users?phone=${params.phone ?? ""}`}>account</Link> first, or
          promote it on the house.
        </p>
      )}
      {params.error === "promotecharge" && (
        <p className="form-error" role="alert">
          Nothing was promoted — say whether to charge the seller or run it on the house.
        </p>
      )}
      {params.error === "promoteprice" && (
        <p className="form-error" role="alert">
          Nothing was promoted: the featured price is set to $0 on{" "}
          <Link href="/admin/settings">Settings</Link>, so there is nothing to charge. Set a
          price, or promote it on the house.
        </p>
      )}
      {params.error === "promotemigration" && (
        <p className="form-error" role="alert">
          Featured spots need migration 9956 — paste it, then try again. (Nothing was changed
          and nothing was charged.)
        </p>
      )}
      {params.error === "promotemissing" && (
        <p className="form-error" role="alert">
          Ad #{Number(params.id) || params.id} could not be found, so nothing was promoted.
        </p>
      )}
      {params.error === "emptybody" && (
        <p className="form-error" role="alert">
          Ad #{Number(params.id) || params.id} was left blank, so nothing was saved — an ad
          needs some text. To take it down, use <em>Delete this ad…</em> instead.
        </p>
      )}
      {params.error === "migration9987" && (
        <p className="form-error" role="alert">
          Deleting needs migration 9987 — paste supabase/migrations/9987_ad_delete.sql into the
          Supabase SQL editor, then try again. (Nothing was changed.)
        </p>
      )}
      {confirmTarget && (
        <section className="dev-notice" aria-label={`Confirm deleting ad #${confirmTarget.id}`}>
          <p className="myad-title">
            Delete ad #{confirmTarget.id} · {confirmTarget.status}
            {confirmTarget.photo && <span className="ad-sold"> 📷 Picture</span>} ·{" "}
            <Link href={`/admin/users?phone=${confirmTarget.ownerPhone}`}>
              {formatPhone(confirmTarget.ownerPhone)}
            </Link>
          </p>
          <p className="sim-body">{confirmTarget.body}</p>
          <p className="fine">
            {chargeLine} Deleting does <strong>not</strong> refund — if a refund is deserved,
            adjust the balance on the seller&apos;s page first. The seller is not notified. The ad leaves the
            website and the digest queue immediately
            {confirmTarget.photo ? ", and its photo is removed from storage" : ""}. Past digests
            and the message log keep the ad number. <Tip k="ads.delete" />
          </p>
          <form action={adminDeleteAd} className="sim-actions">
            <input type="hidden" name="id" value={confirmTarget.id} />
            <button className="btn btn-sm" type="submit">
              Delete ad #{confirmTarget.id}
            </button>
            <Link className="btn btn-sm btn-secondary" href={listHref}>
              Cancel
            </Link>
          </form>
        </section>
      )}
      <form className="search" action="/admin/ads" method="get">
        <label className="visually-hidden" htmlFor="q">
          Search ads
        </label>
        <input id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Search text or ad number…" />
        <label className="visually-hidden" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={status ?? ""} className="admin-select">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      {ads.length === 0 && <p>No ads match.</p>}
      <ul className="adcards">
        {ads.map((ad) => {
          const category = adCategories.get(ad.id);
          const submissions = submissionsByAd.get(ad.id) ?? [];
          const canBump =
            (ad.status === "approved" || ad.status === "expired") && !bumpQueued.has(ad.id);
          // Editable in every status but deleted (user decision, session 021).
          // A deleted ad has no public text left to change; everything else
          // does, including a held `unpaid` ad — the seller on the phone about
          // the ad they are one card away from running is the whole point.
          const canEdit = ad.status !== "deleted";
          // The operator's edits never overwrite the seller's own words, so
          // the two can be told apart afterwards. Shown inside the disclosure
          // rather than on the card: it matters when you are about to edit
          // again, and nowhere else.
          const edited = ad.originalBody.trim() !== ad.body.trim();
          const scope = editScope(ad.status);
          const sent = delivery.get(ad.id);
          // Every picture on the ad, in the order the site holds them. The
          // page used to say "📷 PICTURE" and show nothing, so the operator had
          // to open the public listing to see what a seller had actually sent
          // — on the one screen whose job is reviewing what goes out.
          // `textedAdPhotos` marks the leading few that ride SMS; the rest are
          // website-only extras, and the difference is what the seller paid
          // for, so it is labelled rather than left to be guessed.
          const pictures = [...(ad.photo ? [ad.photo] : []), ...(ad.morePhotos ?? [])];
          const textedCount = textedAdPhotos(ad.photo, ad.morePhotos).length;
          // A Featured spot IS a picture, so an ad without one has nothing to
          // promote — and only an ad that is actually live is worth sending
          // homepage traffic to. Offering the button on a rejected or held ad
          // would be offering to advertise a page that isn't there.
          const canPromote =
            textedCount > 0 &&
            (ad.status === "approved" || ad.status === "sold" || ad.status === "expired");
          // The head band is identity only; everything that is a detail about
          // the ad rather than a name for it collects on one muted line under
          // the text, so the top of a card reads as a heading and not a
          // sentence of run-together facts.
          const meta: string[] = [];
          if (withCategories) meta.push(category ? categoryLabel(category) : "Uncategorized");
          if (bumpQueued.has(ad.id)) meta.push("Bump queued for the next batch");
          return (
            <li key={ad.id} className="adcard">
              <div className="adcard-head">
                <span className="adcard-id">
                  {ad.status === "approved" || ad.status === "sold" || ad.status === "expired" ? (
                    <Link href={`/ad/${ad.id}`}>#{ad.id}</Link>
                  ) : (
                    <>#{ad.id}</>
                  )}
                </span>
                <span className={`adcard-tag${statusTone(ad.status)}`}>{ad.status}</span>
                {ad.photo && <span className="adcard-tag">📷 Picture</span>}
                {ad.flagged && <span className="adcard-tag adcard-tag--flag">⚑ Flagged</span>}
                <Link className="adcard-who" href={`/admin/users?phone=${ad.ownerPhone}`}>
                  {formatPhone(ad.ownerPhone)}
                </Link>
              </div>
              <div className="adcard-body">
                <div className="adcard-main">
                  {pictures.length > 0 && (
                    <div className="adcard-shots">
                      {pictures.map((picture, i) => (
                        <a
                          key={`${picture.src}-${i}`}
                          className="adcard-thumb"
                          href={picture.src}
                          target="_blank"
                          rel="noreferrer"
                          title={`Picture ${i + 1} — ${pictureRole(i, textedCount).title}. Open full size.`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={picture.src}
                            alt={picture.alt || `Picture ${i + 1} on ad #${ad.id}`}
                          />
                          {pictureRole(i, textedCount).tag && (
                            <span className="adcard-shot-tag">
                              {pictureRole(i, textedCount).tag}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="adcard-copy">
                    <p className="adcard-text">{ad.body}</p>
                    {meta.length > 0 && <p className="adcard-meta">{meta.join(" · ")}</p>}
                    {deliveryLines(sent, ad.status).map((line) => (
                      <p key={line} className="adcard-meta">
                        {line}
                      </p>
                    ))}
                    {ad.rejectedReason && (
                      <p className="adcard-meta">
                        Rejected ({ad.rejectionKind}): {ad.rejectedReason}
                      </p>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <details className="adcard-edit">
                    <summary>Edit text{withCategories ? " / category" : ""}</summary>
                    {scope && <p className="adcard-scope">{scope}</p>}
                    {edited && (
                      <p className="adcard-scope">
                        Edited. The seller wrote: <q>{ad.originalBody}</q>
                      </p>
                    )}
                    <form action={adminEditAd} className="review-form">
                      <input type="hidden" name="id" value={ad.id} />
                      <input type="hidden" name="back" value="/admin/ads" />
                      {/* Carried so a save returns to THIS filtered list. */}
                      <input type="hidden" name="q" value={params.q ?? ""} />
                      <input type="hidden" name="status" value={status ?? ""} />
                      <label className="visually-hidden" htmlFor={`edit-body-${ad.id}`}>
                        Ad text (editable)
                      </label>
                      <textarea id={`edit-body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
                      {withCategories && (
                        <p className="fine">
                          <label htmlFor={`edit-category-${ad.id}`}>Category </label>
                          <select
                            id={`edit-category-${ad.id}`}
                            name="category"
                            defaultValue={category ?? ""}
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
                        Save
                      </button>
                    </form>
                  </details>
                )}
                {submissions.map((submission) => {
                  const replaces = isPicReplaceSubmission(submission.fromEmail);
                  return (
                    <div key={submission.id} className="adcard-sub">
                      <p className="fine">
                        {replaces ? (
                          <>
                            <strong>Replacement listing picture</strong> awaiting review —{" "}
                            {submission.fromEmail}. Approving REPLACES the position-0 picture
                            that rides the digest and PIC replies (the old picture is removed).
                          </>
                        ) : (
                          <>
                            Submitted picture awaiting review — from {submission.fromEmail}.
                            {!ad.photo &&
                              " This ad has no MMS picture (text price paid); approving shows this on the website only — it never rides SMS/PIC."}
                          </>
                        )}
                      </p>
                      <a href={submission.src} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={submission.src}
                          alt={`Submitted for ad #${ad.id}`}
                          style={{ maxWidth: 160, maxHeight: 120 }}
                        />
                      </a>
                      <form action={adminResolvePhotoSubmission} className="sim-actions">
                        <input type="hidden" name="id" value={submission.id} />
                        <button className="btn btn-sm" name="decision" value="approve" type="submit">
                          {replaces
                            ? "Approve — replace the listing picture"
                            : "Approve — show on website"}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          name="decision"
                          value="discard"
                          type="submit"
                        >
                          Discard
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
              {ad.status !== "deleted" && (
                <div className="adcard-foot">
                  {canBump && (
                    <form action={adminQueueBump}>
                      <input type="hidden" name="id" value={ad.id} />
                      <input type="hidden" name="back" value="/admin/ads" />
                      <input type="hidden" name="q" value={params.q ?? ""} />
                      <input type="hidden" name="status" value={status ?? ""} />
                      <button className="btn btn-sm btn-secondary" type="submit">
                        Bump — run in the next batch{ad.status === "expired" ? " (relists)" : ""}
                      </button>
                    </form>
                  )}
                  {canPromote && (
                    <details className="adcard-promote">
                      <summary>Promote to Featured…</summary>
                      <form action={adminPromoteAdToFeatured} className="review-form">
                        <input type="hidden" name="id" value={ad.id} />
                        <input type="hidden" name="back" value="/admin/ads" />
                        <input type="hidden" name="q" value={params.q ?? ""} />
                        <input type="hidden" name="status" value={status ?? ""} />
                        <p className="fine">
                          Builds a Featured spot from this ad: its broadcast picture, its
                          first line as the caption, linking to /ad/{ad.id}.
                        </p>
                        <p className="fine">
                          <label htmlFor={`promote-slot-${ad.id}`}>Slot </label>
                          <select
                            id={`promote-slot-${ad.id}`}
                            name="slot"
                            className="admin-select"
                            defaultValue="1"
                          >
                            {[1, 2, 3, 4].map((s) => (
                              <option key={s} value={s}>
                                {s} — {s <= 2 ? "left" : "right"} column,{" "}
                                {s % 2 === 1 ? "top" : "bottom"}
                              </option>
                            ))}
                          </select>{" "}
                          <label htmlFor={`promote-order-${ad.id}`}>Order </label>
                          <select
                            id={`promote-order-${ad.id}`}
                            name="position"
                            className="admin-select"
                            defaultValue="1"
                          >
                            {[1, 2, 3].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </p>
                        {/* No default. Whether this is a $199 sale or a favour is
                            the operator's call, and guessing it wrong puts a
                            number in /admin/money that nobody will catch. */}
                        <div className="sim-actions">
                          <button className="btn btn-sm" name="charge" value="bill" type="submit">
                            Charge {formatPrice(featuredPrice)} to the seller
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            name="charge"
                            value="free"
                            type="submit"
                          >
                            On the house — bill nothing
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                  <Link className="adcard-delete" href={deleteHref(ad.id)}>
                    Delete this ad…
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
