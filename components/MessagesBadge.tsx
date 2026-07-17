"use client";

/**
 * Header messages icon + red unread badge (FEATURES item 12) — the repo's
 * first (and only) client component, kept deliberately tiny. The server
 * layout passes the initial count; a ~60s poll of /api/unread keeps the
 * badge and the tab title ("(1) …" prefix) fresh. "Alert when a reply
 * arrives" v1 is exactly this: the badge appearing on poll or page load.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const POLL_MS = 60_000;
const TITLE_PREFIX_RE = /^\(\d+\) /;

export function MessagesBadge({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => {
    const apply = () => {
      const bare = document.title.replace(TITLE_PREFIX_RE, "");
      const wanted = unread > 0 ? `(${unread}) ${bare}` : bare;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    // Next streams metadata after hydration and rewrites <title> on every
    // navigation, clobbering the prefix — watch the head and re-assert. The
    // equality guard above keeps the observer from ping-ponging itself.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [unread]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/unread");
        if (!res.ok) return; // signed out or hiccup — keep the last count
        const data = (await res.json()) as { unread?: number };
        if (typeof data.unread === "number") setUnread(data.unread);
      } catch {
        // Network hiccup — try again next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Link
      className="messages-link"
      href="/account/messages"
      aria-label={unread > 0 ? `Messages — ${unread} unread` : "Messages"}
    >
      <span aria-hidden="true">✉</span>
      {unread > 0 && <span className="unread-badge">{unread}</span>}
    </Link>
  );
}
