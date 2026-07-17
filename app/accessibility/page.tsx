import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Accessibility statement — ${site.name}`,
  description: `How ${site.name} works for people with disabilities, on the website and by text message, and how to reach us about an accessibility problem.`,
};

export default function AccessibilityStatement() {
  return (
    <div className="container prose">
      <h1>Accessibility statement</h1>
      <p className="fine">Last updated July 17, 2026</p>
      <p>
        We at {site.name} are working to make this site, theplainexchange.com, accessible
        to people with disabilities — and to keep the service usable by people whose
        phones and comfort with technology vary widely. That is the point of the whole
        service: everything important can be done with a plain text message from any
        phone, no smartphone or computer needed.
      </p>

      <h2>What web accessibility is</h2>
      <p>
        An accessible site lets visitors with disabilities browse with the same or a
        similar level of ease as other visitors — through the abilities of the device
        they are on, and through assistive technologies such as screen readers and
        keyboard navigation.
      </p>

      <h2>Accessibility adjustments on this site</h2>
      <p>
        We build this site to work with assistive technologies and aim to follow the Web
        Content Accessibility Guidelines (WCAG) 2.1 at level AA. As part of that effort
        we have:
      </p>
      <ul>
        <li>Set the language of the site so screen readers announce it correctly.</li>
        <li>
          Kept every page server-rendered, plain HTML: the whole site works with the
          keyboard, and the important parts work even without JavaScript.
        </li>
        <li>Provided a &ldquo;skip to content&rdquo; link at the top of every page.</li>
        <li>Used clear heading structures and labeled navigation on every page.</li>
        <li>
          Added alternative text to meaningful images, and marked decorative images so
          screen readers pass over them.
        </li>
        <li>
          Chosen a high-contrast, print-inspired design with large, readable type.
        </li>
        <li>Kept motion and animation to almost none, and used no videos or audio.</li>
      </ul>

      <h2>Where compliance is partial</h2>
      <p>
        Ad text and ad photos are submitted by members, mostly by text message from
        ordinary phones. We review every ad, but we cannot always provide a meaningful
        description of what is in a member&rsquo;s photo, so photo descriptions on ad
        pages may be limited. We therefore declare partial compliance for pages that
        show member-submitted photos.
      </p>

      <h2>If the website doesn&rsquo;t work for you</h2>
      <p>
        You do not need the website to use {site.name}. Every core feature — getting the
        ads, posting an ad, pulling a picture, marking an item sold — works by plain
        text message to <strong>{site.smsNumber}</strong>, and a person answers the
        support line.
      </p>

      <h2 id="questions">Requests, issues, and suggestions</h2>
      <p>
        If you find an accessibility problem on this site, or you need help in a
        different form, contact the operator:
      </p>
      <ul>
        <li>
          Call <strong>{site.supportPhone}</strong>
        </li>
        <li>
          Text <strong>{site.smsNumber}</strong>
        </li>
      </ul>
      <p>
        Tell us what page and what went wrong, and we will work to fix it. See also the{" "}
        <Link href="/how-it-works">how it works</Link> page and the{" "}
        <Link href="/faq">questions</Link> page.
      </p>
    </div>
  );
}
