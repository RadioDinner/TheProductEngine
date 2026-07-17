import type { ReactNode } from "react";

/**
 * Renders ad text with phone numbers masked. The area code stays visible; the
 * rest is withheld (spec Q16 + FEATURES item 23): visitors sign in first, and
 * signed-in members unmask one ad at a time with "Show number" on the ad page
 * — numbers never render in page HTML until that per-ad, metered reveal.
 */
const PHONE_RE = /\(?(\d{3})\)?[ .-]?\d{3}[ .-]?\d{4}/g;

/** Plain-string variant for metadata/descriptions (no JSX). */
export function maskPhonesPlain(text: string): string {
  return text.replace(PHONE_RE, (_, area: string) => `${area}-···-····`);
}

export function MaskedText({ text, revealed }: { text: string; revealed?: boolean }) {
  if (revealed) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(PHONE_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <span
        key={key++}
        className="tel-masked"
        title="Sign in, open the ad, and press “Show number” to see it"
      >
        {match[1]}-···-····
      </span>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
