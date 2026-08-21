import { recordVisit } from "@/lib/analytics";
import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Refund policy — ${site.name}`,
  description: `When ${site.name} returns an ad credit and when a credit is spent for good — in plain words.`,
};

export default async function RefundPolicy() {
  await recordVisit("/refund-policy");
  return (
    <div className="container prose">
      <h1>Refund policy</h1>
      <p className="fine">Effective July 17, 2026 · updated August 21, 2026 (unused balances are refundable on request)</p>
      <p>
        {site.name} keeps money simple: subscribing and browsing are free, and posting
        ads comes off your prepaid ad-credit balance, in dollars. This page says exactly
        when your money comes back to you and when it is spent for good. It goes hand in
        hand with the <Link href="/terms-and-conditions">terms and conditions</Link>.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>Your ad never ran? You get your money back.</li>
        <li>Your ad went out? The money is spent — that was the product.</li>
        <li>Ads declined for breaking the rules are not refunded.</li>
        <li>
          Money still sitting on your account, unspent? Ask and we send it back, minus
          the card processing fee of about 5%.
        </li>
        <li>Free credit we gave you isn&rsquo;t money, so it can&rsquo;t come back as money.</li>
      </ul>

      <h2>When your money is returned</h2>
      <ul>
        <li>
          <strong>Declined for an ordinary reason.</strong> Every ad is read by a person
          before it runs. If we decline yours for an ordinary reason — too long, unclear,
          not a good fit — the full charge is returned to your balance automatically.
        </li>
        <li>
          <strong>Removed before approval.</strong> If your ad is deleted while it is
          still waiting for review, the charge is returned.
        </li>
        <li>
          <strong>Approved but never broadcast.</strong> If your ad was approved but is
          deleted before it has ever gone out to the list, the charge is returned.
        </li>
      </ul>

      <h2>When the money is spent for good</h2>
      <ul>
        <li>
          <strong>The ad ran.</strong> Once your ad has been sent out to the list, the
          money is used — the broadcast to the list is what it buys. Deleting the ad
          afterward does not return it.
        </li>
        <li>
          <strong>The ad broke the rules.</strong> If an ad is declined or removed for
          violating the{" "}
          <Link href="/terms-and-conditions">posting rules</Link>, the charge is kept and
          the ad counts as a strike.
        </li>
      </ul>

      <h2>Adding money and card payments</h2>
      <p>
        You add money to your account on this website; with a saved card, your balance
        can also top up automatically at posting time (the confirmation text always
        states the charge, and the toggle is under your account). Payments are processed
        by Stripe; a refund goes back to the card it was paid with. Ad credit
        doesn&rsquo;t expire and can&rsquo;t be transferred to someone else.
      </p>

      <h2 id="unused">Getting your unused balance back</h2>
      <p>
        <strong>
          Money you have added and not yet spent is yours, and you can ask for it back at
          any time.
        </strong>{" "}
        Call or text <strong>{site.supportPhone}</strong> and we return what is left of
        the money you paid to the card you paid with,{" "}
        <strong>minus the card processing fee of about 5%</strong>. There is no deadline
        to ask and no charge for asking beyond that fee.
      </p>
      <p>
        The fee is not a penalty — it is a cost we have already paid. Our card processor
        takes its fee when your payment comes in and keeps it whether or not the payment
        is later refunded, so returning $100 costs us the fee twice over unless we hold
        it back. <strong>There is no fee at all when the fault is ours</strong> — a
        double charge, an ad we pulled, an outage, or anything else we got wrong comes
        back in full.
      </p>
      <p>
        <strong>Free ad credit is not money and is never refundable.</strong> Welcome
        credit, credit that comes with an invitation, and any credit we add to make
        something right are ours to give, not cash you paid us. If your balance is part
        money and part free credit, only the part you actually paid can come back — and
        when you post an ad we spend your free credit first, so your own money stays
        yours for as long as it honestly can. Ask us any time and we will tell you
        exactly how much of your balance is money you paid.
      </p>

      <h2>What has no charge to refund</h2>
      <p>
        Subscribing (by text or email), browsing the website, and pulling ad
        pictures with <strong>PIC</strong> are free, so there is nothing to refund.
        Message and data rates from your phone company are between you and them.
      </p>

      <h2 id="questions">Questions or an unusual case</h2>
      <p>
        If something odd happened — a double charge, an ad that ran wrong, anything that
        doesn&rsquo;t fit the rules above — tell us and we will make it right where it is
        right to do so. Call or text <strong>{site.supportPhone}</strong>.
      </p>
    </div>
  );
}
