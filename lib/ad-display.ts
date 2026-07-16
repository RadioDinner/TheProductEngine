/**
 * Display derivations for an ad's free-text body (shared by the site, the
 * digest composer, and the email edition). Pure and dependency-free so the
 * unit suite can import it directly — re-exported through lib/ads.ts for the
 * rest of the app.
 */

/**
 * Display title: the lead clause of the free-text body, the way a
 * classified's first line works in print.
 */
export function deriveTitle(body: string): string {
  const firstClause = body.split(/[.,]/, 1)[0]?.trim() ?? body;
  return firstClause.length > 64 ? `${firstClause.slice(0, 61).trimEnd()}…` : firstClause;
}

/** Remainder of the body after the title clause, for the excerpt line. */
export function deriveRest(body: string): string {
  const title = body.split(/[.,]/, 1)[0] ?? "";
  return body
    .slice(title.length)
    .replace(/^[.,]\s*/, "")
    .trim();
}

/** First dollar amount in the body, if any — shown as the row's price.
 * Keeps shorthand suffixes: "$10k OBO" must render $10k, never $10. The k
 * must end the token ("$5 Kids bikes" is $5, not $5 K). */
export function derivePrice(body: string): string | null {
  // Commas only as thousands groups, so "Was $20, now $15" yields "$20", not "$20,".
  const match = body.match(/\$\d+(?:,\d{3})*(?:\.\d{1,2})?(?:[kK]\b)?/);
  return match ? match[0] : null;
}

/** The ad's price as a number for ranking ("$1,000" → 1000, "$10k" → 10000);
 * null when the ad names no price. Display always uses derivePrice. */
export function priceValue(body: string): number | null {
  const price = derivePrice(body);
  if (!price) return null;
  const thousands = /[kK]$/.test(price);
  const amount = Number(price.replace(/[$,]/g, "").replace(/[kK]$/, ""));
  return Number.isFinite(amount) ? amount * (thousands ? 1000 : 1) : null;
}

/** The digest's standout ad — the one the email subject leads with. The
 * biggest-ticket item pulls the open (a $12k trailer beats free kittens);
 * when no ad names a price, the digest's lead ad stands. */
export function pickStandoutAd<T extends { body: string }>(ads: T[]): T | null {
  let best: T | null = null;
  let bestPrice = -1;
  for (const ad of ads) {
    const price = priceValue(ad.body) ?? -1;
    if (!best || price > bestPrice) {
      best = ad;
      bestPrice = price;
    }
  }
  return best;
}

/** MM-DD-YY subject date from an ET calendar day: "2026-07-16" → "07-16-26". */
export function shortDateLabel(etDay: string): string {
  return `${etDay.slice(5, 7)}-${etDay.slice(8, 10)}-${etDay.slice(2, 4)}`;
}

/** Email edition subject, led by the standout ad (user format, session 008):
 * "The Plain Exchange : 07-16-26 - Tractor trailer +3 more ads". */
export function composeEmailSubject(
  siteName: string,
  ads: { body: string }[],
  etDay: string,
  editionTag = "",
): string {
  const standout = pickStandoutAd(ads);
  const date = shortDateLabel(etDay);
  if (!standout) return `${siteName} : ${date}${editionTag}`;
  const others = ads.length - 1;
  const tail = others > 0 ? ` +${others} more ad${others === 1 ? "" : "s"}` : "";
  return `${siteName} : ${date} - ${deriveTitle(standout.body)}${tail}${editionTag}`;
}
