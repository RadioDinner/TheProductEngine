import type { NextConfig } from "next";

// Allowlist the hosts that ad photos are served from, so next/image renders
// them (and, because only these hosts are allowed, the optimizer can't be
// pointed at arbitrary URLs). Supabase Storage is where photos should live;
// Telnyx is the inbound-MMS media host until photos are re-hosted on ingest.
const supabaseHost = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  // Web ad posting uploads pictures through a server action: one listing
  // picture + up to 8 web-only extras, each capped at 8 MB by the app's byte
  // sniffing (lib/photos.ts). The framework default (1 MB) would bounce them
  // before our friendly validation ever ran. (Hosting note: Vercel caps
  // request bodies at ~4.5 MB regardless — this ceiling matters for dev and
  // any self-hosted deploy; the app-level 8 MB cap is the real per-file gate.)
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
    },
  },
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost }]
        : []),
      { protocol: "https" as const, hostname: "*.telnyx.com" },
    ],
  },
};

export default nextConfig;
