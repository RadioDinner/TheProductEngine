import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import Link from "next/link";
import { isAdminPhone } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { formatPhone } from "@/lib/phone";
import { readSession } from "@/lib/session";
import { site } from "@/lib/config";
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
              Text <strong>HELP</strong> to <strong>{site.smsNumber}</strong> for help · Reply{" "}
              <strong>STOP</strong> to any digest to cancel ·{" "}
              <Link href="/email">Get the ads by email</Link> ·{" "}
              <Link href="/how-it-works">How it works</Link> ·{" "}
              <Link href="/faq">Questions</Link>
            </p>
            <p>
              <Link href="/privacy">Privacy policy</Link> ·{" "}
              <Link href="/terms-and-conditions">Terms and conditions</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
