import type { Metadata } from "next";
import Link from "next/link";
import {
  adminDeleteAd,
  adminEditAd,
  adminQueueBump,
  adminResolvePhotoSubmission,
} from "@/lib/admin-actions";
import {
  getAdRecord,
  getAllAds,
  getQueuedBumps,
  listPhotoSubmissions,
  type PhotoSubmission,
  type StoredAd,
  type StoredAdStatus,
} from "@/lib/engine-store";
import { getLedger } from "@/lib/store";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `All ads — ${site.name} admin`,
};

const STATUSES: StoredAdStatus[] = ["pending", "approved", "rejected", "sold", "expired", "deleted"];

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
          ? `The seller paid ${-charge.delta} credit${-charge.delta === 1 ? "" : "s"} for this ad.`
          : "The seller used a free ad pass for this ad.";
    }
  }

  return (
    <>
      <h1>All ads</h1>
      {params.deleted && (
        <p className="notice" role="status">
          Deleted ad #{Number(params.deleted) || params.deleted}. It&apos;s off the website and
          out of the digests; past digests and the message log keep its number.
        </p>
      )}
      {params.error === "migration0013" && (
        <p className="form-error" role="alert">
          Deleting needs migration 0013 — paste supabase/migrations/0013_ad_delete.sql into the
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
            {chargeLine} Deleting does <strong>not</strong> refund — if a refund is deserved, grant
            credits on the seller&apos;s page first. The seller is not notified. The ad leaves the
            website and the digest queue immediately
            {confirmTarget.photo ? ", and its photo is removed from storage" : ""}. Past digests
            and the message log keep the ad number.
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
      <ul className="myads">
        {ads.map((ad) => (
          <li key={ad.id} className="myad-row">
            <p className="myad-title">
              {ad.status === "approved" || ad.status === "sold" || ad.status === "expired" ? (
                <Link href={`/ad/${ad.id}`}>#{ad.id}</Link>
              ) : (
                <>#{ad.id}</>
              )}{" "}
              · {ad.status}
              {ad.flagged && <span className="ad-sold"> Flagged</span>}
              {ad.photo && <span className="ad-sold"> 📷 Picture</span>} ·{" "}
              <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
              {bumpQueued.has(ad.id) && <span className="status-muted"> · bump queued</span>}
            </p>
            <p className="sim-body">{ad.body}</p>
            {ad.rejectedReason && (
              <p className="myad-dates">
                Rejected ({ad.rejectionKind}): {ad.rejectedReason}
              </p>
            )}
            {(ad.status === "approved" || ad.status === "expired") && !bumpQueued.has(ad.id) && (
              <form action={adminQueueBump} className="sim-actions">
                <input type="hidden" name="id" value={ad.id} />
                <input type="hidden" name="back" value="/admin/ads" />
                <button className="btn btn-sm btn-secondary" type="submit">
                  Bump — run in next digest{ad.status === "expired" ? " (relists)" : ""}
                </button>
              </form>
            )}
            {(ad.status === "pending" || ad.status === "approved" || ad.status === "expired") && (
              <details>
                <summary className="fine">Edit text</summary>
                <form action={adminEditAd} className="review-form">
                  <input type="hidden" name="id" value={ad.id} />
                  <input type="hidden" name="back" value="/admin/ads" />
                  <label className="visually-hidden" htmlFor={`edit-body-${ad.id}`}>
                    Ad text (editable)
                  </label>
                  <textarea id={`edit-body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
                  <button className="btn btn-sm" type="submit">
                    Save text
                  </button>
                </form>
              </details>
            )}
            {(submissionsByAd.get(ad.id) ?? []).map((submission) => (
              <div key={submission.id} className="dev-notice">
                <p className="fine">
                  Emailed-in picture awaiting review — from {submission.fromEmail}.
                  {!ad.photo &&
                    " This ad has no MMS picture (text price paid); approving shows this on the website only — it never rides SMS/PIC."}
                </p>
                <a href={submission.src} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={submission.src}
                    alt={`Submitted for ad #${ad.id}`}
                    style={{ maxWidth: 160, maxHeight: 120, border: "1px solid #ccc" }}
                  />
                </a>
                <form action={adminResolvePhotoSubmission} className="sim-actions">
                  <input type="hidden" name="id" value={submission.id} />
                  <button className="btn btn-sm" name="decision" value="approve" type="submit">
                    Approve — show on website
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
            ))}
            {ad.status !== "deleted" && (
              <p className="fine">
                <Link href={deleteHref(ad.id)}>Delete this ad…</Link>
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
