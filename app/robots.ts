import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.SITE_URL || "https://www.theplainexchange.com";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/dev", "/api", "/login"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
