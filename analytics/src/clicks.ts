/**
 * One delegated click listener for the whole site.
 *
 * Why one listener rather than instrumenting components: every listing on this
 * site links to `/ad/<id>` — the homepage list, search results, category
 * browse, the town hall sidebar, the featured slots. A single document-level
 * listener catches all of them without touching `AdRow.tsx` or any page, and
 * it keeps working when a new list is added somewhere else later. Instrumenting
 * each render site would mean remembering to do it every time, forever.
 *
 * What it sends:
 *
 *   /ad/<id>          → `select_item`  — which listings people click, the
 *                       answer to "which ads are most popular"
 *   internal links    → `ui_click`     — everything else, with its text and
 *                       destination, so "what do people click" is one report
 *   external links    → nothing        — GA4's Enhanced Measurement already
 *                       sends `click` for outbound links, and measuring the
 *                       same thing twice in two ways is how you end up with
 *                       two numbers that disagree and no way to pick
 *
 * PII: `tel:` and `mailto:` hrefs are redacted outright rather than scrubbed.
 * On this site a `tel:` link is a seller's revealed phone number — exactly the
 * thing that must never reach Google. The generic scrubber in track.ts would
 * catch it too; this is the belt to that pair of braces.
 */
import { track } from "./track";

/** Ad ids from our own listing URLs: /ad/1042, /ad/1042?from=search. */
const AD_PATH = /^\/ad\/(\d+)(?:[/?#]|$)/;

/** A stable, human-readable name for where on the page the click happened. */
function sectionOf(el: Element): string {
  const marked = el.closest("[data-analytics-section]");
  if (marked) return marked.getAttribute("data-analytics-section") || "unknown";
  const landmark = el.closest("header, footer, nav, main, aside, form");
  return landmark ? landmark.tagName.toLowerCase() : "body";
}

/** Never send a phone number or an email address, whatever the link says. */
function safeHref(raw: string): string {
  if (raw.startsWith("tel:")) return "tel:[redacted]";
  if (raw.startsWith("mailto:")) return "mailto:[redacted]";
  return raw.slice(0, 100);
}

function labelOf(el: Element): string {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 100);
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.slice(0, 100);
  return "(no text)";
}

/**
 * Attach the listener. Returns a function that removes it, so React effects
 * can clean up and a fast-refreshing dev session does not stack listeners.
 */
export function attachClickTracking(): () => void {
  if (typeof document === "undefined") return () => {};

  const onClick = (event: MouseEvent) => {
    try {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("a, button");
      if (!el) return;

      const section = sectionOf(el);

      if (el instanceof HTMLAnchorElement) {
        const href = el.getAttribute("href") || "";
        // Same-origin check via the resolved URL, so protocol-relative and
        // absolute links to our own host are treated as internal too.
        let path = href;
        let external = false;
        try {
          const url = new URL(el.href, window.location.href);
          external = url.origin !== window.location.origin;
          path = url.pathname + url.search;
        } catch {
          /* keep the raw href */
        }

        // Enhanced Measurement already reports outbound clicks. Leave them.
        if (external) return;

        const listing = AD_PATH.exec(path);
        if (listing) {
          track("select_item", {
            item_list_name: section,
            items: [{ item_id: `ad_${listing[1]}`, item_list_name: section }],
          });
          return;
        }

        track("ui_click", {
          click_text: labelOf(el),
          click_href: safeHref(href),
          click_section: section,
        });
        return;
      }

      // A button: no href, so the label is all we have.
      track("ui_click", {
        click_text: labelOf(el),
        click_href: "(button)",
        click_section: section,
      });
    } catch {
      // A click handler must never be the reason a link stops working.
    }
  };

  // Capture phase: a click on a link that navigates away still reaches us,
  // and a stopPropagation() somewhere in the tree cannot hide it.
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
