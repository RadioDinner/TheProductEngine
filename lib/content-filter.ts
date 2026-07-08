/**
 * Inbound content hygiene for ad bodies (walled-garden policy):
 *
 * - stripEmoji: remove ALL emoji / pictographic symbols before an ad is stored
 *   or broadcast. Emoji flip an SMS digest to costly UCS-2 encoding and read
 *   badly on flip phones; the product rule is that ads never carry them. The
 *   raw text the sender typed still lands in the message audit log for
 *   forensics — this only cleans the stored/displayed/broadcast body.
 * - findLinks: detect URLs / bare domains so an ad that contains one can be
 *   FLAGGED for manual review (not auto-rejected, not stripped). Phone numbers
 *   and ordinary sentence punctuation must never trip it. A future "verified
 *   advertiser" tier can be allowed to post links; see mayPostLinks().
 */

// Emoji + the joiners/modifiers/selectors that compose emoji sequences.
// \p{Extended_Pictographic} covers the emoji blocks (faces, symbols, dingbats,
// transport, supplemental) WITHOUT matching plain digits, '#' or '*'. We add
// regional-indicator letters (flags), skin-tone modifiers, the combining
// keycap, ZWJ and variation selector-16 so no fragment of a sequence survives.
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{200D}\u{20E3}\u{FE0F}\u{FE0E}]|\p{Extended_Pictographic}/gu;

/** Remove every emoji / pictographic symbol, then tidy the whitespace it left. */
export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/[ \t ]{2,}/g, " ") // collapse runs of spaces an emoji left behind
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

/** True if the text contains any emoji / pictographic character. */
export function hasEmoji(text: string): boolean {
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(text);
}

// Known TLDs + URL shorteners. A bare token only counts as a domain when its
// suffix is on this list, so "$50. Call 330-600-1834" and "St. Louis" are safe.
const TLDS = [
  "com", "net", "org", "io", "co", "us", "gov", "edu", "biz", "info", "shop",
  "store", "online", "xyz", "app", "dev", "me", "tv", "ly", "gg", "link",
  "site", "club", "live", "news", "blog", "page", "top", "pro", "to", "cc",
  "ws", "nu", "ca", "uk", "de",
].join("|");

// A URL with an explicit scheme (http://, https://, and anything ://).
const SCHEME_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/i;
// A www. host even without a scheme.
const WWW_RE = /\bwww\.[a-z0-9-]+\.[a-z]{2,}\b/i;
// A bare domain whose suffix is a known TLD, optionally with a path.
const DOMAIN_RE = new RegExp(
  `\\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.(?:${TLDS})\\b(?:\\/\\S*)?`,
  "i",
);

/** Return the link-like substrings found in the text (empty = none). */
export function findLinks(text: string): string[] {
  const found: string[] = [];
  for (const re of [SCHEME_RE, WWW_RE, DOMAIN_RE]) {
    const m = text.match(re);
    if (m) found.push(m[0]);
  }
  // De-dupe while keeping the most specific/first match readable for the admin.
  return [...new Set(found)];
}

/** True if the text contains a URL or bare domain. */
export function hasLink(text: string): boolean {
  return SCHEME_RE.test(text) || WWW_RE.test(text) || DOMAIN_RE.test(text);
}

/**
 * Whether this poster is allowed to include links. Walled garden for now:
 * nobody may. The seam is here so a future verified-advertiser flag flips it
 * without touching the ingest path. `verified` is reserved for that tier.
 */
export function mayPostLinks(_opts: { verified?: boolean } = {}): boolean {
  return false;
}
