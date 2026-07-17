"use server";

/**
 * Business advertising purchase flow (FEATURES item 17) — the /advertising
 * server action. Validates the ad fields, then hands off to Stripe hosted
 * Checkout (lib/payments.ts raw-fetch seam); the WEBHOOK stores the paid
 * package as pending_review. With no Stripe key (paymentsDevMode) the payment
 * is simulated exactly like credit packs — gated on devToolsEnabled so a
 * production deploy without keys can never mint free packages.
 *
 * Outcomes are signaled repo-style: redirect() with query params.
 */
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { businessPackagesAvailable, createBusinessPackage } from "@/lib/business";
import {
  BUSINESS_AD_MAX,
  BUSINESS_LINK_MAX,
  BUSINESS_NAME_MAX,
  getBusinessTier,
} from "@/lib/business-packages";
import { hasLink, mayPostLinks, stripEmoji } from "@/lib/content-filter";
import { createBusinessCheckoutSession, paymentsDevMode } from "@/lib/payments";
import { devToolsEnabled } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";

export async function startBusinessCheckout(formData: FormData): Promise<void> {
  const tier = getBusinessTier(String(formData.get("tier") ?? ""));
  if (!tier) redirect("/advertising?error=tier");

  // Same content hygiene as member ads: emoji never ride the digest.
  const businessName = stripEmoji(String(formData.get("business") ?? "")).trim();
  const adText = stripEmoji(String(formData.get("adtext") ?? "")).trim();
  const linkRaw = String(formData.get("link") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();

  if (!businessName || businessName.length > BUSINESS_NAME_MAX) {
    redirect("/advertising?error=name");
  }
  if (!adText || adText.length > BUSINESS_AD_MAX) redirect("/advertising?error=text");
  // ONE link, and it lives in the link field: a link inside the ad text would
  // dodge the one-link rule, so it bounces with a pointer to the right field.
  if (hasLink(adText) || hasLink(businessName)) redirect("/advertising?error=linkintext");

  let link: string | null = null;
  if (linkRaw) {
    // Business sponsors may carry a link (mayPostLinks seam, user decision) —
    // manual review remains the safety valve before it ever broadcasts.
    if (!mayPostLinks({ businessSponsor: true })) redirect("/advertising?error=badlink");
    if (linkRaw.length > BUSINESS_LINK_MAX || !hasLink(linkRaw) || /\s/.test(linkRaw)) {
      redirect("/advertising?error=badlink");
    }
    link = linkRaw;
  }

  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizePhone(phoneRaw);
    if (!phone) redirect("/advertising?error=badphone");
  }

  // Pre-migration the package couldn't be stored after payment — refuse to
  // take money the system can't record ("not available yet" posture).
  if (!(await businessPackagesAvailable())) redirect("/advertising?error=unavailable");

  if (paymentsDevMode) {
    // Simulated payment, credit-pack style: dev tools must be explicitly on.
    if (!devToolsEnabled) redirect("/advertising?error=payments");
    const result = await createBusinessPackage({
      businessName,
      adText,
      link,
      phone,
      tier: tier.id,
      daysPurchased: tier.days,
      priceCents: tier.priceCents,
      stripeRef: `sim-${randomUUID()}`,
    });
    if (result.outcome !== "created") redirect("/advertising?error=unavailable");
    redirect(`/advertising/success?sim=${result.id}`);
  }

  const requestHeaders = await headers();
  const origin =
    process.env.SITE_URL || `https://${requestHeaders.get("host") ?? "localhost:3000"}`;
  let url: string;
  try {
    url = await createBusinessCheckoutSession({
      tierId: tier.id,
      tierLabel: tier.label,
      priceCents: tier.priceCents,
      businessName,
      adText,
      link,
      phone,
      origin,
    });
  } catch (e) {
    console.error("[business] checkout session failed:", e);
    redirect("/advertising?error=checkout");
  }
  redirect(url);
}
