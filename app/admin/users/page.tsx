import type { Metadata } from "next";
import Link from "next/link";
import {
  adminGrantCredits,
  adminMergeUsers,
  adminSetBan,
  adminSetStrikes,
} from "@/lib/admin-actions";
import {
  ensureUserId,
  getAccount,
  getCreditBalance,
  getLedger,
  getRatingSummary,
  searchAccounts,
} from "@/lib/store";
import { listAdsByOwner } from "@/lib/ads";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Users — ${site.name} admin`,
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    phone?: string;
    saved?: string;
    error?: string;
    detail?: string;
    reason?: string;
  }>;
}) {
  const params = await searchParams;
  const phone = params.phone ? normalizePhone(params.phone) : null;
  const account = phone ? await getAccount(phone) : null;

  return (
    <>
      <h1>Users</h1>
      <form className="search" action="/admin/users" method="get">
        <label className="visually-hidden" htmlFor="q">
          Search users
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={params.q ?? ""}
          placeholder="Phone or email…"
        />
        <button type="submit">Search</button>
      </form>

      {!account && (
        <ul className="myads">
          {(await searchAccounts(params.q ?? "")).map((a) => (
            <li key={a.phone} className="myad-row">
              <p className="myad-title">
                <Link href={`/admin/users?phone=${a.phone}`}>{formatPhone(a.phone)}</Link>
                {a.postingBannedAt && <span className="ad-sold"> Banned</span>}
                {a.subscribedAt && <span className="status-muted"> · subscribed</span>}
              </p>
              <p className="myad-dates">
                Member since {shortDate(a.createdAt)}
                {a.email && ` · ${a.email}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {phone && account && (
        <>
          <h2 className="section-h">{formatPhone(phone)}</h2>
          {params.saved === "grant" && (
            <p className="notice" role="status">
              Credits adjusted.
            </p>
          )}
          {params.error === "grant" && (
            <p className="form-error" role="alert">
              A non-zero amount and a note are both required.
            </p>
          )}
          {params.saved === "merge" && params.detail && (
            <p className="notice" role="status">
              {params.detail}
            </p>
          )}
          {params.error === "merge" && params.reason && (
            <p className="form-error" role="alert">
              Merge failed: {params.reason}
            </p>
          )}
          <dl className="account-facts">
            <div>
              <dt>Member ID</dt>
              <dd>{(await ensureUserId(phone)) ?? "— (needs migration 0014)"}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{shortDate(account.createdAt)}</dd>
            </div>
            {await getRatingSummary(phone).then((r) =>
              r.asSeller.count + r.asBuyer.count > 0 ? (
                <div>
                  <dt>Ratings</dt>
                  <dd>
                    {r.asSeller.count > 0 && `as seller ★ ${r.asSeller.average} (${r.asSeller.count})`}
                    {r.asSeller.count > 0 && r.asBuyer.count > 0 && " · "}
                    {r.asBuyer.count > 0 && `as buyer ★ ${r.asBuyer.average} (${r.asBuyer.count})`}
                  </dd>
                </div>
              ) : null,
            )}
            <div>
              <dt>Text digests</dt>
              <dd>{account.subscribedAt ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Email digests</dt>
              <dd>{account.emailSubscribedAt ? "Yes" : "No"}</dd>
            </div>
            {account.email && (
              <div>
                <dt>Email</dt>
                <dd>{account.email}</dd>
              </div>
            )}
            <div>
              <dt>Free ads</dt>
              <dd>{account.freeAds}</dd>
            </div>
            <div>
              <dt>Credit balance</dt>
              <dd>{await getCreditBalance(phone)}</dd>
            </div>
            <div>
              <dt>Strikes</dt>
              <dd>{account.offenseCount ?? 0}</dd>
            </div>
            <div>
              <dt>Posting</dt>
              <dd>{account.postingBannedAt ? "Banned" : "Allowed"}</dd>
            </div>
          </dl>

          <h3 className="subsection-h">Adjust credits</h3>
          <form action={adminGrantCredits} className="review-form">
            <input type="hidden" name="phone" value={phone} />
            <div className="inline-fields">
              <input name="delta" type="number" placeholder="+5 or -2" required className="admin-num" />
              <input name="note" type="text" placeholder="Required note — e.g. phone order, check #204" required />
              <button className="btn btn-sm" type="submit">
                Apply
              </button>
            </div>
          </form>

          <h3 className="subsection-h">Merge / link identities</h3>
          <p className="fine">
            Enter a <strong>phone number</strong> for a FULL merge (that account&apos;s ads,
            credits, free passes, strikes, and saved card move here; the account is then deleted —
            its message history stays under the old number in the Messages log). Enter an{" "}
            <strong>email address</strong> to link it to this member — they then get both the text
            and email digests (&quot;doubly subscribed&quot;).
          </p>
          <form action={adminMergeUsers} className="review-form">
            <input type="hidden" name="phone" value={phone} />
            <div className="inline-fields">
              <input
                name="source"
                type="text"
                placeholder="Phone or email to merge into this account"
                required
              />
              <button className="btn btn-sm" type="submit">
                Merge into this account
              </button>
            </div>
          </form>

          <h3 className="subsection-h">Moderation</h3>
          <div className="sim-actions">
            <form action={adminSetStrikes} className="inline-form">
              <input type="hidden" name="phone" value={phone} />
              <input
                name="count"
                type="number"
                min={0}
                defaultValue={account.offenseCount ?? 0}
                className="admin-num"
                aria-label="Strike count"
              />
              <button className="btn btn-sm btn-secondary" type="submit">
                Set strikes
              </button>
            </form>
            <form action={adminSetBan} className="inline-form">
              <input type="hidden" name="phone" value={phone} />
              <input type="hidden" name="banned" value={account.postingBannedAt ? "no" : "yes"} />
              <button className="btn btn-sm btn-secondary" type="submit">
                {account.postingBannedAt ? "Lift posting ban" : "Ban from posting"}
              </button>
            </form>
          </div>

          <h3 className="subsection-h">Ads</h3>
          <ul className="myads">
            {(await listAdsByOwner(phone)).map((ad) => (
              <li key={ad.id} className="myad-row">
                <p className="myad-title">
                  <Link href={`/ad/${ad.id}`}>#{ad.id}</Link> · {ad.status}
                </p>
              </li>
            ))}
          </ul>

          <h3 className="subsection-h">Credit history</h3>
          <table className="cmd-table ledger-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="num">
                  Credits
                </th>
              </tr>
            </thead>
            <tbody>
              {(await getLedger(phone)).map((entry, i) => (
                <tr key={i}>
                  <td className="nowrap">{shortDate(entry.at)}</td>
                  <td>{entry.note}</td>
                  <td className="num">
                    {entry.delta === 0 ? "—" : entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">
            <Link href={`/admin/messages?phone=${phone}`}>Message history →</Link>
          </p>
        </>
      )}
    </>
  );
}
