/**
 * Inbound-MMS photo source validation. A photo src is accepted only if it is a
 * site-relative path (dev fixtures / re-hosted media) or an https URL on a host
 * we actually serve images from — the SAME allowlist next.config.ts gives the
 * image optimizer. Validating the host on ingest (not just the scheme) keeps a
 * crafted MMS from storing an off-site or protocol-relative URL that would then
 * throw in next/image, and closes the `//evil.com` protocol-relative gap the
 * old scheme-only check let through.
 */
function supabaseHost(): string | undefined {
  const url = process.env.SUPABASE_URL;
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isAllowedPhotoSrc(src: string | undefined): src is string {
  if (!src) return false;
  // Site-relative path — but reject protocol-relative "//host", which a browser
  // resolves off-site.
  if (src.startsWith("/")) return !src.startsWith("//");
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === supabaseHost() || host === "telnyx.com" || host.endsWith(".telnyx.com");
}
