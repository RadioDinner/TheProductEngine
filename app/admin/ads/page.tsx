import type { Metadata } from "next";
import Link from "next/link";
import {
  adminDeleteAd,
  adminEditAd,
  adminQueueBump,
  adminResolvePhotoSubmission,
} from "@/lib/admin-actions";
import {
  getAdCategories,
  getAdRecord,
  getAllAds,
  getQueuedBumps,
  listPhotoSubmissions,
  type PhotoSubmission,
  type StoredAd,
  type StoredAdStatus,
} from "@/lib/engine-store";
import { categoriesSupported, getLedger } from "@/lib/store";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { isPicReplaceSubmission } from "@/lib/myads";
import { formatPhone } from "@/lib/phone";
import { formatPrice, site } from "@/lib/config";
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

export default async function AdminAds({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; delete?: string; deleted?: string; error?: string }>;
}) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as StoredAdStatus)
    ? (params.status as StoredAdStatus)
    : undefined;
  const ads = await getAllAds(params.q, status);
  const bumpQueued = new Set((await getQueuedBumps()).map((b) => b.adId));
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
          out of the digests; past digests and the message log keep its number.
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
          const canEdit =
            ad.status === "pending" || ad.status === "approved" || ad.status === "expired";
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
                <p className="adcard-text">{ad.body}</p>
                {meta.length > 0 && <p className="adcard-meta">{meta.join(" · ")}</p>}
                {ad.rejectedReason && (
                  <p className="adcard-meta">
                    Rejected ({ad.rejectionKind}): {ad.rejectedReason}
                  </p>
                )}
                {canEdit && (
                  <details className="adcard-edit">
                    <summary>Edit text{withCategories ? " / category" : ""}</summary>
                    <form action={adminEditAd} className="review-form">
                      <input type="hidden" name="id" value={ad.id} />
                      <input type="hidden" name="back" value="/admin/ads" />
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
                      <button className="btn btn-sm btn-secondary" type="submit">
                        Bump — run in next digest{ad.status === "expired" ? " (relists)" : ""}
                      </button>
                    </form>
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
