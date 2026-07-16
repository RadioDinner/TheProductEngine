import type { Metadata } from "next";
import Link from "next/link";
import { adminEditAd } from "@/lib/admin-actions";
import { selectDigestItems } from "@/lib/digest-engine";
import { listRecentDigests, queuedOutboxCount, type StoredAd } from "@/lib/engine-store";
import { getEngineSettings } from "@/lib/settings";
import { etParts } from "@/lib/et";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Digests — ${site.name} admin`,
};

export const dynamic = "force-dynamic";

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

function AdRow({ ad, kind }: { ad: StoredAd; kind: "new" | "bump" }) {
  return (
    <li className="myad-row">
      <p className="myad-title">
        #{ad.id} from <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
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
    </li>
  );
}

export default async function AdminDigests() {
  const settings = await getEngineSettings();
  const { newAds, bumpAds } = await selectDigestItems(settings.digestCap);
  const queued = await queuedOutboxCount();
  const history = await listRecentDigests(14);

  const { hour } = etParts(new Date());
  const slots = [...settings.slots].sort((a, b) => a - b);
  const nextSlot = slots.find((s) => s > hour);
  const nextSlotLabel =
    nextSlot !== undefined
      ? `today at ${slotLabel(nextSlot)}`
      : slots.length
        ? `tomorrow at ${slotLabel(slots[0])}`
        : "no slots configured";

  const total = newAds.length + bumpAds.length;

  return (
    <>
      <h1>Digests</h1>
      <p>
        Slots: {slots.length ? slots.map(slotLabel).join(", ") : "none"} (email edition goes out at
        the same times) · next digest composes <strong>{nextSlotLabel}</strong> · capacity{" "}
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
            New ads run first (oldest approval first); bumps fill what&apos;s left. Edits save the
            public text — the seller&apos;s original stays in the audit record.
          </p>
          <ul className="sim-pending">
            {newAds.map((ad) => (
              <AdRow key={ad.id} ad={ad} kind="new" />
            ))}
            {bumpAds.map((ad) => (
              <AdRow key={ad.id} ad={ad} kind="bump" />
            ))}
          </ul>
        </>
      )}
      <p className="fine">
        Need to add something? Queue a bump from the{" "}
        <Link href="/admin/ads?status=approved">Ads tab</Link>{" "}
        <span className="status-muted">
          (bumps here ride the next digest after new ads)
        </span>
        .
      </p>

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
