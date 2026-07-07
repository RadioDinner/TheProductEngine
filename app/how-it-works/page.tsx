import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `How it works — ${site.name}`,
  description: `How to get the ads, post an ad, and manage your ads by text message on ${site.name}.`,
};

const COMMANDS: { cmd: string; what: string }[] = [
  { cmd: "SUBSCRIBE", what: "Start getting the ad digests. Free." },
  { cmd: "STOP", what: "Stop getting digests. Reply START to come back." },
  { cmd: "HELP", what: "Get this list of commands by text." },
  { cmd: "AD NEW your ad text", what: "Post an ad. Attach a picture if you have one." },
  { cmd: "PIC 1234", what: "Get the picture for ad number 1234." },
  { cmd: "STATUS 1234", what: "Check if an ad is still available or sold." },
  { cmd: "SOLD 1234", what: "Mark your ad sold (your ads only)." },
  { cmd: "BUMP 1234", what: "Run your ad again in the next digest." },
  { cmd: "MYADS", what: "List your ads and their status." },
  { cmd: "CREDITS", what: "Check how many ad credits you have." },
  { cmd: "BUYCREDIT 10", what: "Buy a credit pack with your saved card." },
];

export default function HowItWorks() {
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
        You’ll get new ads bundled into short digests, up to four times a day — morning, noon,
        afternoon, and evening. It’s free. Reply <span className="cmd">STOP</span> any time to
        quit, or <span className="cmd">HELP</span> for help.
      </p>
      <p>
        When an ad has a picture, the digest says so. Reply{" "}
        <span className="cmd">PIC 1234</span> (the ad’s number) and the picture comes back to
        you by text.
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
        <span className="cmd">AD NEW</span>. Say what you’re selling, the price, and how to
        reach you. Attach a picture if you’d like — picture ads cost more credits than plain
        ones. Keep it under 250 characters.
      </p>
      <figure className="sms-example">
        <figcaption>
          Example — text this to {site.smsNumber}, with a photo attached if you have one:
        </figcaption>
        <p>AD NEW Horse cart for sale, $1,000 OBO. Good shape. Leroy P., 330-555-0142, Mt. Hope.</p>
      </figure>
      <p>
        Every ad is read and approved by a person before it runs. Once approved, your ad goes
        out in the next digest and is listed on this website for 30 days. You’ll get a text
        with your ad’s number when it’s in. New members start with{" "}
        <strong>3 free ads</strong> — picture or plain.
      </p>

      <h2>Manage your ad</h2>
      <p>
        Sold it? Text <span className="cmd">SOLD 1234</span> and the listing is marked sold.
        Want more eyes on it? Text <span className="cmd">BUMP 1234</span> and it runs again in
        the next digest. Forgot your ad numbers? Text <span className="cmd">MYADS</span>.
      </p>

      <h2>Credits</h2>
      <p>
        Ads use credits; checking, browsing, and getting digests are free. Text{" "}
        <span className="cmd">CREDITS</span> any time to see your balance. Buy credit packs on
        this website, or text <span className="cmd">BUYCREDIT 10</span> to buy with a card you’ve
        saved — you’ll be asked to reply YES to confirm before anything is charged. You can also
        call <strong>{site.smsNumber}</strong> to set up payment by phone or mail.
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
