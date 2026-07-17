"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import {
  addLedgerEntry,
  ensureAccount,
  ensureChat,
  getProfile,
  sendChatMessage,
  setEmail,
  setEmailEdition,
  setProfile,
  setSubscribed,
} from "@/lib/store";
import { formatPrice, getPack, site } from "@/lib/config";
import { createCheckoutSession, paymentsDevMode } from "@/lib/payments";
import { devToolsEnabled } from "@/lib/env";
import { getAd } from "@/lib/ads";
import { storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";
import { countRecentOutboundContaining, logMessage } from "@/lib/engine-store";
import { dispatchSms } from "@/lib/outbound";
import { siteUrl } from "@/lib/email";

async function requirePhone(): Promise<string> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");
  return session.phone;
}

// ---------- profile + chat (FEATURES items 3 & 4) ----------

const MAX_PROFILE_PHOTO_BYTES = 8 * 1024 * 1024;
/** Dedup marker for the you-have-a-message SMS — at most one per number per
 * DAY (FEATURES item 6, user decision). */
const CHAT_NUDGE_MARKER = "message waiting for you";
const CHAT_NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  redirect(`/account/messages/${chatId}`);
}

/** One deduped "you have a message on the website" SMS to the other party. */
async function nudgeBySms(phone: string): Promise<void> {
  if (!phone) return;
  try {
    const recent = await countRecentOutboundContaining(phone, CHAT_NUDGE_MARKER, CHAT_NUDGE_WINDOW_MS);
    if (recent > 0) return;
    const text = `${site.name}: you have a message waiting for you on the website. Read and reply at ${siteUrl}/account/messages — sign in with your phone number.`;
    const { sent } = await dispatchSms(phone, text, { cls: "reply" });
    if (sent) {
      await logMessage({ direction: "outbound", channel: "sms", address: phone, body: text });
    }
  } catch (e) {
    console.error("[chat] nudge failed:", e);
  }
}

export async function sendChat(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const body = String(formData.get("body") ?? "").trim().slice(0, 1000);
  if (!body) redirect(`/account/messages/${chatId}`);
  const result = await sendChatMessage(chatId, phone, body);
  if (result.outcome === "sent") await nudgeBySms(result.otherPhone);
  redirect(`/account/messages/${chatId}`);
}

/** The EXPLICIT act that shares the private pickup address into one chat. */
export async function sharePickupAddress(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const profile = await getProfile(phone);
  if (!profile?.pickupAddress) redirect(`/account/messages/${chatId}?share=noaddress`);
  const result = await sendChatMessage(
    chatId,
    phone,
    `My pickup address: ${profile.pickupAddress}`,
  );
  if (result.outcome === "sent") await nudgeBySms(result.otherPhone);
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
  // Only usable when payments are in dev mode AND dev tools are enabled, so a
  // production deploy without Stripe keys can't be used to mint free credits.
  if (!paymentsDevMode || !devToolsEnabled) redirect("/account");
  const pack = getPack(String(formData.get("pack") ?? ""));
  if (!pack) redirect("/account");
  await addLedgerEntry(phone, {
    delta: pack.credits,
    kind: "purchase",
    note: `Purchased ${pack.credits} credits (${formatPrice(pack.priceCents)}) — simulated`,
  });
  redirect(`/account?purchased=${pack.credits}#credits`);
}
