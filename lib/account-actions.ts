"use server";

import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { gaClientIdFromCookie } from "@/analytics/src/ids";
import * as analytics from "@/analytics/src/server-events";
import { getAdCategories } from "@/lib/engine-store";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import {
  addLedgerEntry,
  ensureAccount,
  ensureChat,
  setAutoTopUp,
  setEmail,
  setEmailEdition,
  setProfile,
  setSubscribed,
  setSubscriberCategories,
} from "@/lib/store";
import { isCategoryKey } from "@/lib/categories";
import { formatPrice, isTopUpPreset } from "@/lib/config";
import { createCheckoutSession, paymentsDevMode } from "@/lib/payments";
import { devToolsEnabled } from "@/lib/env";
import { getAd } from "@/lib/ads";
import { storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";
import { requireMemberPhone } from "@/lib/member-gate";

const requirePhone = () => requireMemberPhone("/account");

// ---------- profile + chat entry (FEATURES items 3 & 4) ----------
// Sending/reporting inside a thread lives in lib/chat-actions.ts (items 13–15).

const MAX_PROFILE_PHOTO_BYTES = MAX_UPLOAD_BYTES;

export async function saveProfile(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await ensureAccount(phone);
  const address = String(formData.get("pickupAddress") ?? "").trim().slice(0, 200);
  const update: { pickupAddress: string | null; profilePhoto?: string } = {
    pickupAddress: address || null,
  };
  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_PROFILE_PHOTO_BYTES) redirect("/account?profile=badphoto#profile");
    const bytes = Buffer.from(await photo.arrayBuffer());
    if (supabaseConfigured) {
      const stored = await storeImageBytes(bytes);
      if (!stored.ok) redirect("/account?profile=badphoto#profile");
      update.profilePhoto = (stored as { ok: true; url: string }).url;
    } else {
      // Dev mode has no storage bucket — inline the sniff-verified image.
      const ext = sniffImage(bytes);
      if (!ext) redirect("/account?profile=badphoto#profile");
      update.profilePhoto = `data:${CONTENT_TYPE_BY_EXT[ext!]};base64,${bytes.toString("base64")}`;
    }
  }
  const saved = await setProfile(phone, update);
  redirect(saved === "saved" ? "/account?profile=saved#profile" : "/account?profile=unsupported#profile");
}

/** "Message the seller" on an ad page: open (or reopen) the thread. */
export async function startChat(formData: FormData): Promise<void> {
  const adId = Number(formData.get("adId"));
  const session = await readSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/ad/${Number.isInteger(adId) ? adId : ""}`)}`);
  }
  if (!Number.isInteger(adId)) redirect("/");
  const ad = await getAd(adId);
  if (!ad || !ad.ownerPhone || ad.ownerPhone === session.phone) redirect(`/ad/${adId}`);
  // A fixture-mode seller may not have an account row yet; real sellers do.
  await ensureAccount(ad.ownerPhone);
  const chatId = await ensureChat(adId, session.phone, ad.ownerPhone);
  if (chatId === null) redirect(`/ad/${adId}?chat=unavailable`);
  // Interest turning into an actual conversation — the step after a number
  // look-up, and the one that says the listing was worth acting on. Sent
  // server-side with the browser's _ga id so it joins the same visit; inside
  // after() so the redirect cannot cut it off.
  const gaClientId = gaClientIdFromCookie((await cookies()).get("_ga")?.value) ?? undefined;
  const chatCategory = (await getAdCategories([adId])).get(adId) ?? "uncategorized";
  after(() =>
    analytics.custom({ phone: session.phone, clientId: gaClientId }, "chat_start", {
      listing_category: chatCategory,
      items: [{ item_id: `ad_${adId}`, item_category: chatCategory }],
    }),
  );
  redirect(`/account/messages/${chatId}`);
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

/**
 * Save the /account category checkboxes (item 24) — the SAME store the SMS
 * toggles write, so either side's change shows on the other. "All" wins over
 * any individual boxes (it means null = every category, the default). Web
 * saves confirm ON-PAGE only: no SMS is ever sent for a web change.
 */
export async function saveCategories(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await ensureAccount(phone);
  if (formData.get("all") === "on") {
    await setSubscriberCategories(phone, null);
  } else {
    const keys = formData.getAll("category").map(String).filter(isCategoryKey);
    await setSubscriberCategories(phone, [...new Set(keys)].sort());
  }
  redirect("/account?saved=categories#categories");
}

export async function toggleEmailEdition(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await setEmailEdition(phone, formData.get("subscribe") === "yes");
  redirect("/account#settings");
}

/** Hand off to hosted Stripe Checkout; the money is granted by the webhook. */
export async function startStripeCheckout(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  if (paymentsDevMode) redirect("/account");
  const amountCents = Number(formData.get("amount"));
  if (!isTopUpPreset(amountCents)) redirect("/account");
  const requestHeaders = await headers();
  const origin =
    process.env.SITE_URL || `https://${requestHeaders.get("host") ?? "localhost:3000"}`;
  // Carry the browser's GA client id through Stripe so the webhook can credit
  // this sale to the visit that earned it (analytics/04-wiring.md step 4).
  const gaClientId = gaClientIdFromCookie((await cookies()).get("_ga")?.value) ?? "";
  let url: string;
  try {
    url = await createCheckoutSession({ amountCents, phone, origin, gaClientId });
  } catch (e) {
    console.error("[payments] checkout session failed:", e);
    redirect("/account?checkout=error#credits");
  }
  redirect(url);
}

/** Automatic top-up toggle (dollar pricing, session 016). */
export async function saveAutoTopUp(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  await ensureAccount(phone);
  const outcome = await setAutoTopUp(phone, formData.get("on") === "yes");
  redirect(outcome === "saved" ? "/account?saved=topup#credits" : "/account?error=topup#credits");
}

/** Dev-mode stand-in for the Stripe Checkout success webhook. */
export async function simulatePurchase(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  // Only usable when payments are in dev mode AND dev tools are enabled, so a
  // production deploy without Stripe keys can't be used to mint free money.
  if (!paymentsDevMode || !devToolsEnabled) redirect("/account");
  const amountCents = Number(formData.get("amount"));
  if (!isTopUpPreset(amountCents)) redirect("/account");
  await addLedgerEntry(phone, {
    delta: amountCents,
    kind: "purchase",
    note: `Added ${formatPrice(amountCents)} of ad credit — simulated`,
  });
  redirect(`/account?purchased=${amountCents}#credits`);
}
