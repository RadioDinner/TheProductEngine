"use server";

/**
 * Chat server actions (FEATURES items 13–15): send, share-address, and
 * report-a-message. Split out of account-actions so the thread UI, the link
 * filter, the audit copy, and the SMS nudge live in one place.
 */
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { flagChatMessage, getProfile, sendChatMessage } from "@/lib/store";
import { hasLink } from "@/lib/content-filter";
import { CHAT_MAX_BODY } from "@/lib/chat";
import { countRecentOutboundContaining, logMessage } from "@/lib/engine-store";
import { dispatchSms } from "@/lib/outbound";
import { site } from "@/lib/config";
import { siteUrl } from "@/lib/email";

/** Dedup marker for the you-have-a-message SMS — at most one per number per
 * DAY (FEATURES item 6, user decision). Pre-9980 fallback only. */
const CHAT_NUDGE_MARKER = "message waiting for you";
const CHAT_NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function requirePhone(): Promise<string> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fmessages");
  return session.phone;
}

/**
 * Audit copy of a chat message into the operator's message log (item 13 —
 * deliberately reverses the session-008 privacy stance; see /admin/help).
 * Best-effort: pre-9980 the messages.channel enum has no 'chat' value, and a
 * failed audit copy must never take down a send that already happened.
 */
async function auditChat(fromPhone: string, body: string, photo?: string | null): Promise<void> {
  try {
    await logMessage({
      direction: "inbound",
      channel: "chat",
      address: fromPhone,
      body,
      ...(photo ? { media: [photo] } : {}),
    });
  } catch (e) {
    console.warn("[chat] audit copy skipped:", e instanceof Error ? e.message : e);
  }
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
  const body = String(formData.get("body") ?? "").trim().slice(0, CHAT_MAX_BODY);
  if (!body) redirect(`/account/messages/${chatId}`);
  // Walled garden (item 13): links can't be sent in chat, same as in ads.
  if (hasLink(body)) redirect(`/account/messages/${chatId}?send=link`);
  const result = await sendChatMessage(chatId, phone, body);
  if (result.outcome === "sent") {
    await auditChat(phone, body);
    await nudgeBySms(result.otherPhone);
  }
  redirect(`/account/messages/${chatId}`);
}

/** The EXPLICIT act that shares the private pickup address into one chat. */
export async function sharePickupAddress(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const profile = await getProfile(phone);
  if (!profile?.pickupAddress) redirect(`/account/messages/${chatId}?share=noaddress`);
  const body = `My pickup address: ${profile.pickupAddress}`;
  const result = await sendChatMessage(chatId, phone, body);
  if (result.outcome === "sent") {
    await auditChat(phone, body);
    await nudgeBySms(result.otherPhone);
  }
  redirect(`/account/messages/${chatId}`);
}

/** Member reports a message in their thread → the operator queue (item 13). */
export async function reportChatMessage(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  const messageId = Number(formData.get("messageId"));
  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) redirect("/account/messages");
  const outcome = await flagChatMessage(chatId, messageId, phone);
  const note =
    outcome === "reported" ? "?report=ok" : outcome === "unsupported" ? "?report=unavailable" : "";
  redirect(`/account/messages/${chatId}${note}`);
}
