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
