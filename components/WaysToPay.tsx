import Link from "next/link";
import { checkoutUrl } from "@/lib/payments";
import { formatPrice, site } from "@/lib/config";

/**
 * The three ways to pay for a listing (user, session 019: "Tell them they can
 * call (330) 275-1603 or email support@theplainexchange.com to buy an ad, or
 * click through the checkout").
 *
 * Shared by the town-hall event form and the featured-listing request page so
 * the two never drift into quoting different numbers or different prices.
 *
 * The card route deliberately goes through the normal add-money checkout
 * rather than a separate one-off product purchase: money lands on the
 * member's balance and the listing charge comes off it when the listing is
 * approved. That means a listing that is never approved leaves the money on
 * their account rather than needing a refund — which, given what a refund
 * costs, is the kinder default for both sides.
 */
export function WaysToPay({
  priceCents,
  what,
  signedIn,
}: {
  priceCents: number;
  /** What they are buying, in words: "an event listing", "a featured spot". */
  what: string;
  /** Card checkout needs an account; the other two never do. */
  signedIn: boolean;
}) {
  const subject = encodeURIComponent(`${what} — ${site.name}`);
  return (
    <div className="ways-to-pay">
      <p className="fine">
        <strong>Three ways to pay for {what}:</strong>
      </p>
      <ul className="ways-list">
        <li>
          <strong>Call {site.supportPhone}</strong> — talk to a person, pay by card over the
          phone, or arrange a check.
        </li>
        <li>
          <strong>
            Email <a href={`mailto:${site.supportEmail}?subject=${subject}`}>{site.supportEmail}</a>
          </strong>{" "}
          — tell us what you want and we&rsquo;ll set it up.
        </li>
        <li>
          {signedIn ? (
            <>
              <Link className="btn btn-sm" href={checkoutUrl(priceCents)}>
                Pay {formatPrice(priceCents)} now
              </Link>{" "}
              <span className="status-muted">
                — a secure card checkout. The money goes onto your account and the{" "}
                {formatPrice(priceCents)} comes off it when your listing is approved, so
                nothing is charged for a listing that never runs.
              </span>
            </>
          ) : (
            <>
              <strong>Pay online</strong> —{" "}
              <Link href="/login?next=%2Faccount">sign in</Link> and you can pay{" "}
              {formatPrice(priceCents)} by card in a minute.
            </>
          )}
        </li>
      </ul>
    </div>
  );
}
