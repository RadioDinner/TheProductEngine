import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth-actions";
import { saveEmail, saveProfile, toggleEmailEdition, toggleSubscription } from "@/lib/account-actions";
import { formatPhone } from "@/lib/phone";
import { readSession } from "@/lib/session";
import {
  ensureUserId,
  getAccount,
  getCreditBalance,
  getLedger,
  getProfile,
  getVerifiedAt,
  listChatsFor,
} from "@/lib/store";
import { adExpiresAt, deriveTitle, listAdsByOwner, type Ad } from "@/lib/ads";
import { getPendingAds } from "@/lib/engine-store";
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
    profile?: string;
  }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");

  const params = await searchParams;
  const account = await getAccount(session.phone);
  const memberId = await ensureUserId(session.phone);
  const profile = await getProfile(session.phone);
  const unreadChats = (await listChatsFor(session.phone)).filter((c) => c.unread).length;
  const balance = await getCreditBalance(session.phone);
  const ledger = await getLedger(session.phone);
  const myAds = await listAdsByOwner(session.phone);
  // listAdsByOwner excludes pending — merge the review queue's rows for this
  // number so a just-posted ad is visible (same as the SMS MYADS reply).
  const pendingAds = (await getPendingAds()).filter((ad) => ad.ownerPhone === session.phone);
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
        {memberId && (
          <div>
            <dt>Member ID</dt>
            <dd>{memberId}</dd>
          </div>
        )}
        {Boolean(await getVerifiedAt(session.phone)) && (
          <div>
            <dt>Standing</dt>
            <dd>
              <span className="verified-badge">✓ Verified member</span>
            </dd>
          </div>
        )}
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
            call {site.supportPhone} for help.
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
          Prefer paper? Call {site.supportPhone} to arrange payment by phone or check. Buying by
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
        <p>
          <Link className="btn btn-sm" href="/account/post">
            Post an ad
          </Link>{" "}
          — right here on the website. It costs the same as texting one in.
        </p>
        <p>
          <Link href="/account/ads">
            Manage your ads — mark sold, bump, change pictures, or delete →
          </Link>
        </p>
        {myAds.length || pendingAds.length ? (
          <ul className="myads">
            {pendingAds.map((ad) => (
              <li key={`pending-${ad.id}`} className="myad-row">
                <p className="myad-title">
                  #{ad.id} — {deriveTitle(ad.body)}{" "}
                  <span className="status-muted">Waiting for review</span>
                </p>
                <p className="myad-dates">
                  Submitted {shortDate(ad.createdAt)} — you&rsquo;ll get a text when
                  it&rsquo;s approved for an upcoming digest.
                </p>
              </li>
            ))}
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
            Ads you post will show up here. <Link href="/account/post">Post one on the
            website</Link>, or text <strong>AD NEW</strong> and your ad to{" "}
            <strong>{site.smsNumber}</strong> — see{" "}
            <Link href="/how-it-works">how it works</Link>.
          </p>
        )}
      </section>

      <section id="messages" aria-labelledby="messages-h">
        <h2 id="messages-h" className="section-h">
          Messages
        </h2>
        <p>
          <Link href="/account/messages">Your conversations with other members →</Link>
          {unreadChats > 0 && <span className="ad-sold"> {unreadChats} new</span>}
        </p>
      </section>

      <section id="profile" aria-labelledby="profile-h">
        <h2 id="profile-h" className="section-h">
          Profile
        </h2>
        {params.profile === "saved" && (
          <p className="notice" role="status">
            Profile saved.
          </p>
        )}
        {params.profile === "badphoto" && (
          <p className="form-error" role="alert">
            That picture couldn&apos;t be used — jpg, png, gif, or webp up to 8 MB.
          </p>
        )}
        {params.profile === "unsupported" && (
          <p className="form-error" role="alert">
            Profiles aren&apos;t available just yet — try again later.
          </p>
        )}
        {profile ? (
          <form action={saveProfile}>
            {profile.profilePhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.profilePhoto}
                alt="Your profile picture"
                width={72}
                height={72}
                style={{ borderRadius: "50%", objectFit: "cover", marginBottom: 8 }}
              />
            )}
            <div className="field">
              <label htmlFor="profile-photo">Profile picture (shown to members you message)</label>
              <input id="profile-photo" name="photo" type="file" accept="image/*" />
            </div>
            <div className="field">
              <label htmlFor="pickup-address">
                Pickup address — private. It&apos;s shared only when YOU press &ldquo;Share my
                pickup address&rdquo; inside a conversation.
              </label>
              <input
                id="pickup-address"
                name="pickupAddress"
                type="text"
                maxLength={200}
                defaultValue={profile.pickupAddress ?? ""}
                placeholder="4392 CR 168, Millersburg"
              />
            </div>
            <button className="btn btn-sm" type="submit">
              Save profile
            </button>
          </form>
        ) : (
          <p className="fine">Profile settings aren&apos;t available just yet.</p>
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
