import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Privacy policy — ${site.name}`,
  description: `What ${site.name} collects, how it's used, and the choices you have.`,
};

export default function PrivacyPolicy() {
  return (
    <div className="container prose">
      <h1>Privacy policy</h1>
      <p className="fine">Effective July 7, 2026</p>
      <p>
        {site.name} is a classified ads service for {site.region} that runs on plain text
        messages and this website. This page says, in plain words, what information we
        collect, what we do with it, and the choices you have. If anything here is unclear,
        ask us — see <Link href="#questions">Questions</Link> at the bottom.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We collect what we need to run the service and nothing more.</li>
        <li>We do not sell your information to anyone.</li>
        <li>
          We never share your phone number or your text-message opt-in with other companies
          for their marketing.
        </li>
        <li>You can stop the texts any time by replying STOP.</li>
      </ul>

      <h2>What we collect</h2>
      <p>
        <strong>Your phone number.</strong> It is how the service knows you — for digests,
        for posting ads, and for signing in to this website.
      </p>
      <p>
        <strong>Your email address</strong>, only if you give it to us for the email edition
        or add it to your account.
      </p>
      <p>
        <strong>Your ads</strong> — the text you send, and any picture you attach.
      </p>
      <p>
        <strong>Messages to and from the service.</strong> We keep a record of the text
        messages and emails the service sends and receives, so we can answer questions,
        fix problems, and keep the service honest.
      </p>
      <p>
        <strong>Payment records.</strong> Card payments are handled by Stripe, our payment
        processor. We never see or store your full card number. We keep a record of your
        credit purchases and how credits are spent.
      </p>
      <p>
        <strong>Sign-in basics.</strong> A password (stored scrambled, never as plain text)
        and a cookie that keeps you signed in on this website.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To send the ad digests you signed up for, by text or email.</li>
        <li>To run your ads and let buyers reach you.</li>
        <li>To review every ad before it runs, and keep the service safe and honest.</li>
        <li>To handle payments, credits, and refunds.</li>
        <li>To answer you when you write or call for help.</li>
      </ul>
      <p>
        We do not use your information for advertising other people&rsquo;s products, and we
        do not track you around the internet.
      </p>

      <h2>Text messaging consent</h2>
      <p>
        You only get texts from us if you asked for them — by texting SUBSCRIBE (or START)
        to <strong>{site.smsNumber}</strong>, or by using the service to post and manage
        ads. Message frequency varies: up to four ad digests a day, plus replies to the
        commands you send. Message and data rates may apply, charged by your phone company.
      </p>
      <p>
        Reply <strong>STOP</strong> any time to stop the digests. Reply{" "}
        <strong>HELP</strong> for help, or call <strong>{site.supportPhone}</strong> or text{" "}
        <strong>{site.smsNumber}</strong>.
      </p>
      <p>
        <strong>
          We will not share your mobile phone number, or your consent to receive text
          messages, with third parties or affiliates for their marketing or promotional
          purposes.
        </strong>{" "}
        Text messaging originator opt-in data and consent are never sold and never passed
        to any third party for marketing.
      </p>

      <h2>What we share</h2>
      <p>
        We share information only with the companies that help us run the service, and only
        so they can do their jobs for us:
      </p>
      <ul>
        <li>Our text-message carrier, to deliver the texts.</li>
        <li>Our email provider, to deliver the email edition.</li>
        <li>Stripe, to process card payments.</li>
        <li>Our hosting and database providers, to run the website and store the records.</li>
      </ul>
      <p>
        None of them may use your information for their own marketing. Beyond that, we share
        information only if the law requires it, or to protect the service and its members
        from fraud or abuse. We do not sell personal information.
      </p>

      <h2>What&rsquo;s public</h2>
      <p>
        Ads are public — that is the point of an ad. The ad text and picture you submit
        appear in the digests, in the email edition, and on this website. Your contact
        details inside an ad are masked on the website until a visitor signs in. Keep in
        mind that anything you put in an ad can be seen by the people who get the ads.
      </p>

      <h2>Cookies</h2>
      <p>
        This website uses one kind of cookie: the one that keeps you signed in. No
        advertising cookies, no analytics trackers, no third-party cookies.
      </p>

      <h2>How long we keep things</h2>
      <p>
        We keep account, ad, message, and payment records while your account is active and
        as long as we need them to run the service, settle disputes, and meet legal and tax
        obligations. If you want your account or information removed, ask us — see{" "}
        <Link href="#questions">Questions</Link>.
      </p>

      <h2>Security</h2>
      <p>
        Records are stored with reputable providers, connections to this website are
        encrypted, and passwords are stored scrambled. No system is perfect, but we keep
        the service small, plain, and careful.
      </p>

      <h2>Children</h2>
      <p>
        The service is not directed at children under 13, and we do not knowingly collect
        information from them.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Stop the texts:</strong> reply STOP to any digest, or text STOP to{" "}
          {site.smsNumber}.
        </li>
        <li>
          <strong>Stop the emails:</strong> every email edition has an unsubscribe link.
        </li>
        <li>
          <strong>See or correct your information:</strong> sign in to your account, or ask
          us.
        </li>
        <li>
          <strong>Delete your account:</strong> ask us and we will remove it, keeping only
          what the law requires us to keep.
        </li>
      </ul>

      <h2>Changes to this policy</h2>
      <p>
        If we change this policy, we will post the new version here with a new effective
        date. A meaningful change will be announced in the digest or by email.
      </p>

      <h2 id="questions">Questions</h2>
      <p>
        Call <strong>{site.supportPhone}</strong> or text <strong>{site.smsNumber}</strong>, or
        write to us through the website. See also the{" "}
        <Link href="/terms-and-conditions">terms and conditions</Link> and{" "}
        <Link href="/how-it-works">how it works</Link>.
      </p>
    </div>
  );
}
