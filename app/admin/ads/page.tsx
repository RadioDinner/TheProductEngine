import type { Metadata } from "next";
import Link from "next/link";
import { getAllAds, type StoredAdStatus } from "@/lib/engine-store";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `All ads — ${site.name} admin`,
};

const STATUSES: StoredAdStatus[] = ["pending", "approved", "rejected", "sold", "expired"];

export default async function AdminAds({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as StoredAdStatus)
    ? (params.status as StoredAdStatus)
    : undefined;
  const ads = await getAllAds(params.q, status);

  return (
    <>
      <h1>All ads</h1>
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
              {ad.flagged && <span className="ad-sold"> Flagged</span>} ·{" "}
              <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
            </p>
            <p className="sim-body">{ad.body}</p>
            {ad.rejectedReason && (
              <p className="myad-dates">
                Rejected ({ad.rejectionKind}): {ad.rejectedReason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
