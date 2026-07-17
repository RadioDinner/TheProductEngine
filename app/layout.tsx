import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import Link from "next/link";
import { isAdminPhone } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { formatPhone } from "@/lib/phone";
import { readSession } from "@/lib/session";
import { countUnreadChats } from "@/lib/store";
import { site } from "@/lib/config";
import { MessagesBadge } from "@/components/MessagesBadge";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${site.name} — ${site.region} classifieds by text message`,
  description: `Local classified ads for ${site.region}. Get the ads by text message — text SUBSCRIBE to ${site.smsNumber}. Post an ad from any phone, no smartphone needed.`,
};

function todayLine(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  // Initial badge count, server-rendered cheap (item 12); the client badge
  // polls /api/unread from there.
  const unread = session ? await countUnreadChats(session.phone) : 0;
  return (
    <html lang="en" className={`${newsreader.variable} ${publicSans.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="masthead">
          <div className="container">
            <div className="folio">
              <span>{todayLine()}</span>
              <nav aria-label="Site" className="folio-nav">
                {session ? (
                  <>
                    {isAdminPhone(session.phone) && (
                      <>
                        <Link href="/admin">Admin</Link>
                        {" · "}
                      </>
                    )}
                    <MessagesBadge initialUnread={unread} />
                    {" · "}
                    <Link href="/account/ads">My ads</Link>
                    {" · "}
                    <Link href="/account">{formatPhone(session.phone)}</Link>
                    {" · "}
                    <form action={signOut} className="inline-form">
                      <button className="link-button" type="submit">
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <Link href="/login">Sign in</Link>
                )}
                {" · "}
                <Link href="/how-it-works">How it works</Link>
              </nav>
            </div>
            <p className="nameplate">
              <Link href="/">{site.name}</Link>
            </p>
            <p className="tagline">
              {site.tagline} · {site.region}
            </p>
          </div>
          <div className="rule-double" aria-hidden="true" />
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container">
            <p>
              {site.name} — classifieds by text message for {site.region}.
            </p>
            <p>
              Text <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> for the ads —
              up to 4 digests a day, msg &amp; data rates may apply. Text <strong>HELP</strong>{" "}
              for help, <strong>STOP</strong> to cancel ·{" "}
              <Link href="/email">Get the ads by email</Link> ·{" "}
              <Link href="/how-it-works">How it works</Link> ·{" "}
              <Link href="/faq">Questions</Link>
            </p>
            <p>
              <Link href="/sms">Text message program</Link> ·{" "}
              <Link href="/privacy">Privacy policy</Link> ·{" "}
              <Link href="/terms-and-conditions">Terms and conditions</Link> ·{" "}
              <Link href="/refund-policy">Refund policy</Link> ·{" "}
              <Link href="/accessibility">Accessibility statement</Link>
            </p>
            <p>
              © 2026 by {site.name}. Powered and secured by CodeFuseSolutions
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
