/**
 * Sanitize a post-login `next` redirect target to a same-site path. Rejects
 * anything that a browser or the URL parser would resolve to another origin:
 * protocol-relative `//host`, backslash tricks `/\host`, and — the subtle one —
 * ASCII control characters. The WHATWG URL parser strips tab/newline before
 * parsing, so a tab at index 1 ("/<TAB>/evil.com") would otherwise slip past a
 * leading-slash check and normalize to "//evil.com".
 */
export function safeNextPath(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  let hasControlChar = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      hasControlChar = true;
      break;
    }
  }
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlChar
  ) {
    return "/";
  }
  return value;
}
