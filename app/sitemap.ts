import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL || "https://www.theplainexchange.com";
  return [
    { url: `${base}/`, changeFrequency: "hourly" as const },
    { url: `${base}/how-it-works`, changeFrequency: "monthly" as const },
    { url: `${base}/faq`, changeFrequency: "monthly" as const },
    { url: `${base}/email`, changeFrequency: "monthly" as const },
    { url: `${base}/privacy`, changeFrequency: "yearly" as const },
    { url: `${base}/terms-and-conditions`, changeFrequency: "yearly" as const },
  ];
}
