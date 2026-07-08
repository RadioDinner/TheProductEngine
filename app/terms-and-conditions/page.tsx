import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Terms and conditions — ${site.name}`,
  description: `The plain rules for using ${site.name} — the text-message program, ads, credits, and accounts.`,
};

export default function TermsAndConditions() {
  return (
    <div className="container prose">
      <h1>Terms and conditions</h1>
      <p className="fine">Effective July 7, 2026</p>
      <p>
        These are the rules for using {site.name}, the classified ads service for{" "}
        {site.region} that runs by text message and on this website. By subscribing,
        posting an ad, or using the website, you agree to them. They are written to be
        read — if anything is unclear, ask us before you rely on it.
      </p>

      <h2>The service</h2>
      <p>
        {site.name} gathers classified ads from local sellers and sends them out in short
        digests by text message, and by email for those who prefer it. Approved ads are
        also listed on this website, typically for 30 days. Subscribing and browsing are
        free; posting ads uses credits. How it all works, step by step, is on the{" "}
        <Link href="/how-it-works">how it works</Link> page.
      </p>

      <h2>The text message program</h2>
      <ul>
        <li>
          You join by texting <strong>SUBSCRIBE</strong> (or START) to{" "}
          <strong>{site.smsNumber}</strong>, and you can leave any time by replying{" "}
          <strong>STOP</strong>. Reply <strong>HELP</strong> for help.
        </li>
        <li>
          Message frequency varies: up to four ad digests a day, plus replies to the
          commands you send.
        </li>
        <li>Message and data rates may apply, charged by your phone company.</li>
        <li>
          Phone carriers are not liable for delayed or undelivered messages. Delivery
          depends on your carrier and coverage.
        </li>
        <li>
          Consent to receive digests is not a condition of buying anything.
        </li>
      </ul>

      <h2>Your account</h2>
      <p>
        An account is created for your phone number the first time you use the service.
        On the website you sign in with your number, a texted code, and a password. Keep
        your password to yourself — what happens under your account is your
        responsibility. One person, one account. You must be at least 18 to post ads or
        buy credits.
      </p>

      <h2>Posting ads</h2>
      <p>
        Every ad is read by a person before it runs. We may lightly edit ad text for
        clarity or length without changing its meaning. We may decline any ad. If we
        decline an ad for an ordinary reason — too long, unclear, not a good fit — your
        credit or free ad is returned. If an ad breaks the rules below, the credit is
        kept and the ad counts as a strike; three strikes and you can no longer post,
        though you can still browse and subscribe. Sold something? Say so —{" "}
        <strong>SOLD</strong> plus your ad number keeps the listings honest.
      </p>

      <h2>What you may not post</h2>
      <ul>
        <li>Anything illegal to sell or advertise, or anything you don&rsquo;t own or have the right to sell.</li>
        <li>Dishonest, misleading, or deliberately incomplete ads.</li>
        <li>Offensive or hateful content.</li>
        <li>Ads for someone else&rsquo;s business posted as if it were a private sale.</li>
        <li>Anything that risks the safety or trust of the people reading the digests.</li>
      </ul>
      <p>
        Some categories may be flagged for extra review or declined outright at our
        judgment. Our judgment on what runs is final.
      </p>

      <h2>Credits and payments</h2>
      <p>
        Posting an ad uses credits (a picture ad uses more than a plain one — current
        prices are shown when you post and by texting <strong>CREDITS</strong>). New
        members start with free ads. Credit packs are sold on this website and, with a
        saved card, by texting <strong>BUYCREDIT</strong> — you will always be asked to
        confirm before anything is charged. Payments are processed by Stripe.
      </p>
      <p>
        Credits have no cash value, don&rsquo;t expire, and can&rsquo;t be transferred or
        redeemed for money. Refunds of credit purchases are at our discretion, except
        where the law says otherwise; credits spent on declined-for-ordinary-reasons ads
        are returned as described above.
      </p>

      <h2>Buying and selling</h2>
      <p>
        {site.name}{" "}is the bulletin board, not a party to any sale. Sellers and buyers
        deal with each other directly and are responsible for the item, the price, the
        payment, and the meeting. We don&rsquo;t inspect items, guarantee their condition,
        or handle the money between buyer and seller. Use ordinary care and good sense,
        as you would with any classified ad.
      </p>

      <h2>Your ads, our service</h2>
      <p>
        Your ads stay yours. By submitting an ad you give us permission to run it — in
        the digests, in the email edition, and on this website — and to keep the record
        of it. We may remove any ad or listing at any time. The service&rsquo;s own text,
        design, and name belong to us.
      </p>

      <h2>Ending accounts</h2>
      <p>
        You can stop using the service any time — reply STOP to leave the digests, or ask
        us to close your account. We may suspend or close accounts that break these
        terms, abuse the service, or put other members at risk.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The service is provided as-is. We work to keep it running and honest, but we
        don&rsquo;t promise it will be uninterrupted or error-free, and we make no
        warranties about items advertised — those are the seller&rsquo;s statements, not
        ours.
      </p>

      <h2>Limits on liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential
        damages, or for disputes between buyers and sellers. For anything else, our total
        liability is limited to what you paid us in the twelve months before the claim.
        Nothing here limits liability that the law does not allow to be limited.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Ohio. Disputes will be
        handled in the courts of Holmes County, Ohio, unless the law requires otherwise.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we change these terms, we will post the new version here with a new effective
        date. A meaningful change will be announced in the digest or by email. Using the
        service after a change means you accept it.
      </p>

      <h2>Contact</h2>
      <p>
        Call <strong>{site.supportPhone}</strong> or text <strong>{site.smsNumber}</strong>, or
        write to us through the website. See also the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </div>
  );
}
