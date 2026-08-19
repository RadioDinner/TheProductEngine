import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice, site } from "@/lib/config";
import { getEngineSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: `Questions and answers — ${site.name}`,
  description: `Common questions about ${site.name}: subscribing, posting ads, pictures, credits, and getting help.`,
};

export default async function Faq() {
  // Live prices, so this page can never drift from /admin/settings again.
  const s = await getEngineSettings();
  return (
    <div className="container prose">
      <h1>Questions and answers</h1>
      <p>
        The common questions, answered plainly. For the full walkthrough of every command,
        see <Link href="/how-it-works">how it works</Link> — and you can always text{" "}
        <span className="cmd">HELP</span> to <strong>{site.smsNumber}</strong>, or call us at{" "}
        <strong>{site.supportPhone}</strong>.
      </p>

      <h2>What is {site.name}?</h2>
      <p>
        Local classified ads for {site.region}, delivered by text message. Sellers text
        their ads in; everyone who subscribes gets each ad by text as it’s posted, up to four
        times a day. The ads are also listed on this website, and there&rsquo;s an email
        edition if you prefer email.
      </p>

      <h2>Do I need a smartphone or the internet?</h2>
      <p>
        No. Any phone that can send a text message works — that&rsquo;s the point. The
        website is extra, not required.
      </p>

      <h2>What does it cost?</h2>
      <p>
        Getting the ads is free. Browsing the website is free. Posting an ad costs money —
        a plain ad is {formatPrice(s.costTextCents)}, a picture ad (up to three pictures) starts at{" "}
        {formatPrice(s.costPhotoCents)} — and{" "}
        <strong>
          every new member&rsquo;s first post comes with {formatPrice(s.starterCreditCents)}{" "}
          of ad credit on the house
        </strong>
        . Your ads go out by text and list on this website
        {s.webAddonCents > 0
          ? ` (the website listing is ${formatPrice(s.webAddonCents)} more)`
          : ""}
        .
      </p>

      <h2>How do I start getting the ads?</h2>
      <p>
        Text <span className="cmd">SUBSCRIBE</span> to <strong>{site.smsNumber}</strong>.
        That&rsquo;s it. Each ad arrives as a text the moment it&rsquo;s approved, between
        7am and 9pm Monday through Saturday — nothing overnight or on Sunday. Reply{" "}
        <span className="cmd">STOP</span> any time to quit.
      </p>

      <h2>How do I post an ad?</h2>
      <p>
        Text <span className="cmd">AD NEW</span> followed by your ad to{" "}
        <strong>{site.smsNumber}</strong>. Say what you&rsquo;re selling, the price, and how
        to reach you, in under 250 characters. Attach a picture if you have one.
      </p>

      <h2>Who sees my ad, and when?</h2>
      <p>
        Every ad is read and approved by a person first — usually the same day. Once
        approved, it goes straight out to subscribers, and it stays listed on this website for
        30 days. You&rsquo;ll get a text with your ad&rsquo;s number when it&rsquo;s in.
      </p>

      <h2>How do pictures work?</h2>
      <p>
        When a text says an ad has a picture, reply <span className="cmd">PIC</span>{" "}and
        the ad&rsquo;s number — like <span className="cmd">PIC 1042</span> — and the picture
        comes back to you by text, free. On the website, pictures show right on the ad.
      </p>

      <h2>Why wasn&rsquo;t my ad accepted?</h2>
      <p>
        Most often it&rsquo;s something ordinary — too long, unclear, or not a fit for the
        service. When that happens, your money is returned in full and you can fix it and
        resend. Ads that break the rules (see the{" "}
        <Link href="/terms-and-conditions">terms</Link>) keep the charge and count as a
        strike.
      </p>

      <h2>I sold my item. Now what?</h2>
      <p>
        Text <span className="cmd">SOLD</span> and your ad number — like{" "}
        <span className="cmd">SOLD 1042</span> — and the listing is marked sold. Honest
        listings keep the service worth reading.
      </p>

      <h2>Is my phone number shown to everyone?</h2>
      <p>
        Whatever you write in your ad goes out with it — most sellers include their
        number so buyers can reach them. On the website, contact details in ads are masked
        until a visitor signs in. We never sell your information or share your number with
        marketers; the details are in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>How do I pay?</h2>
      <p>
        Add money to your account on this website — sign in, pick an amount, and pay by
        card on a secure checkout page. Once a card is saved, ads can top up automatically:
        if your balance comes up a little short, the difference goes on your card and the
        confirmation text says so. Prefer to handle it by phone or check? Call{" "}
        <strong>{site.supportPhone}</strong> and we&rsquo;ll set it up.
      </p>

      <h2>How do I stop the texts?</h2>
      <p>
        Reply <span className="cmd">STOP</span> to any text from us, or text{" "}
        <span className="cmd">STOP</span> to <strong>{site.smsNumber}</strong>. That ends
        the ads immediately. Reply <span className="cmd">START</span> if you change
        your mind. Message and data rates may apply while subscribed.
      </p>

      <h2>Something else?</h2>
      <p>
        Call or text <strong>{site.supportPhone}</strong>. A
        person answers, and plain questions get plain answers.
      </p>
    </div>
  );
}
