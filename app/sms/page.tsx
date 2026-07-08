import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Text message program — ${site.name}`,
  description: `How the ${site.name} text-message program works: how to opt in, message frequency, rates, HELP and STOP, and the privacy policy.`,
};

/**
 * The canonical opt-in Call-to-Action (CTA) page for the SMS program. Carries
 * every element a mobile carrier / 10DLC reviewer checks, in one place:
 * the specific opt-in path, message frequency, "message and data rates may
 * apply", HELP instructions, STOP instructions, and a link to the privacy
 * policy (with the mobile-opt-in-data no-sharing statement). This is the URL
 * to submit as the campaign's Call-to-Action / opt-in URL.
 */
export default function SmsProgram() {
  return (
    <div className="container prose">
      <h1>Text message program</h1>
      <p className="fine">Effective July 8, 2026</p>

      <p>
        {site.name} sends local classified ads for {site.region} as short text-message
        digests. This page explains, in one place, how to start the texts, how to stop them,
        and everything the program discloses. Summary of the terms below.
      </p>

      <h2>How to opt in</h2>
      <p>
        Text the keyword <strong>SUBSCRIBE</strong> (or <strong>START</strong>) to{" "}
        <strong className="tel">{site.smsNumber}</strong>. That is the only way the ad
        digests begin — you receive them only after you send that text. Posting or managing an
        ad by text also uses the same number.
      </p>
      <p>
        When you opt in, you get a one-time confirmation text like this:
      </p>
      <figure className="sms-example">
        <figcaption>Confirmation you receive after texting SUBSCRIBE:</figcaption>
        <p>
          You&rsquo;re subscribed to {site.name} — {site.region} classifieds by text, up to 4
          digests a day. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help.
        </p>
      </figure>

      <h2>Message frequency</h2>
      <p>
        Message frequency varies. You will receive up to <strong>4 ad-digest messages a
        day</strong>, plus a reply to any command you text us (for example, a balance check or
        an ad confirmation).
      </p>

      <h2>Message and data rates</h2>
      <p>
        <strong>Message and data rates may apply</strong>, charged by your mobile carrier
        according to your plan. {site.name} does not charge you for the text messages
        themselves.
      </p>

      <h2>Help</h2>
      <p>
        Reply <strong>HELP</strong> to <strong className="tel">{site.smsNumber}</strong> at any
        time for a list of commands and how to reach us. You can also call{" "}
        <strong className="tel">{site.supportPhone}</strong> or see{" "}
        <Link href="/how-it-works">how it works</Link>.
      </p>

      <h2>Stop the texts</h2>
      <p>
        Reply <strong>STOP</strong> to <strong className="tel">{site.smsNumber}</strong> at any
        time — or STOP to any digest — and the messages end. You&rsquo;ll get one confirmation
        that you&rsquo;ve been unsubscribed, and nothing after that. Reply{" "}
        <strong>START</strong> any time to come back.
      </p>

      <h2>Privacy</h2>
      <p>
        See our <Link href="/privacy">privacy policy</Link> for what we collect and how it is
        used.{" "}
        <strong>
          We will not share your mobile phone number, or your consent to receive text messages,
          with third parties or affiliates for their marketing or promotional purposes.
        </strong>{" "}
        Text-messaging opt-in data and consent are never sold and never passed to any third
        party.
      </p>

      <h2>The rest of the terms</h2>
      <p>
        Consent to receive the digests is not a condition of buying anything. Carriers are not
        liable for delayed or undelivered messages. Full details are in the{" "}
        <Link href="/terms-and-conditions">terms and conditions</Link> and the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </div>
  );
}
