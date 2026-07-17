import type { Metadata } from "next";
import Link from "next/link";
import { startBusinessCheckout } from "@/lib/business-actions";
import { businessPackagesAvailable } from "@/lib/business";
import {
  BUSINESS_AD_MAX,
  BUSINESS_LINK_MAX,
  BUSINESS_NAME_MAX,
  BUSINESS_TIERS,
} from "@/lib/business-packages";
import { formatPrice, site } from "@/lib/config";
import { paymentsDevMode } from "@/lib/payments";

export const metadata: Metadata = {
  title: `Advertising for Businesses — ${site.name}`,
  description: `Put your business in front of every ${site.name} subscriber: a labeled sponsor line in the daily text digest, once a day. 1 week $39.99, 2 weeks $59.99, 1 month $89.99.`,
};

export default async function AdvertisingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; checkout?: string }>;
}) {
  const params = await searchParams;
  const available = await businessPackagesAvailable();

  return (
    <div className="container account">
      <h1>Advertising for Businesses</h1>
      <p>
        Every day, {site.name} texts its digest of classified ads to every subscriber in{" "}
        {site.region} — people who read their texts, not banner ads. A business package
        puts your ad in that digest <strong>once a day</strong> as a clearly labeled
        sponsor line, like this:
      </p>
      <p className="sms-example">
        Sponsor: Miller&rsquo;s Harness Shop - New harnesses in stock, open Sat.
        (330)&nbsp;555-0142
      </p>
      <p>
        The sponsor line rides <strong>on top of</strong> the day&rsquo;s member ads — it
        never takes one of their spots — and it also appears in the email edition, where
        your link is clickable.
      </p>

      <section aria-labelledby="packages-h">
        <h2 id="packages-h" className="section-h">
          The three packages
        </h2>
        <ul className="pack-list">
          {BUSINESS_TIERS.map((tier) => (
            <li key={tier.id} className="pack-row">
              <span className="pack-name">{tier.label}</span>
              <span className="pack-price">{formatPrice(tier.priceCents)}</span>
              <span className="fine">your ad in the digest once a day, {tier.days} days</span>
            </li>
          ))}
        </ul>
        <p className="fine">
          Every package is the same ad, once a day — the tiers only set how many days it
          runs.
        </p>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="section-h">
          How it works
        </h2>
        <ul>
          <li>
            <strong>Pay online, reviewed by a person.</strong> You pay by card on a secure
            Stripe checkout page, and your ad then goes to the same human review as every
            ad on {site.name}. Payment never skips the review.
          </li>
          <li>
            <strong>Your run starts when your ad is approved</strong> — not when you pay.
            A 1-week package is 7 days in the digest counted from approval.
          </li>
          <li>
            <strong>You get every day you paid for.</strong> If a day&rsquo;s digest
            doesn&rsquo;t go out for any reason, that day isn&rsquo;t counted — your run
            simply extends until your ad has ridden the full number of days.
          </li>
          <li>
            <strong>One link allowed.</strong> Unlike member ads, a business ad may carry
            one website link (it&rsquo;s reviewed like everything else). In the text
            digest the link appears as plain text; in the email edition it&rsquo;s
            clickable.
          </li>
          <li>
            <strong>Declined ads are refunded in full.</strong> If we can&rsquo;t run your
            ad, it never rides a digest and your payment is returned to your card — see
            the <Link href="/refund-policy">refund policy</Link>.
          </li>
        </ul>
      </section>

      <section aria-labelledby="buy-h">
        <h2 id="buy-h" className="section-h">
          Buy a package
        </h2>

        {params.checkout === "cancelled" && (
          <p className="notice" role="status">
            Checkout was cancelled — nothing was charged. You can start again below.
          </p>
        )}
        {params.error === "tier" && (
          <p className="form-error" role="alert">
            Please pick one of the three packages.
          </p>
        )}
        {params.error === "name" && (
          <p className="form-error" role="alert">
            Please give your business name (up to {BUSINESS_NAME_MAX} characters).
          </p>
        )}
        {params.error === "text" && (
          <p className="form-error" role="alert">
            Please write your ad (up to {BUSINESS_AD_MAX} characters). It rides a text
            message, so keep it short and plain.
          </p>
        )}
        {params.error === "linkintext" && (
          <p className="form-error" role="alert">
            Please keep the website link out of the ad text — put it in the
            &ldquo;Website link&rdquo; field instead (one link per ad).
          </p>
        )}
        {params.error === "badlink" && (
          <p className="form-error" role="alert">
            That website link doesn&rsquo;t look right — a plain address like
            example.com works best (up to {BUSINESS_LINK_MAX} characters, no spaces).
          </p>
        )}
        {params.error === "badphone" && (
          <p className="form-error" role="alert">
            That phone number doesn&rsquo;t look right — a 10-digit US number, please.
          </p>
        )}
        {(params.error === "checkout" || params.error === "payments") && (
          <p className="form-error" role="alert">
            We couldn&rsquo;t start the payment just now. Nothing was charged — please try
            again, or call {site.supportPhone} to arrange it.
          </p>
        )}
        {params.error === "unavailable" && (
          <p className="form-error" role="alert">
            Online purchase isn&rsquo;t available right now. Nothing was charged — call{" "}
            {site.supportPhone} and we&rsquo;ll set your package up.
          </p>
        )}

        {available ? (
          <>
            {paymentsDevMode && (
              <p className="dev-notice">
                <strong>Development mode</strong> — no payment processor is connected. In
                production this hands off to a secure Stripe checkout page; here the
                purchase is simulated.
              </p>
            )}
            <form action={startBusinessCheckout}>
              <fieldset className="field">
                <legend>Package</legend>
                {BUSINESS_TIERS.map((tier, i) => (
                  <label key={tier.id} style={{ display: "block" }}>
                    <input
                      type="radio"
                      name="tier"
                      value={tier.id}
                      defaultChecked={i === 0}
                    />{" "}
                    {tier.label} — {formatPrice(tier.priceCents)}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="biz-name">Business name</label>
                <input
                  id="biz-name"
                  name="business"
                  type="text"
                  maxLength={BUSINESS_NAME_MAX}
                  required
                  placeholder="Miller's Harness Shop"
                />
              </div>
              <div className="field">
                <label htmlFor="biz-text">Your ad ({BUSINESS_AD_MAX} characters max)</label>
                <textarea
                  id="biz-text"
                  name="adtext"
                  rows={3}
                  maxLength={BUSINESS_AD_MAX}
                  required
                  placeholder="New harnesses in stock, open Saturdays till noon."
                />
              </div>
              <p className="fine">
                Your exact words ride the text digest after the label
                &ldquo;Sponsor: <em>your business name</em> -&rdquo;. Emoji are removed;
                keep the link for the field below.
              </p>
              <div className="field">
                <label htmlFor="biz-link">Website link (optional — one link)</label>
                <input
                  id="biz-link"
                  name="link"
                  type="text"
                  maxLength={BUSINESS_LINK_MAX}
                  placeholder="millersharness.com"
                />
              </div>
              <div className="field">
                <label htmlFor="biz-phone">Phone number to show (optional)</label>
                <input id="biz-phone" name="phone" type="tel" placeholder="330-555-0142" />
              </div>
              <button className="btn btn-block" type="submit">
                {paymentsDevMode ? "Simulate payment" : "Continue to secure payment"}
              </button>
            </form>
            <p className="fine">
              After payment your ad waits for review — a person reads every ad before it
              runs, and your run starts the day it&rsquo;s approved. If it&rsquo;s
              declined, your payment is refunded in full.
            </p>
          </>
        ) : (
          <p className="notice">
            Online purchase isn&rsquo;t available just yet. Call{" "}
            <strong>{site.supportPhone}</strong> and we&rsquo;ll set your package up by
            hand.
          </p>
        )}
      </section>

      <p className="fine">
        Questions first? Call {site.supportPhone} — we&rsquo;re glad to help you write the
        ad.
      </p>
    </div>
  );
}
