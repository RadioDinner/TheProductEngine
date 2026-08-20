import type { Metadata } from "next";
import Link from "next/link";
import {
  adminBillSavedCard,
  adminGrantCredits,
  adminInviteUser,
  adminMergeUsers,
  adminPhoneOrderCheckout,
  adminSetArchived,
  adminSetBan,
  adminSetStrikes,
  adminSetVerified,
  adminTextCheckoutLink,
} from "@/lib/admin-actions";
import {
  ensureUserId,
  getAccount,
  getMemberName,
  getCreditBalance,
  getLedger,
  getRatingSummary,
  getArchivedAt,
  getLineType,
  getVerifiedAt,
  searchAccounts,
} from "@/lib/store";
import { listAdsByOwner } from "@/lib/ads";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { moneyPosition } from "@/lib/money";
import { TOP_UP_PRESETS_CENTS, formatPrice, site } from "@/lib/config";
import { paymentsDevMode, resolveStripeCustomer, savedCardOnFile } from "@/lib/payments";
import { getEngineSettings } from "@/lib/settings";
import { Tip } from "@/components/Tip";
import { isBurnerLine, lineTypeLabel } from "@/lib/number-lookup";

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
    max?: string;
  }>;
}) {
  const params = await searchParams;
  const phone = params.phone ? normalizePhone(params.phone) : null;
  const account = phone ? await getAccount(phone) : null;
  // The name only exists if a feedback form taught it to us (session 018,
  // migration 9958) — nothing collects it at signup.
  const memberName = phone ? await getMemberName(phone) : { firstName: null, lastName: null };
  // Null when they're active, when migration 9964 is pending, or when no
  // member is selected — all three mean "show the archive button, not the
  // restore one", which is the safe direction.
  const archivedAt = phone ? await getArchivedAt(phone) : null;
  // The ledger is read ONCE and the split derived from it, so the balance, the
  // refundable figure and the money history below can never disagree — they
  // are three views of the same rows (session 019, lib/money.ts).
  const ledger = phone ? await getLedger(phone) : [];
  const position = moneyPosition(ledger);
  // Phone-order panel: is a card on file? (best-effort; display only). A card
  // saved through the pay-by-phone line lives on a Stripe customer this
  // account hasn't stored yet — resolveStripeCustomer adopts it right here,
  // so the operator sees "Card on file" as soon as the call-in card lands.
  const customerId =
    account && phone && !paymentsDevMode
      ? await resolveStripeCustomer(phone, account.stripeCustomerId)
      : (account?.stripeCustomerId ?? null);
  const savedCard =
    customerId && !paymentsDevMode
      ? await savedCardOnFile(customerId)
      : customerId
        ? {}
        : null;
  const engineSettings = await getEngineSettings();

  return (
    <>
      <h1>Users</h1>
      <p className="admin-nav">
        <Link href="/admin/users/table">See all members as a table</Link>
      </p>
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
          up, reply START&rdquo; with opt-out instructions. Starting ad credit in dollars
          (optional) is granted immediately, so they&apos;re ready the moment they reply. One invite per
          number per day; numbers that are already subscribed are refused.{" "}
          <Tip k="users.invite" />
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
              step="0.01"
              placeholder="Starting $ (optional)"
              aria-label="Starting ad credit in dollars"
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
          <h2 className="section-h">
            {formatPhone(phone)}
            {(memberName.firstName || memberName.lastName) && (
              <span className="status-muted">
                {" "}
                · {[memberName.firstName, memberName.lastName].filter(Boolean).join(" ")}
              </span>
            )}
          </h2>
          {params.saved === "grant" && (
            <p className="notice" role="status">
              Balance adjusted.
            </p>
          )}
          {params.error === "grant" && (
            <p className="form-error" role="alert">
              A non-zero amount and a note are both required.
            </p>
          )}
          {params.error === "payout" && (
            <p className="form-error" role="alert">
              <strong>Nothing was paid out.</strong> That is more than this member has
              ever put in. At most{" "}
              <strong>{formatPrice(Number(params.max ?? 0))}</strong> can go back to their
              card — the rest of their balance is ad credit we gave them, which has no cash
              value and is never refundable. <Tip k="users.refundable" />
            </p>
          )}
          {params.saved === "bill" && params.detail && (
            <p className="notice" role="status">
              {params.detail}
            </p>
          )}
          {params.error === "bill" && (
            <p className="form-error" role="alert">
              Saved-card charge failed{params.reason ? `: ${params.reason}` : ""}. Nothing was
              granted. If their bank wants extra verification, use &ldquo;Open checkout
              here&rdquo; or text them the link instead.
            </p>
          )}
          {params.error === "bill_nocard" && (
            <p className="form-error" role="alert">
              No card is on file for this member — collect one with &ldquo;Open checkout
              here&rdquo; or &ldquo;Text them the link&rdquo; first.
            </p>
          )}
          {params.saved === "phoneorder" && (
            <p className="notice" role="status">
              Payment complete. The money is granted (and the card saved) the moment
              Stripe&rsquo;s confirmation arrives — usually within seconds; refresh to see the
              new balance in the ledger below.
            </p>
          )}
          {params.saved === "phoneorder_link" && (
            <p className="notice" role="status">
              Checkout link texted. When they finish paying, the money lands on this account
              automatically and the card is saved for automatic top-up.
            </p>
          )}
          {params.error === "phoneorder_cancel" && (
            <p className="form-error" role="alert">
              Checkout was cancelled — nothing was charged.
            </p>
          )}
          {params.error === "phoneorder_pack" && (
            <p className="form-error" role="alert">
              Pick a preset amount or type a custom one first — custom amounts run from
              $1 to $5,000.
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
              <dt>
                Member ID <Tip k="users.memberId" />
              </dt>
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
            {await getLineType(phone).then((lineType) => (
              <div>
                <dt>
                  Line type <Tip k="users.lineType" />
                </dt>
                <dd>
                  {isBurnerLine(lineType) ? (
                    <span className="ad-sold">{lineTypeLabel(lineType)}</span>
                  ) : (
                    lineTypeLabel(lineType)
                  )}
                </dd>
              </div>
            ))}
            {await getRatingSummary(phone).then((r) =>
              r.asSeller.count + r.asBuyer.count > 0 ? (
                <div>
                  <dt>
                    Ratings <Tip k="users.ratings" />
                  </dt>
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
              <dt>Ad-credit balance</dt>
              <dd>{formatPrice(position.balanceCents)}</dd>
            </div>
            <div>
              <dt>
                Refundable <Tip k="users.refundable" />
              </dt>
              <dd>
                {formatPrice(position.cashRemainingCents)}
                {position.grantRemainingCents > 0 && (
                  <span className="status-muted">
                    {" "}
                    · {formatPrice(position.grantRemainingCents)} is credit we gave
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>
                Starter credit <Tip k="users.starterCredit" />
              </dt>
              <dd>{account.starterGrantedAt ? "Granted" : "Waiting for their first post"}</dd>
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

          <h3 className="subsection-h">
            Adjust balance ($) <Tip k="users.credits" />
          </h3>
          <form action={adminGrantCredits} className="review-form">
            <input type="hidden" name="phone" value={phone} />
            <div className="inline-fields">
              <select name="kind" aria-label="What kind of adjustment" className="admin-select">
                <option value="payment">Payment received (check, cash, phone)</option>
                <option value="courtesy">Courtesy credit / make-good</option>
                <option value="payout">Money sent back to them</option>
              </select>
              <input
                name="delta"
                type="number"
                step="0.01"
                placeholder="+45 or -15"
                required
                className="admin-num"
              />
              <input name="note" type="text" placeholder="Required note — e.g. phone order, check #204" required />
              <button className="btn btn-sm" type="submit">
                Apply
              </button>
            </div>
          </form>
          <p className="fine">
            Dollars, decimals allowed — this is how a mailed check or cash payment lands on
            the account. <strong>Say which kind it is</strong> <Tip k="users.adjustKind" />:
            a payment is their money and stays refundable, a courtesy credit never is, and
            money sent back is capped at the{" "}
            <strong>{formatPrice(position.cashRemainingCents)}</strong> refundable above.
            Use a negative amount for a payout. <strong>Silent:</strong> nothing is texted
            or emailed to the member. The only buttons on this page that message them are
            &ldquo;Text them the link&rdquo; below and the invite on Add a member.
          </p>

          <h3 className="subsection-h">
            Phone order — card payment by phone <Tip k="users.phoneOrder" />
          </h3>
          <p className="fine">
            {savedCard ? (
              <>
                <strong>Card on file{savedCard.last4 ? ` (ending ${savedCard.last4})` : ""}.</strong>{" "}
                &ldquo;Bill their saved card&rdquo; charges it right now with their verbal OK.
              </>
            ) : (
              <>
                <strong>No card on file.</strong> Collect one below — either{" "}
                <strong>open the checkout here</strong> and key the card into Stripe&rsquo;s
                secure page while they read it out (never write the number down — it goes
                straight into Stripe, this site never sees it), or{" "}
                <strong>text them the link</strong> to finish on their own (needs a phone that
                opens web pages; link lasts 24 hours).
              </>
            )}{" "}
            Either way the money lands on this account automatically and the card is saved,
            so from then on their ads can top up automatically — or you can bill them here.
            Paying by cash or check? Use Adjust balance above instead.
          </p>
          <form className="review-form">
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="nonce" value={crypto.randomUUID()} />
            <div className="inline-fields">
              <select name="amount" defaultValue="" className="admin-select" aria-label="Amount">
                <option value="" disabled>
                  Amount…
                </option>
                {TOP_UP_PRESETS_CENTS.map((amount) => (
                  <option key={amount} value={amount}>
                    {formatPrice(amount)} of ad credit
                  </option>
                ))}
              </select>
              <input
                name="customAmount"
                type="text"
                inputMode="decimal"
                placeholder="or custom $"
                aria-label="Custom amount in dollars"
                className="admin-num"
              />
              {savedCard && (
                <button className="btn btn-sm" formAction={adminBillSavedCard} type="submit">
                  Bill their saved card
                </button>
              )}
              <button
                className={savedCard ? "btn btn-sm btn-secondary" : "btn btn-sm"}
                formAction={adminPhoneOrderCheckout}
                type="submit"
              >
                Open checkout here
              </button>
              <button className="btn btn-sm btn-secondary" formAction={adminTextCheckoutLink} type="submit">
                Text them the link
              </button>
            </div>
          </form>

          <h3 className="subsection-h">
            Merge / link identities <Tip k="users.merge" />
          </h3>
          <p className="fine">
            Enter a <strong>phone number</strong> for a FULL merge (that account&apos;s ads,
            money, strikes, and saved card move here; the account is then deleted —
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

          <h3 className="subsection-h">
            Verification <Tip k="users.verified" />
          </h3>
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

          <h3 className="subsection-h">
            Moderation <Tip k="users.moderation" />
          </h3>
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

          <h3 className="subsection-h">
            Archive or delete <Tip k="users.archive" />
          </h3>
          {params.error === "migration9964" && (
            <p className="notice" role="alert">
              Archiving isn&rsquo;t available yet — paste migration <strong>9964</strong>{" "}
              in the Supabase SQL editor.
            </p>
          )}
          {params.saved === "archived" && (
            <p className="notice" role="status">
              Archived. They keep their balance and their history, and their ads are off
              the website and out of the send queue until you restore them.
            </p>
          )}
          {params.saved === "restored" && (
            <p className="notice" role="status">
              Restored — back exactly as they were.
            </p>
          )}
          {archivedAt ? (
            <p className="fine">
              <strong>Archived</strong> since {shortDate(archivedAt)}. Nothing was
              destroyed: their balance, ads and history are intact and restoring puts
              them back exactly as they were.
            </p>
          ) : (
            <p className="fine">
              <strong>Archive</strong> sets a member aside — off the website, out of the
              subscriber lists, no ads going out — without destroying anything. Their
              money stays theirs, and restoring returns them exactly as they were. It is
              the right choice for a real person: someone who asked to be taken off, a
              seller gone quiet, an account you want out of the way while you work out
              what is going on.
            </p>
          )}
          <div className="sim-actions">
            <form action={adminSetArchived} className="inline-form">
              <input type="hidden" name="phone" value={phone} />
              <input type="hidden" name="archived" value={archivedAt ? "no" : "yes"} />
              {!archivedAt && (
                <input name="reason" type="text" placeholder="Why (optional)" />
              )}
              <button className="btn btn-sm btn-secondary" type="submit">
                {archivedAt ? "Restore this member" : "Archive this member"}
              </button>
            </form>
            <Link className="btn btn-sm btn-secondary" href="/admin/purge">
              Delete permanently…
            </Link>
          </div>
          <p className="fine">
            <strong>Deleting is not archiving.</strong> It removes the member and
            everything they touched, with no archive and no restore — meant for clearing
            out your own test data, not for handling a real customer. It opens on its own
            page, previews exactly what would go, and makes you type DELETE.
          </p>

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

          <h3 className="subsection-h">
            Money history <Tip k="concepts.ledger" />
          </h3>
          <table className="cmd-table ledger-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry, i) => (
                <tr key={i}>
                  <td className="nowrap">{shortDate(entry.at)}</td>
                  <td>{entry.note}</td>
                  <td className="num">
                    {entry.delta === 0
                      ? "—"
                      : entry.delta > 0
                        ? `+${formatPrice(entry.delta)}`
                        : `−${formatPrice(-entry.delta)}`}
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
