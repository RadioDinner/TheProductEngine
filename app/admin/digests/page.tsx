import type { Metadata } from "next";
import Link from "next/link";
import {
  adminDelayAd,
  adminEditAd,
  adminMoveAd,
  adminReleaseAd,
  adminRevertAd,
  adminSendDigest,
} from "@/lib/admin-actions";
import { selectDigestItems, nextSlotOccurrence } from "@/lib/digest-engine";
import {
  listHeldNewAds,
  listRecentDigests,
  queuedOutboxCount,
  type StoredAd,
} from "@/lib/engine-store";
import { getEngineSettings } from "@/lib/settings";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Digests — ${site.name} admin`,
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function slotLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? "AM" : "PM"} ET`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function AdRow({
  ad,
  kind,
  position,
  count,
}: {
  ad: StoredAd;
  kind: "new" | "bump";
  position: number;
  count: number;
}) {
  return (
    <li className="myad-row">
      <p className="myad-title">
        #{ad.id} from{" "}
        <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
        <span className="status-muted"> · {kind === "new" ? "new ad" : "bump"}</span>
        {ad.photo && <span className="ad-sold"> 📷 Picture</span>}
      </p>
      <form action={adminEditAd} className="review-form">
        <input type="hidden" name="id" value={ad.id} />
        <input type="hidden" name="back" value="/admin/digests" />
        <label className="visually-hidden" htmlFor={`digest-body-${ad.id}`}>
          Ad text (editable)
        </label>
        <textarea id={`digest-body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
        <button className="btn btn-sm" type="submit">
          Save text
        </button>
      </form>
      {kind === "new" && (
        <div className="sim-actions">
          {position > 0 && (
            <form action={adminMoveAd}>
              <input type="hidden" name="id" value={ad.id} />
              <input type="hidden" name="dir" value="up" />
              <button className="btn btn-sm btn-secondary" type="submit">
                ↑ Move up
              </button>
            </form>
          )}
          {position < count - 1 && (
            <form action={adminMoveAd}>
              <input type="hidden" name="id" value={ad.id} />
              <input type="hidden" name="dir" value="down" />
              <button className="btn btn-sm btn-secondary" type="submit">
                ↓ Move down
              </button>
            </form>
          )}
          <form action={adminDelayAd}>
            <input type="hidden" name="id" value={ad.id} />
            <button className="btn btn-sm btn-secondary" type="submit">
              Skip next digest
            </button>
          </form>
          <form action={adminRevertAd}>
            <input type="hidden" name="id" value={ad.id} />
            <button className="btn btn-sm btn-secondary" type="submit">
              Back to review
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

export default async function AdminDigests({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; items?: string; to?: string; emails?: string; senderror?: string }>;
}) {
  const params = await searchParams;
  const settings = await getEngineSettings();
  const { newAds, bumpAds } = await selectDigestItems(settings.digestCap);
  const held = await listHeldNewAds();
  const queued = await queuedOutboxCount();
  const history = await listRecentDigests(14);

  const slots = [...settings.slots].sort((a, b) => a - b);
  const next = nextSlotOccurrence(slots);
  const nextSlotLabel = next
    ? `${slotLabel(next.slot)} (${next.day})`
    : "no slots configured";

  const total = newAds.length + bumpAds.length;

  return (
    <>
      <h1>Digests</h1>
      {params.sent && (
        <p className="fine">
          ✓ Sent the {params.sent === "extra" ? "extra edition" : "digest early"}: {params.items}{" "}
          ad{params.items === "1" ? "" : "s"} to {params.to} text subscriber
          {params.to === "1" ? "" : "s"} and {params.emails} email subscriber
          {params.emails === "1" ? "" : "s"}.
        </p>
      )}
      {params.senderror && <p className="fine">✗ Not sent: {params.senderror}</p>}
      <p>
        Slots: {slots.length ? slots.map(slotLabel).join(", ") : "none"} (email edition goes out at
        the same times) · next digest composes at <strong>{nextSlotLabel}</strong> · capacity{" "}
        {settings.digestCap} ads per digest
        {queued > 0 && (
          <>
            {" "}
            · <strong>{queued} queued deliveries still draining</strong>
          </>
        )}
      </p>

      <h2>Queued for the next digest ({total})</h2>
      {total === 0 && (
        <p>
          Nothing waiting — approved ads that haven&apos;t broadcast yet and queued bumps appear
          here. (An empty slot sends nothing.)
        </p>
      )}
      {total > 0 && (
        <>
          <p className="fine">
            New ads run first (top to bottom below); bumps fill what&apos;s left. Edits save the
            public text — the seller&apos;s original stays in the audit record.
          </p>
          <ul className="sim-pending">
            {newAds.map((ad, i) => (
              <AdRow key={ad.id} ad={ad} kind="new" position={i} count={newAds.length} />
            ))}
            {bumpAds.map((ad) => (
              <AdRow key={ad.id} ad={ad} kind="bump" position={0} count={1} />
            ))}
          </ul>
          <div className="sim-actions">
            <form action={adminSendDigest}>
              <input type="hidden" name="edition" value="early" />
              <button className="btn btn-sm" type="submit">
                Send early — this IS the {next ? slotLabel(next.slot) : "next"} digest, sent now
              </button>
            </form>
            <form action={adminSendDigest}>
              <input type="hidden" name="edition" value="extra" />
              <button className="btn btn-sm btn-secondary" type="submit">
                Send extra — sends now AND the queue still runs at {next ? slotLabel(next.slot) : "the next slot"}
              </button>
            </form>
          </div>
        </>
      )}
      <p className="fine">
        Need to add something? Queue a bump from the{" "}
        <Link href="/admin/ads?status=approved">Ads tab</Link>{" "}
        <span className="status-muted">(bumps here ride the next digest after new ads)</span>.
      </p>

      {held.length > 0 && (
        <>
          <h2>Held — skipping the next digest ({held.length})</h2>
          <ul className="sim-pending">
            {held.map((ad) => (
              <li key={ad.id} className="myad-row">
                <p className="myad-title">
                  #{ad.id} from{" "}
                  <Link href={`/admin/users?phone=${ad.ownerPhone}`}>
                    {formatPhone(ad.ownerPhone)}
                  </Link>
                  <span className="status-muted">
                    {" "}
                    · returns to the queue {ad.holdUntil ? stamp(ad.holdUntil) : "soon"}
                  </span>
                </p>
                <p className="sim-body">{ad.body}</p>
                <form action={adminReleaseAd} className="sim-actions">
                  <input type="hidden" name="id" value={ad.id} />
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Release now
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Recent digests</h2>
      {history.length === 0 && <p>No digests composed yet.</p>}
      {history.length > 0 && (
        <ul className="myads">
          {history.map((d) => (
            <li key={d.id} className="myad-row">
              <p className="myad-title">
                {d.slotKey} <span className="status-muted">· {d.channel}</span> · {d.itemCount} ad
                {d.itemCount === 1 ? "" : "s"}
                <span className="status-muted">
                  {" "}
                  · {d.sentAt ? `composed ${stamp(d.sentAt)}` : "not finalized"}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
