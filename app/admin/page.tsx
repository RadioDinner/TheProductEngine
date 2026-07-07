import type { Metadata } from "next";
import Image from "next/image";
import { adminApprove, adminReject } from "@/lib/admin-actions";
import { getPendingAds } from "@/lib/engine-store";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

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

  return (
    <>
      <h1>Review queue</h1>
      {pending.length === 0 && <p>Nothing waiting for review.</p>}
      <ul className="sim-pending">
        {pending.map((ad) => (
          <li key={ad.id} className="myad-row">
            <p className="myad-title">
              #{ad.id} from {formatPhone(ad.ownerPhone)}
              {ad.flagged && <span className="ad-sold"> Flagged</span>}
              <span className="status-muted"> · {submitted(ad.createdAt)}</span>
            </p>
            {ad.photo && (
              <Image
                className="ad-thumb"
                src={ad.photo.src}
                alt={ad.photo.alt}
                width={88}
                height={88}
              />
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
        ))}
      </ul>
    </>
  );
}
