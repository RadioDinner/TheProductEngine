"use client";

/**
 * The browser tag. One component, dropped into app/layout.tsx, and nothing
 * else in the app has to know gtag exists.
 *
 *  * Four things here are deliberate and easy to undo by accident:
 *
 * 1. **Consent and the advertising switches are pushed before `config`.**
 *    gtag applies consent state at the moment `config` runs; a consent call
 *    that arrives afterwards is too late for the hits already sent. That is
 *    why it all lives in one inline script in a fixed order rather than being
 *    spread across components.
 *
 * 2. **`send_page_view: false`, and page views are sent by hand.** The App
 *    Router changes pages without a document load, so the automatic page view
 *    fires once — on the first landing — and then never again. Every internal
 *    navigation would be invisible, and time-on-page would be nonsense.
 *
 * 3. **`useSearchParams` sits inside a Suspense boundary.** Next requires it:
 *    without the boundary the whole route opts out of static rendering, which
 *    would quietly make every page slower to serve in order to count it.
 *
 * 4. **It renders nothing and can fail without consequence.** If the script is
 *    blocked — ad blockers, a locked-down browser, no JavaScript at all, which
 *    on this site is a real and sizeable share of visitors — the page is
 *    unaffected. The server-side counter and the Measurement Protocol events
 *    still see those people; this component is the bonus, not the baseline.
 */

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { attachClickTracking } from "./clicks";

interface Props {
  measurementId: string;
  /**
   * Salted hash of the signed-in member's phone (analytics/src/ids.ts),
   * computed on the SERVER and passed down. Never a phone number, and the
   * browser never sees the salt.
   */
  memberId?: string;
  /**
   * Whether analytics cookies may be set. Defaults to true because this is a
   * US-only service with no advertising, but it is a prop rather than a
   * constant so a consent banner can drive it later without touching this
   * file. See analytics/05-privacy-and-consent.md.
   */
  analyticsConsent?: boolean;
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const query = searchParams?.toString() ?? "";
    const pagePath = query ? `${pathname}?${query}` : pathname;
    // React runs effects twice in development Strict Mode; without this guard
    // every local page view is double-counted and the numbers you use to
    // sanity-check the integration are wrong from the start.
    if (lastSent.current === pagePath) return;
    lastSent.current = pagePath;

    if (typeof window.gtag !== "function") return;
    window.gtag("event", "page_view", {
      page_path: pagePath,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, searchParams]);

  return null;
}

/** One document-level click listener for the whole site — see clicks.ts. */
function ClickTracking() {
  useEffect(() => attachClickTracking(), []);
  return null;
}

/**
 * Keep the GA user id in step with who is actually signed in.
 *
 * The inline init script sets it on the first paint, which is not enough:
 * signing out goes through a server action and a `redirect()`, and in the App
 * Router that is a CLIENT-side navigation, not a fresh document load. The
 * inline script does not run again, so without this effect the previous
 * member's id would stay attached to the tag for the rest of the browser
 * session — and every event the next person generated would be filed under
 * them. Shared machines are common in this community; this is not a theoretical
 * case.
 */
function MemberIdentity({ memberId }: { memberId?: string }) {
  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    // null, not undefined — passing undefined leaves the existing value in place.
    window.gtag("set", { user_id: memberId || null });
  }, [memberId]);
  return null;
}

export function GoogleAnalytics({ measurementId, memberId, analyticsConsent = true }: Props) {
  // No id, no tag. This is what keeps preview deployments and local dev out of
  // the production property: the variable is set on production only.
  if (!measurementId) return null;

  const consentDefault = analyticsConsent ? "granted" : "denied";
  const init = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  'analytics_storage': '${consentDefault}',
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied'
});
gtag('set', 'allow_google_signals', false);
gtag('set', 'allow_ad_personalization_signals', false);
gtag('js', new Date());
gtag('config', '${measurementId}', {
  send_page_view: false,
  cookie_flags: 'SameSite=Lax;Secure'
});
${memberId ? `gtag('set', { user_id: '${memberId}' });` : ""}
`.trim();

  return (
    <>
      {/* Inline first: it defines the dataLayer queue and the consent state.
          The loader below is async, so it always executes after this. */}
      <Script id="ga-init" strategy="afterInteractive">
        {init}
      </Script>
      <Script
        id="ga-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      />
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
      <ClickTracking />
      <MemberIdentity memberId={memberId} />
    </>
  );
}

export default GoogleAnalytics;
