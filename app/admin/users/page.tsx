import type { Metadata } from "next";
import Link from "next/link";
import {
  adminGrantCredits,
  adminInviteUser,
  adminMergeUsers,
  adminPhoneOrderCheckout,
  adminSetBan,
  adminSetStrikes,
  adminSetVerified,
  adminTextCheckoutLink,
} from "@/lib/admin-actions";
import {
  ensureUserId,
  getAccount,
  getCreditBalance,
  getLedger,
  getRatingSummary,
  getVerifiedAt,
  searchAccounts,
} from "@/lib/store";
import { listAdsByOwner } from "@/lib/ads";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatPrice, packs, site } from "@/lib/config";

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
      {params.saved === "invite" && (
        <p className="notice" role="status">
          {params.reason ?? "Invite sent."}
        </p>
      )}
      {params.error === "invite" && (
        <p className="form-error" role="alert">
          {params.reason ?? "Invite failed."}
        </p>
      )}
      <details className="dev-notice">
        <summary className="fine">Add a member (send a signup invite by text)</summary>
        <p className="fine">
          Creates their account right away and texts them a one-time invite — &ldquo;To sign
          up, reply START&rdquo; with opt-out instructions. Starting credits (optional) are
          granted immediately, so they&apos;re ready the moment they reply. One invite per
          number per day; numbers that are already subscribed are refused.
        </p>
        <form action={adminInviteUser} className="review-form">
          <div className="inline-fields">
            <input
              name="phone"
              type="tel"
              placeholder="330-555-0142"
              aria-label="Phone number to invite"
              required
            />
            <input
              name="credits"
              type="number"
              min={0}
              max={1000}
              placeholder="Starting credits (optional)"
              aria-label="Starting credits"
              className="admin-num"
            />
            <button className="btn btn-sm" type="submit">
              Create account + send invite
            </button>
          </div>
        </form>
      </details>
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
          {params.saved === "phoneorder" && (
            <p className="notice" role="status">
              Payment complete. The credits are granted (and the card saved) the moment
              Stripe&rsquo;s confirmation arrives — usually within seconds; refresh to see the
              new balance in the ledger below.
            </p>
          )}
          {params.saved === "phoneorder_link" && (
            <p className="notice" role="status">
              Checkout link texted. When they finish paying, the credits land on this account
              automatically and the card is saved for BUYCREDIT texts.
            </p>
          )}
          {params.error === "phoneorder_cancel" && (
            <p className="form-error" role="alert">
              Checkout was cancelled — nothing was charged.
            </p>
          )}
          {params.error === "phoneorder_pack" && (
            <p className="form-error" role="alert">
              Pick a credit pack for the phone order first.
            </p>
          )}
          {params.error === "phoneorder_dev" && (
            <p className="form-error" role="alert">
              Payments aren&rsquo;t configured (dev mode) — phone orders need the live Stripe
              keys.
            </p>
          )}
          {params.error === "phoneorder_sms" && (
            <p className="form-error" role="alert">
              The checkout was created but the text could not be sent (paused or blocked
              number). Try &ldquo;Open checkout here&rdquo; instead.
            </p>
          )}
          {params.error === "phoneorder" && (
            <p className="form-error" role="alert">
              Couldn&rsquo;t start the Stripe checkout — try again, and check the Stripe keys
              if it keeps failing.
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
          {params.saved === "verify" && (
            <p className="notice" role="status">
              Verified status updated.
            </p>
          )}
          {params.error === "verify" && (
            <p className="form-error" role="alert">
              Couldn&apos;t update verified status — is migration 9981 applied?
            </p>
          )}
          <dl className="account-facts">
            <div>
              <dt>Member ID</dt>
              <dd>{(await ensureUserId(phone)) ?? "— (needs migration 9986)"}</dd>
            </div>
            {await getVerifiedAt(phone).then((verifiedAt) => (
              <div>
                <dt>Verified</dt>
                <dd>
                  {verifiedAt ? (
                    <>
                      <span className="verified-badge">✓ Verified</span> since{" "}
                      {shortDate(verifiedAt)}
                    </>
                  ) : (
                    "No"
                  )}
                </dd>
              </div>
            ))}
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

          <h3 className="subsection-h">Phone order — card payment by phone</h3>
          <p className="fine">
            For a caller paying by card: pick the pack, then either{" "}
            <strong>open the checkout here</strong> and key the card into Stripe&rsquo;s secure
            page while they read it out (never write the number down — it goes straight into
            Stripe, this site never sees it), or <strong>text them the link</strong> to finish
            on their own (needs a phone that opens web pages; link lasts 24 hours). Either way
            the credits land on this account automatically and the card is saved, so from then
            on they can buy by texting <span className="cmd">BUYCREDIT</span>. Paying by cash or
            check? Use Adjust credits above instead.
          </p>
          <form className="review-form">
            <input type="hidden" name="phone" value={phone} />
            <div className="inline-fields">
              <select name="pack" defaultValue="" className="admin-select" aria-label="Credit pack">
                <option value="" disabled>
                  Credit pack…
                </option>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.credits} credits — {formatPrice(p.priceCents)}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" formAction={adminPhoneOrderCheckout} type="submit">
                Open checkout here
              </button>
              <button className="btn btn-sm btn-secondary" formAction={adminTextCheckoutLink} type="submit">
                Text them the link
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

          <h3 className="subsection-h">Verification</h3>
          <p className="fine">
            The green check means YOU vouched for this person after checking them out — there is
            no self-serve path. Verified members will earn perks over time.
          </p>
          {await getVerifiedAt(phone).then((verifiedAt) => (
            <form action={adminSetVerified} className="sim-actions">
              <input type="hidden" name="phone" value={phone} />
              <input type="hidden" name="on" value={verifiedAt ? "no" : "yes"} />
              <button
                className={`btn btn-sm${verifiedAt ? " btn-secondary" : ""}`}
                type="submit"
              >
                {verifiedAt ? "Remove verified status" : "Mark verified ✓"}
              </button>
            </form>
          ))}

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
