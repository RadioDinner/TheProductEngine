import type { NextConfig } from "next";

// Allowlist the hosts that ad photos are served from, so next/image renders
// them (and, because only these hosts are allowed, the optimizer can't be
// pointed at arbitrary URLs). Supabase Storage is where photos should live;
// Telnyx is the inbound-MMS media host until photos are re-hosted on ingest.
const supabaseHost = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
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
