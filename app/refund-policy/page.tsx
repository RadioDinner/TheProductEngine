import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Refund policy — ${site.name}`,
  description: `When ${site.name} returns an ad credit and when a credit is spent for good — in plain words.`,
};

export default function RefundPolicy() {
  return (
    <div className="container prose">
      <h1>Refund policy</h1>
      <p className="fine">Effective July 17, 2026</p>
      <p>
        {site.name} keeps money simple: subscribing and browsing are free, and posting
        ads uses prepaid credits. This page says exactly when a credit comes back to you
        and when it is spent for good. It goes hand in hand with the{" "}
        <Link href="/terms-and-conditions">terms and conditions</Link>.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Your ad never ran? You get the credit back.</li>
        <li>Your ad went out in a digest? The credit is spent — that was the product.</li>
        <li>Ads declined for breaking the rules are not refunded.</li>
      </ul>

      <h2>When a credit is returned</h2>
      <ul>
        <li>
          <strong>Declined for an ordinary reason.</strong> Every ad is read by a person
          before it runs. If we decline yours for an ordinary reason — too long, unclear,
          not a good fit — the credit (or free ad) is returned automatically, in full.
        </li>
        <li>
          <strong>Removed before approval.</strong> If your ad is deleted while it is
          still waiting for review, the credit is returned.
        </li>
        <li>
          <strong>Approved but never broadcast.</strong> If your ad was approved but is
          deleted before it has ever gone out in a digest, the credit is returned.
        </li>
      </ul>

      <h2>When a credit is spent for good</h2>
      <ul>
        <li>
          <strong>The ad ran.</strong> Once your ad has been sent out in any digest, the
          credit is used — the broadcast to the list is what the credit buys. Deleting
          the ad afterward does not return it.
        </li>
        <li>
          <strong>The ad broke the rules.</strong> If an ad is declined or removed for
          violating the{" "}
          <Link href="/terms-and-conditions">posting rules</Link>, the credit is kept and
          the ad counts as a strike.
        </li>
      </ul>

      <h2>Credit packs and card payments</h2>
      <p>
        Credit packs are sold on this website and, with a saved card, by texting{" "}
        <strong>BUYCREDIT</strong>. Payments are processed by Stripe; when a refund is
        granted on a purchase, it goes back to the card it was paid with. Credits have no
        cash value, don&rsquo;t expire, and can&rsquo;t be transferred; refunds of credit
        purchases themselves are at our discretion, except where the law says otherwise.
      </p>

      <h2>What has no charge to refund</h2>
      <p>
        Subscribing to the digests (text or email), browsing the website, and pulling ad
        pictures with <strong>PIC</strong> are free, so there is nothing to refund.
        Message and data rates from your phone company are between you and them.
      </p>

      <h2 id="questions">Questions or an unusual case</h2>
      <p>
        If something odd happened — a double charge, an ad that ran wrong, anything that
        doesn&rsquo;t fit the rules above — tell us and we will make it right where it is
        right to do so. Call <strong>{site.supportPhone}</strong> or text{" "}
        <strong>{site.smsNumber}</strong>.
      </p>
    </div>
  );
}
