"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { addLedgerEntry, setEmail, setEmailEdition, setSubscribed } from "@/lib/store";
import { formatPrice, getPack } from "@/lib/config";
import { createCheckoutSession, paymentsDevMode } from "@/lib/payments";

async function requirePhone(): Promise<string> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");
  return session.phone;
}

export async function saveEmail(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const email = String(formData.get("email") ?? "").trim();
  if (email === "") {
    await setEmail(phone, null);
    redirect("/account?saved=email#settings");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/account?error=email#settings");
  }
  const ok = await setEmail(phone, email);
  redirect(ok ? "/account?saved=email#settings" : "/account?error=email-taken#settings");
}

export async function toggleSubscription(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await setSubscribed(phone, formData.get("subscribe") === "yes");
  redirect("/account#settings");
}

export async function toggleEmailEdition(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await setEmailEdition(phone, formData.get("subscribe") === "yes");
  redirect("/account#settings");
}

/** Hand off to hosted Stripe Checkout; credits are granted by the webhook. */
export async function startStripeCheckout(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  if (paymentsDevMode) redirect("/account");
  const pack = getPack(String(formData.get("pack") ?? ""));
  if (!pack) redirect("/account");
  const requestHeaders = await headers();
  const origin =
    process.env.SITE_URL || `https://${requestHeaders.get("host") ?? "localhost:3000"}`;
  let url: string;
  try {
    url = await createCheckoutSession({
      packId: pack.id,
      credits: pack.credits,
      priceCents: pack.priceCents,
      phone,
      origin,
    });
  } catch (e) {
    console.error("[payments] checkout session failed:", e);
    redirect("/account?checkout=error#credits");
  }
  redirect(url);
}

/** Dev-mode stand-in for the Stripe Checkout success webhook. */
export async function simulatePurchase(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  if (!paymentsDevMode) redirect("/account");
  const pack = getPack(String(formData.get("pack") ?? ""));
  if (!pack) redirect("/account");
  await addLedgerEntry(phone, {
    delta: pack.credits,
    kind: "purchase",
    note: `Purchased ${pack.credits} credits (${formatPrice(pack.priceCents)}) — simulated`,
  });
  redirect(`/account?purchased=${pack.credits}#credits`);
}
