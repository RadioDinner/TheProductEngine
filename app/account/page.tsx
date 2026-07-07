import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth-actions";
import { saveEmail, toggleEmailEdition, toggleSubscription } from "@/lib/account-actions";
import { formatPhone } from "@/lib/phone";
import { readSession } from "@/lib/session";
import { getAccount, getCreditBalance, getLedger } from "@/lib/store";
import { adExpiresAt, deriveTitle, listAdsByOwner, type Ad } from "@/lib/ads";
import { formatPrice, packs, site } from "@/lib/config";
import { checkoutUrl } from "@/lib/payments";

export const metadata: Metadata = {
  title: `Your account — ${site.name}`,
  robots: { index: false },
};

function shortDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function adStatusLine(ad: Ad): { label: string; className: string; dates: string } {
  const posted = `Posted ${shortDate(ad.approvedAt)}`;
  if (ad.status === "sold") {
    return { label: "Sold", className: "ad-sold", dates: posted };
  }
  if (ad.status === "expired") {
    return {
      label: "Ended",
      className: "status-muted",
      dates: `${posted} · ended ${shortDate(adExpiresAt(ad))}`,
    };
  }
  return {
    label: "Available",
    className: "status-available",
    dates: `${posted} · runs through ${shortDate(adExpiresAt(ad))}`,
  };
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    purchased?: string;
    checkout?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");

  const params = await searchParams;
  const account = await getAccount(session.phone);
  const balance = await getCreditBalance(session.phone);
  const ledger = await getLedger(session.phone);
  const myAds = await listAdsByOwner(session.phone);
  const subscribed = Boolean(account?.subscribedAt);

  const memberSince = account
    ? new Date(account.createdAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <div className="container account">
      <h1>Your account</h1>
      <dl className="account-facts">
        <div>
          <dt>Phone number</dt>
          <dd>{formatPhone(session.phone)}</dd>
        </div>
        {memberSince && (
          <div>
            <dt>Member since</dt>
            <dd>{memberSince}</dd>
          </div>
        )}
      </dl>

      <section id="credits" aria-labelledby="credits-h">
        <h2 id="credits-h" className="section-h">
          Credits
        </h2>
        {params.purchased && (
          <p className="notice" role="status">
            {params.purchased} credits added to your account. Thank you!
          </p>
        )}
        {params.checkout === "success" && (
          <p className="notice" role="status">
            Payment received — thank you! Your credits will show up here in a moment;
            refresh the page if you don&rsquo;t see them yet.
          </p>
        )}
        {params.checkout === "cancelled" && (
          <p className="notice" role="status">
            Checkout cancelled — nothing was charged.
          </p>
        )}
        {params.checkout === "error" && (
          <p className="notice" role="status">
            We couldn&rsquo;t start checkout just now. Wait a few minutes and try again, or
            call {site.smsNumber} for help.
          </p>
        )}
        <dl className="account-facts">
          <div>
            <dt>Free ads remaining</dt>
            <dd>{account?.freeAds ?? 0}</dd>
          </div>
          <div>
            <dt>Credit balance</dt>
            <dd>{balance}</dd>
          </div>
        </dl>
        <h3 className="subsection-h">Buy credits</h3>
        <ul className="pack-list">
          {packs.map((pack) => (
            <li key={pack.id} className="pack-row">
              <span className="pack-name">{pack.credits} credits</span>
              <span className="pack-price">{formatPrice(pack.priceCents)}</span>
              <Link className="btn btn-sm" href={checkoutUrl(pack.id)}>
                Buy
              </Link>
            </li>
          ))}
        </ul>
        <p className="fine">
          Prefer paper? Call {site.smsNumber} to arrange payment by phone or check. Buying by
          text (BUYCREDIT) opens once you’ve saved a card here.
        </p>
        <h3 className="subsection-h">History</h3>
        {ledger.length ? (
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
              {ledger.map((entry, i) => (
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
        ) : (
          <p className="fine">No credit activity yet.</p>
        )}
      </section>

      <section id="my-ads" aria-labelledby="myads-h">
        <h2 id="myads-h" className="section-h">
          My ads
        </h2>
        {myAds.length ? (
          <ul className="myads">
            {myAds.map((ad) => {
              const status = adStatusLine(ad);
              return (
                <li key={ad.id} className="myad-row">
                  <p className="myad-title">
                    <Link href={`/ad/${ad.id}`}>
                      #{ad.id} — {deriveTitle(ad.body)}
                    </Link>{" "}
                    <span className={status.className}>{status.label}</span>
                  </p>
                  <p className="myad-dates">{status.dates}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            Ads you post by text will show up here. To post one, text{" "}
            <strong>AD NEW</strong> and your ad to <strong>{site.smsNumber}</strong> — see{" "}
            <Link href="/how-it-works">how it works</Link>.
          </p>
        )}
      </section>

      <section id="settings" aria-labelledby="settings-h">
        <h2 id="settings-h" className="section-h">
          Settings
        </h2>
        {params.saved === "email" && (
          <p className="notice" role="status">
            Email saved.
          </p>
        )}
        {params.error === "email" && (
          <p className="form-error" role="alert">
            That doesn’t look like an email address — check it and try again.
          </p>
        )}
        {params.error === "email-taken" && (
          <p className="form-error" role="alert">
            That email address is already on another account.
          </p>
        )}
        <form action={saveEmail}>
          <div className="field">
            <label htmlFor="email">Email for the email edition (optional)</label>
            <div className="inline-fields">
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={account?.email ?? ""}
                placeholder="you@example.com"
              />
              <button className="btn" type="submit">
                Save
              </button>
            </div>
          </div>
        </form>
        <p className="fine">
          The email edition carries the same ads with pictures included. Leave the box empty
          and save to remove your address.
        </p>

        {account?.email && (
          <>
            {account.emailSubscribedAt ? (
              <>
                <p>You’re getting the email edition at {account.email}.</p>
                <form action={toggleEmailEdition}>
                  <input type="hidden" name="subscribe" value="no" />
                  <button className="btn btn-secondary" type="submit">
                    Stop the email edition
                  </button>
                </form>
              </>
            ) : (
              <>
                <p>The email edition isn’t going to {account.email} yet.</p>
                <form action={toggleEmailEdition}>
                  <input type="hidden" name="subscribe" value="yes" />
                  <button className="btn" type="submit">
                    Send me the email edition
                  </button>
                </form>
              </>
            )}
          </>
        )}

        <h3 className="subsection-h">Text digests</h3>
        {subscribed ? (
          <>
            <p>
              You’re subscribed — new ads come to {formatPhone(session.phone)} up to four
              times a day.
            </p>
            <form action={toggleSubscription}>
              <input type="hidden" name="subscribe" value="no" />
              <button className="btn btn-secondary" type="submit">
                Unsubscribe
              </button>
            </form>
          </>
        ) : (
          <>
            <p>You’re not getting the text digests right now.</p>
            <form action={toggleSubscription}>
              <input type="hidden" name="subscribe" value="yes" />
              <button className="btn" type="submit">
                Subscribe to the text digests
              </button>
            </form>
          </>
        )}
        <p className="fine">
          Up to 4 digests a day. Msg &amp; data rates may apply. Reply STOP to any digest to
          stop, HELP for help.
        </p>
      </section>

      <section aria-label="Sign out">
        <h2 className="section-h">Sign out</h2>
        <form action={signOut}>
          <button className="btn btn-secondary" type="submit">
            Sign out
          </button>
        </form>
        <p className="fine">On a shared computer? Remember to sign out when you’re done.</p>
      </section>
    </div>
  );
}
