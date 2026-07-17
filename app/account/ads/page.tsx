import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  addMyExtras,
  bumpMine,
  deleteMine,
  markMineSold,
  replaceMyPic,
} from "@/lib/myads-actions";
import { readSession } from "@/lib/session";
import {
  adEverBroadcast,
  getAdRecord,
  getPendingAds,
  getQueuedBumps,
  listPhotoSubmissions,
  photoSubmissionsSupported,
  type PhotoSubmission,
  type StoredAd,
} from "@/lib/engine-store";
import { adExpiresAt, deriveTitle, listAdsByOwner, type Ad } from "@/lib/ads";
import { getLedger } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import {
  deleteRefundDecision,
  findAdCharge,
  findUnrefundedBumpCharge,
  hasBenignRejectRefund,
  isPicReplaceSubmission,
} from "@/lib/myads";
import { MAX_PHOTOS_PER_AD } from "@/lib/email-photos";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `My ads — ${site.name}`,
  robots: { index: false },
};

const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

function shortDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function MyAdsPage({
  searchParams,
}: {
  searchParams: Promise<{
    delete?: string;
    deleted?: string;
    refund?: string;
    amount?: string;
    bumprefund?: string;
    why?: string;
    sold?: string;
    buyer?: string;
    rate?: string;
    bump?: string;
    cost?: string;
    pic?: string;
    extras?: string;
    extraskip?: string;
    error?: string;
    id?: string;
  }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fads");
  const phone = session.phone;

  const params = await searchParams;
  const settings = await getEngineSettings();
  // listAdsByOwner excludes pending — merge the review queue's rows for this
  // number so a just-posted ad is manageable too (same as SMS MYADS).
  const pendingAds = (await getPendingAds()).filter((ad) => ad.ownerPhone === phone);
  const myAds = await listAdsByOwner(phone);
  const bumpQueued = new Set((await getQueuedBumps()).map((b) => b.adId));
  // Picture actions degrade away entirely when migration 9985 is missing.
  const picsSupported = await photoSubmissionsSupported();
  const myAdIds = new Set([...pendingAds.map((a) => a.id), ...myAds.map((a) => a.id)]);
  const mySubmissions: PhotoSubmission[] = picsSupported
    ? (await listPhotoSubmissions()).filter((s) => myAdIds.has(s.adId))
    : [];
  const extrasPending = new Map<number, number>();
  const replaceWaiting = new Set<number>();
  for (const s of mySubmissions) {
    if (isPicReplaceSubmission(s.fromEmail)) replaceWaiting.add(s.adId);
    else extrasPending.set(s.adId, (extrasPending.get(s.adId) ?? 0) + 1);
  }
  const subsCount = new Map<number, number>();
  for (const s of mySubmissions) subsCount.set(s.adId, (subsCount.get(s.adId) ?? 0) + 1);

  // ---- two-step delete: ?delete=<id> renders the confirm box, which states
  // EXACTLY what happens to the money (the user's refund matrix) before the
  // real POST. Ownership is re-checked here AND in the action.
  const confirmId = Number(params.delete);
  let confirmAd: StoredAd | null = null;
  let confirmMoney = "";
  if (Number.isInteger(confirmId) && confirmId > 0) {
    const target = await getAdRecord(confirmId);
    if (target && target.ownerPhone === phone && target.status !== "deleted") {
      confirmAd = target;
      const decision = deleteRefundDecision(target.status, await adEverBroadcast(target.id));
      const ledger = await getLedger(phone);
      const charge = findAdCharge(ledger, target.id);
      if (!decision.refund) {
        confirmMoney =
          decision.reason === "ran"
            ? "This ad already ran in a digest, so there is no refund — deleting just takes it off the website and out of future digests."
            : decision.reason === "rejected"
              ? "This ad was not accepted; any refund due was handled at rejection time. Deleting returns nothing more."
              : "This ad is closed (sold or ended), so there is no refund — deleting just takes it off the website.";
      } else if (hasBenignRejectRefund(ledger, target.id)) {
        confirmMoney = "This ad's charge was already refunded once, so deleting returns nothing more.";
      } else if (charge && charge.delta < 0) {
        confirmMoney = `This ad hasn't run in any digest yet. Delete it and your ${credits(-charge.delta)} come${-charge.delta === 1 ? "s" : ""} back.`;
      } else if (charge) {
        confirmMoney =
          "This ad hasn't run in any digest yet. Delete it and your free ad pass comes back.";
      } else {
        confirmMoney = "No charge is on record for this ad, so there's nothing to refund.";
      }
      // A still-queued PAID bump is refunded on delete regardless of the ad
      // matrix — the re-broadcast never happens (deleteMine mirrors this).
      const bumpCharge = bumpQueued.has(target.id)
        ? findUnrefundedBumpCharge(ledger, target.id)
        : undefined;
      if (bumpCharge) {
        confirmMoney += ` Your scheduled bump hasn't run yet either, so its ${credits(-bumpCharge.delta)} come${-bumpCharge.delta === 1 ? "s" : ""} back too.`;
      }
    }
  }

  const deletedId = Number(params.deleted);
  const extrasSaved = /^\d+$/.test(params.extras ?? "") ? Number(params.extras) : null;

  return (
    <div className="container account">
      <h1>My ads</h1>
      <p>
        Everything you can do by text — SOLD, BUMP, new pictures, delete — right here.{" "}
        <Link className="btn btn-sm" href="/account/post">
          Post a new ad
        </Link>
      </p>

      {/* ---------- outcome notices (redirect-with-query-params) ---------- */}
      {Number.isInteger(deletedId) && deletedId > 0 && (
        <p className="notice" role="status">
          Ad #{deletedId} is deleted — it&rsquo;s off the website and out of the digests.{" "}
          {params.refund === "credits" && (
            <>Your {credits(Number(params.amount) || 0)} came back — see your{" "}
            <Link href="/account#credits">credit history</Link>.</>
          )}
          {params.refund === "pass" && <>Your free ad pass came back.</>}
          {params.refund === "none" && (
            <>Its charge was already refunded (or none was on record), so nothing more was returned.</>
          )}
          {params.refund === "no" &&
            (params.why === "ran"
              ? "It had already run in a digest, so there's no refund."
              : "It was already closed, so there's no refund.")}
          {Number(params.bumprefund) > 0 && (
            <>
              {" "}
              Its scheduled bump never ran, so those {credits(Number(params.bumprefund))} came
              back too.
            </>
          )}
        </p>
      )}
      {params.sold === "done" && (
        <p className="notice" role="status">
          Ad #{params.id} is marked <strong>sold</strong>. Congratulations!{" "}
          {params.buyer === "recorded" && (
            <>The sale is on record — we texted your buyer an invitation to rate you, and you
            can rate them by texting <strong>RATE 1&ndash;5</strong> to {site.smsNumber}.</>
          )}
          {params.rate === "off" && <>(Ratings aren&rsquo;t available just yet.)</>}
        </p>
      )}
      {params.sold === "already" && (
        <p className="notice" role="status">
          Ad #{params.id} is already marked sold.
        </p>
      )}
      {params.sold === "pending" && (
        <p className="form-error" role="alert">
          Ad #{params.id} is still waiting for review — you can mark it sold once it&rsquo;s
          approved.
        </p>
      )}
      {params.bump === "queued" && (
        <p className="notice" role="status">
          Ad #{params.id} will run again in the next digest.
        </p>
      )}
      {params.bump === "relisted" && (
        <p className="notice" role="status">
          Ad #{params.id} is relisted and will run again in the next digest.
        </p>
      )}
      {params.bump === "already" && (
        <p className="notice" role="status">
          You already have a bump scheduled for ad #{params.id}.
        </p>
      )}
      {params.bump === "nofunds" && (
        <p className="form-error" role="alert">
          A bump costs {credits(Number(params.cost) || 0)} and you don&rsquo;t have enough —{" "}
          <Link href="/account#credits">buy credits</Link> and try again.
        </p>
      )}
      {params.bump === "sold" && (
        <p className="form-error" role="alert">
          Ad #{params.id} is marked sold — nothing to bump.
        </p>
      )}
      {params.bump === "pending" && (
        <p className="form-error" role="alert">
          Ad #{params.id} is still waiting for review — it runs automatically once approved.
        </p>
      )}
      {params.pic === "submitted" && (
        <p className="notice" role="status">
          Your replacement picture is in for review. Once approved, it becomes the picture
          that rides the digest and PIC replies for ad #{params.id}.
        </p>
      )}
      {params.pic === "waiting" && (
        <p className="form-error" role="alert">
          A replacement picture for ad #{params.id} is already waiting for review — one at a
          time.
        </p>
      )}
      {params.pic === "badphoto" && (
        <p className="form-error" role="alert">
          That picture couldn&rsquo;t be used — jpg, png, gif, or webp up to 8 MB.
        </p>
      )}
      {params.pic === "nostore" && (
        <p className="form-error" role="alert">
          We couldn&rsquo;t save that picture just now — try again later, or call{" "}
          {site.supportPhone} for help.
        </p>
      )}
      {(params.pic === "nopic" || params.pic === "notlive") && (
        <p className="form-error" role="alert">
          That ad can&rsquo;t take a replacement picture.
        </p>
      )}
      {(params.pic === "unsupported" || params.extras === "unsupported") && (
        <p className="form-error" role="alert">
          Picture changes aren&rsquo;t available just yet — try again later.
        </p>
      )}
      {extrasSaved !== null && (
        <p className="notice" role="status">
          {extrasSaved === 1 ? "1 extra picture" : `${extrasSaved} extra pictures`} went in for
          review — once approved they appear in your ad&rsquo;s website gallery only (they
          never ride the text digest).
          {Number(params.extraskip) > 0 &&
            ` ${params.extraskip} couldn't be used — jpg, png, gif, or webp up to 8 MB, at most ${MAX_PHOTOS_PER_AD} pictures per ad.`}
        </p>
      )}
      {params.extras === "noroom" && (
        <p className="form-error" role="alert">
          Ad #{params.id} already has {MAX_PHOTOS_PER_AD} pictures (counting ones in review) —
          that&rsquo;s the limit.
        </p>
      )}
      {(params.extras === "none" || params.extras === "notlive") && (
        <p className="form-error" role="alert">
          No pictures were added.
        </p>
      )}
      {params.error === "notyours" && (
        <p className="form-error" role="alert">
          That ad isn&rsquo;t on this account.
        </p>
      )}
      {params.error === "gone" && (
        <p className="form-error" role="alert">
          Ad #{params.id} was removed and is no longer listed.
        </p>
      )}
      {params.error === "rejected" && (
        <p className="form-error" role="alert">
          Ad #{params.id} was not accepted, so there&rsquo;s nothing to do with it.
        </p>
      )}
      {params.error === "badbuyer" && (
        <p className="form-error" role="alert">
          That buyer&rsquo;s phone number doesn&rsquo;t look right — use 10 digits, like
          330-555-0142. Nothing was changed; fix it and try again (or leave it blank).
        </p>
      )}
      {params.error === "selfbuyer" && (
        <p className="form-error" role="alert">
          That&rsquo;s your own number — enter the BUYER&rsquo;s phone number, or leave it
          blank. Nothing was changed.
        </p>
      )}
      {params.error === "unsupported" && (
        <p className="form-error" role="alert">
          Deleting isn&rsquo;t available just yet — try again later, or call{" "}
          {site.supportPhone} for help. (Nothing was changed.)
        </p>
      )}

      {/* ---------- the delete confirmation (two-step) ---------- */}
      {confirmAd && (
        <section className="dev-notice" aria-label={`Confirm deleting ad #${confirmAd.id}`}>
          <p className="myad-title">
            Delete ad #{confirmAd.id} — {deriveTitle(confirmAd.body)}?
          </p>
          <p>{confirmMoney}</p>
          <p className="fine">
            Deleting also removes the ad&rsquo;s pictures and drops any scheduled bump (a
            paid bump that never ran is refunded). Past digests keep the ad number. This
            can&rsquo;t be undone.
          </p>
          <form action={deleteMine} className="sim-actions">
            <input type="hidden" name="id" value={confirmAd.id} />
            <button className="btn btn-sm" type="submit">
              Delete ad #{confirmAd.id}
            </button>
            <Link className="btn btn-sm btn-secondary" href="/account/ads">
              Cancel
            </Link>
          </form>
        </section>
      )}

      {/* ---------- the ads ---------- */}
      {pendingAds.length === 0 && myAds.length === 0 ? (
        <p>
          No ads on this account yet. <Link href="/account/post">Post one on the website</Link>,
          or text <strong>AD NEW</strong> and your ad to <strong>{site.smsNumber}</strong>.
        </p>
      ) : (
        <ul className="myads">
          {pendingAds.map((ad) => (
            <li key={`pending-${ad.id}`} className="myad-row">
              <p className="myad-title">
                #{ad.id} — {deriveTitle(ad.body)}{" "}
                <span className="status-muted">Waiting for review</span>
                {ad.photo && <span className="status-muted"> · 📷 picture</span>}
              </p>
              <p className="myad-dates">
                Submitted {shortDate(ad.createdAt)} — you&rsquo;ll get a text when it&rsquo;s
                approved. Marking sold and bumping open up after approval.
              </p>
              {(extrasPending.get(ad.id) ?? 0) > 0 && (
                <p className="fine">
                  {extrasPending.get(ad.id)} extra picture
                  {extrasPending.get(ad.id) === 1 ? "" : "s"} awaiting review.
                </p>
              )}
              {picsSupported &&
                MAX_PHOTOS_PER_AD -
                  ((ad.photo ? 1 : 0) + (ad.morePhotos?.length ?? 0) + (subsCount.get(ad.id) ?? 0)) >
                  0 && (
                  <details>
                    <summary className="fine">Add extra pictures (website only)…</summary>
                    <form action={addMyExtras}>
                      <input type="hidden" name="id" value={ad.id} />
                      <div className="field">
                        <label htmlFor={`extras-${ad.id}`}>
                          Extra pictures — website gallery only, reviewed first, free
                        </label>
                        <input
                          id={`extras-${ad.id}`}
                          name="extras"
                          type="file"
                          accept="image/*"
                          multiple
                        />
                      </div>
                      <button className="btn btn-sm" type="submit">
                        Send for review
                      </button>
                    </form>
                  </details>
                )}
              <p className="fine">
                <Link href={`/account/ads?delete=${ad.id}`}>Delete this ad…</Link>
              </p>
            </li>
          ))}
          {myAds.map((ad) => {
            const sold = ad.status === "sold";
            const expired = ad.status === "expired";
            const available = ad.status === "available";
            const livePhotos = ad.photos?.length ?? (ad.photo ? 1 : 0);
            const room = Math.max(
              0,
              MAX_PHOTOS_PER_AD - (livePhotos + (subsCount.get(ad.id) ?? 0)),
            );
            return (
              <li key={ad.id} className="myad-row">
                <p className="myad-title">
                  <Link href={`/ad/${ad.id}`}>
                    #{ad.id} — {deriveTitle(ad.body)}
                  </Link>{" "}
                  <span
                    className={
                      sold ? "ad-sold" : expired ? "status-muted" : "status-available"
                    }
                  >
                    {sold ? "Sold" : expired ? "Ended" : "Available"}
                  </span>
                  {ad.photo && <span className="status-muted"> · 📷 picture</span>}
                  {bumpQueued.has(ad.id) && (
                    <span className="status-muted"> · bump scheduled</span>
                  )}
                </p>
                <p className="myad-dates">
                  Posted {shortDate(ad.approvedAt)}
                  {available && ` · runs through ${shortDate(adExpiresAt(ad))}`}
                  {expired && ` · ended ${shortDate(adExpiresAt(ad))}`}
                </p>
                {replaceWaiting.has(ad.id) && (
                  <p className="fine">A replacement listing picture is awaiting review.</p>
                )}
                {(extrasPending.get(ad.id) ?? 0) > 0 && (
                  <p className="fine">
                    {extrasPending.get(ad.id)} extra picture
                    {extrasPending.get(ad.id) === 1 ? "" : "s"} awaiting review.
                  </p>
                )}

                {(available || expired) && (
                  <details>
                    <summary className="fine">Mark sold…</summary>
                    <form action={markMineSold}>
                      <input type="hidden" name="id" value={ad.id} />
                      <div className="field">
                        <label htmlFor={`buyer-${ad.id}`}>
                          Buyer&rsquo;s phone (optional — puts the sale on record so you can
                          rate each other; they&rsquo;re invited by text)
                        </label>
                        <div className="inline-fields">
                          <input
                            id={`buyer-${ad.id}`}
                            name="buyer"
                            type="tel"
                            placeholder="330-555-0142"
                          />
                          <button className="btn btn-sm" type="submit">
                            Mark sold
                          </button>
                        </div>
                      </div>
                    </form>
                  </details>
                )}

                {(available || expired) && !bumpQueued.has(ad.id) && (
                  <form action={bumpMine} className="sim-actions">
                    <input type="hidden" name="id" value={ad.id} />
                    <button className="btn btn-sm btn-secondary" type="submit">
                      Bump — run again in the next digest
                      {expired ? " (relists)" : ""}
                      {settings.bumpCost > 0 ? ` — ${credits(settings.bumpCost)}` : ""}
                    </button>
                  </form>
                )}

                {picsSupported && available && ad.photo && !replaceWaiting.has(ad.id) && (
                  <details>
                    <summary className="fine">Change the listing picture…</summary>
                    <form action={replaceMyPic}>
                      <input type="hidden" name="id" value={ad.id} />
                      <div className="field">
                        <label htmlFor={`pic-${ad.id}`}>
                          New listing picture — reviewed first, then it replaces the picture
                          that rides the digest and PIC replies
                        </label>
                        <input id={`pic-${ad.id}`} name="photo" type="file" accept="image/*" />
                      </div>
                      <button className="btn btn-sm" type="submit">
                        Send for review
                      </button>
                    </form>
                  </details>
                )}

                {picsSupported && available && room > 0 && (
                  <details>
                    <summary className="fine">Add extra pictures (website only)…</summary>
                    <form action={addMyExtras}>
                      <input type="hidden" name="id" value={ad.id} />
                      <div className="field">
                        <label htmlFor={`extras-${ad.id}`}>
                          Extra pictures — website gallery only, reviewed first, free (room for{" "}
                          {room} more)
                        </label>
                        <input
                          id={`extras-${ad.id}`}
                          name="extras"
                          type="file"
                          accept="image/*"
                          multiple
                        />
                      </div>
                      <button className="btn btn-sm" type="submit">
                        Send for review
                      </button>
                    </form>
                  </details>
                )}

                <p className="fine">
                  <Link href={`/account/ads?delete=${ad.id}`}>Delete this ad…</Link>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="fine">
        Deleting an ad that hasn&rsquo;t been approved yet — or was approved but never ran in a
        digest — returns what you paid (credits or a free ad pass). Once an ad has ridden a
        digest, the run is spent and deleting doesn&rsquo;t refund. See the{" "}
        <Link href="/refund-policy">refund policy</Link>.
      </p>

      <p>
        <Link href="/account">← Back to your account</Link>
      </p>
    </div>
  );
}
