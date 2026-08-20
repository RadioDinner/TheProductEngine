import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import Link from "next/link";
import { isAdminPhone } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { readSession } from "@/lib/session";
import { countUnreadChats } from "@/lib/store";
import { site } from "@/lib/config";
import { MessagesBadge } from "@/components/MessagesBadge";
import { GoogleAnalytics } from "@/analytics/src/GoogleAnalytics";
import { hashedMemberId } from "@/analytics/src/ids";
import { ANALYTICS_SALT, GA_MEASUREMENT_ID } from "@/analytics/src/config";
import "./globals.css";
import { HelpButton } from "@/components/HelpButton";

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
  // Analytics (analytics/). The OPERATOR is excluded outright, not just on
  // /admin: on a service this size their own browsing would be a meaningful
  // share of all traffic and would distort every rate on the dashboard. The
  // console's IP filter covers them signed out; this covers them on cellular,
  // on a borrowed laptop, and anywhere an IP filter quietly stops matching.
  const isAdmin = session ? isAdminPhone(session.phone) : false;
  // Salted on the SERVER — the salt never reaches the browser, and the hash
  // cannot be turned back into a phone number without it.
  const memberId = session ? hashedMemberId(session.phone, ANALYTICS_SALT) : "";
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
                    {/* A labeled destination, not the member's own phone number —
                        "click your number for settings" was the one nav link that
                        needed explaining (user request, session 016). The number
                        still shows on /account under Profile. */}
                    <Link href="/account">My account</Link>
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
            <p className="footer-actions">
              <Link className="btn btn-sm" href="/contact?type=question">
                Ask a question
              </Link>
              <Link className="btn btn-sm btn-secondary" href="/contact?type=idea">
                Suggest a feature
              </Link>
            </p>
            <p>
              Text <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> for the ads —
              ads arrive in batches, 7am&ndash;9pm Mon&ndash;Sat; msg &amp; data rates may apply. Text <strong>HELP</strong>{" "}
              for help, <strong>STOP</strong> to cancel ·{" "}
              <Link href="/email">Get the ads by email</Link> ·{" "}
              <Link href="/how-it-works">How it works</Link> ·{" "}
              <Link href="/faq">Questions</Link> ·{" "}
              <Link href="/advertising">Advertising for Businesses</Link>
            </p>
            <p>
              <Link href="/sms">Text message program</Link> ·{" "}
              <Link href="/privacy">Privacy policy</Link> ·{" "}
              <Link href="/terms-and-conditions">Terms and conditions</Link> ·{" "}
              <Link href="/refund-policy">Refund policy</Link> ·{" "}
              <Link href="/accessibility">Accessibility statement</Link>
            </p>
            <p>
              © 2026 by {site.name}. Powered and secured by CodeFuseSolutions ·{" "}
              <span className="footer-version">v{site.version}</span>
            </p>
          </div>
        </footer>
        <HelpButton />
        {!isAdmin && <GoogleAnalytics measurementId={GA_MEASUREMENT_ID} memberId={memberId} />}
      </body>
    </html>
  );
}
