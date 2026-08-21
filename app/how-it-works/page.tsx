import { recordVisit } from "@/lib/analytics";
import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice, site } from "@/lib/config";
import { getEngineSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: `How it works — ${site.name}`,
  description: `How to get the ads, post an ad, and manage your ads by text message on ${site.name}.`,
};

const COMMANDS: { cmd: string; what: string }[] = [
  { cmd: "SUBSCRIBE", what: "Start getting the ads by text. Free." },
  { cmd: "STOP", what: "Stop getting the ads. Reply START to come back." },
  { cmd: "HELP", what: "Get this list of commands by text." },
  { cmd: "AD your ad text", what: "Post an ad. Attach a picture if you have one." },
  { cmd: "PIC 1234", what: "See more pictures of ad number 1234 (up to two)." },
  { cmd: "STATUS 1234", what: "Check if an ad is still available or sold." },
  { cmd: "SOLD 1234", what: "Mark your ad sold (your ads only)." },
  { cmd: "MYADS", what: "List your ads and their status." },
  { cmd: "BAL", what: "Check your ad-credit balance." },
];

export default async function HowItWorks() {
  await recordVisit("/how-it-works");
  const s = await getEngineSettings();
  return (
    <div className="container prose">
      <h1>How it works</h1>
      <p>
        {site.name} is a classified ads service for {site.region} that runs on plain text
        messages. No smartphone, no app, no internet needed — any phone that can send a text
        works. The commands below all get texted to <strong>{site.smsNumber}</strong>.
      </p>

      <h2>Get the ads</h2>
      <p>
        Text <span className="cmd">SUBSCRIBE</span> to <strong>{site.smsNumber}</strong>.
        You’ll get the ads in batches through the day — several in one text, each with its
        own ad number — between 7am and 6pm, Monday through Saturday. It’s free, though
        message and data rates may apply from your phone company. Reply <span className="cmd">STOP</span> any time to quit, or{" "}
        <span className="cmd">HELP</span> for help. See the{" "}
        <Link href="/sms">text message program terms</Link> and{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
      <p>
        An ad with pictures sends one of them right after the batch, in its own message,
        marked with the ad number in the corner. Reply <span className="cmd">PIC 1234</span>{" "}
        (the ad’s number) for up to two more; the rest are on this website.
      </p>

      <h2>Get the ads by email</h2>
      <p>
        Prefer email? The email edition carries the same ads with the pictures right in the
        message, twice a day. <Link href="/email">Sign up here</Link> — every email has an
        unsubscribe link.
      </p>

      <h2>Post an ad</h2>
      <p>
        Text your ad to <strong>{site.smsNumber}</strong> starting with the words{" "}
        <span className="cmd">AD</span>. Say what you’re selling, the price, and how to
        reach you. A plain ad is {formatPrice(s.costTextCents)}; attach pictures (up to
        four) and it’s a picture ad at {formatPrice(s.costPhotoCents)}. Keep it under{" "}
        {s.maxChars} characters.
      </p>
      <figure className="sms-example">
        <figcaption>
          Example — text this to {site.smsNumber}, with a photo attached if you have one:
        </figcaption>
        <p>AD NEW Horse cart for sale, $1,000 OBO. Good shape. Call 330-555-0142. Mt. Hope.</p>
      </figure>
      <p>
        Every ad is read and approved by a person before it runs. Once approved, your ad goes
        out to subscribers with the next batch — with its first picture, if it has one,
        marked with your ad number — and is listed on this website for {s.expiryDays} days.
        You’ll get a text with your ad’s number when it’s in.{" "}
        <strong>
          Your first post comes with {formatPrice(s.starterCreditCents)} of ad credit on the
          house
        </strong>{" "}
        — enough for your first few ads.
      </p>

      <h2>Manage your ad</h2>
      <p>
        Sold it? Text <span className="cmd">SOLD 1234</span> and the listing is marked sold.
        Forgot your ad numbers? Text <span className="cmd">MYADS</span>.
      </p>

      <h2>Paying for ads</h2>
      <p>
        Ads come off your ad-credit balance; checking, browsing, and receiving ads are
        free. Text <span className="cmd">BAL</span> any time to see your balance. Add
        money on this website under <Link href="/account">your account</Link> — once a card
        is saved there, ads can top up automatically when your balance runs short (the
        confirmation text always says so). You can also call{" "}
        <strong>{site.supportPhone}</strong> to set up payment by phone or check.
      </p>

      <h2>All the commands</h2>
      <table className="cmd-table">
        <thead>
          <tr>
            <th scope="col">Text this</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          {COMMANDS.map((row) => (
            <tr key={row.cmd}>
              <td>
                <span className="cmd">{row.cmd}</span>
              </td>
              <td>{row.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Commands work with or without a slash, capitals or not — <em>ad new</em> works the same
        as <em>AD NEW</em>. Print this page and keep it by the phone.
      </p>
    </div>
  );
}
