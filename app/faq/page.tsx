import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Questions and answers — ${site.name}`,
  description: `Common questions about ${site.name}: subscribing, posting ads, pictures, credits, and getting help.`,
};

export default function Faq() {
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
        their ads in; everyone who subscribes gets the ads in short digests, up to four
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
        Getting the ads is free. Browsing the website is free. Posting an ad uses ad
        credits — a plain ad costs 1 credit, a picture ad costs 5 — and{" "}
        <strong>new members start with 3 free ads</strong>, picture or plain. Credit packs
        are sold on this website under <Link href="/account">your account</Link>.
      </p>

      <h2>How do I start getting the ads?</h2>
      <p>
        Text <span className="cmd">SUBSCRIBE</span> to <strong>{site.smsNumber}</strong>.
        That&rsquo;s it. Digests arrive up to four times a day — morning, noon, afternoon,
        and evening — and slots with no new ads are skipped. Reply{" "}
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
        approved, it goes out in the next digest, and it stays listed on this website for
        30 days. You&rsquo;ll get a text with your ad&rsquo;s number when it&rsquo;s in.
      </p>

      <h2>How do pictures work?</h2>
      <p>
        When a digest says an ad has a picture, reply <span className="cmd">PIC</span>{" "}and
        the ad&rsquo;s number — like <span className="cmd">PIC 1042</span> — and the picture
        comes back to you by text, free. On the website, pictures show right on the ad.
      </p>

      <h2>Why wasn&rsquo;t my ad accepted?</h2>
      <p>
        Most often it&rsquo;s something ordinary — too long, unclear, or not a fit for the
        service. When that happens, your credit or free ad is returned and you can fix it
        and resend. Ads that break the rules (see the{" "}
        <Link href="/terms-and-conditions">terms</Link>) keep the charge and count as a
        strike.
      </p>

      <h2>I sold my item. Now what?</h2>
      <p>
        Text <span className="cmd">SOLD</span> and your ad number — like{" "}
        <span className="cmd">SOLD 1042</span> — and the listing is marked sold. Honest
        listings keep the service worth reading.
      </p>

      <h2>Can I run my ad again?</h2>
      <p>
        Yes — text <span className="cmd">BUMP</span> and your ad number and it runs again
        in the next digest. Bumps are free for now.
      </p>

      <h2>Is my phone number shown to everyone?</h2>
      <p>
        Whatever you write in your ad goes out in the digests — most sellers include their
        number so buyers can reach them. On the website, contact details in ads are masked
        until a visitor signs in. We never sell your information or share your number with
        marketers; the details are in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>How do I pay for credits?</h2>
      <p>
        Buy a credit pack on this website — sign in, pick a pack, and pay by card on a
        secure checkout page. Prefer to handle it by phone or mail? Call{" "}
        <strong>{site.supportPhone}</strong>{" "}and we&rsquo;ll set it up.
      </p>

      <h2>How do I stop the texts?</h2>
      <p>
        Reply <span className="cmd">STOP</span> to any digest, or text{" "}
        <span className="cmd">STOP</span> to <strong>{site.smsNumber}</strong>. That ends
        the digests immediately. Reply <span className="cmd">START</span> if you change
        your mind. Message and data rates may apply while subscribed.
      </p>

      <h2>Something else?</h2>
      <p>
        Call <strong>{site.supportPhone}</strong> or text <strong>{site.smsNumber}</strong>. A
        person answers, and plain questions get plain answers.
      </p>
    </div>
  );
}
