"use server";

/**
 * Chat server actions (FEATURES items 13–15). Two flavors of each mutation:
 *
 *  - a client-invoked action returning a `ChatActionResult`, so the thread's
 *    client component (components/ChatThread.tsx) can append optimistically
 *    and show friendly notes inline, and
 *  - a plain <form action> fallback that redirects with the usual query-param
 *    notes, so the thread still works without JavaScript.
 *
 * Item 15: only the store write sits on the critical path. The audit copy
 * (when the send_chat RPC didn't already make it) and the SMS nudge run in
 * next/server after() — after the response is sent.
 */
import { redirect } from "next/navigation";
import { after } from "next/server";
import { readSession } from "@/lib/session";
import {
  flagChatMessage,
  getProfile,
  sendChatMessage,
  setChatNudgedAt,
  type ChatMessageView,
} from "@/lib/store";
import { hasLink } from "@/lib/content-filter";
import {
  CHAT_MAX_BODY,
  CHAT_NUDGE_WINDOW_MS,
  MAX_CHAT_PHOTO_BYTES,
  nudgeWindowOpen,
} from "@/lib/chat";
import { countRecentOutboundContaining, logMessage } from "@/lib/engine-store";
import { dispatchSms } from "@/lib/outbound";
import { storeImageBytes } from "@/lib/photos";
import { supabaseConfigured } from "@/lib/db";
import { site } from "@/lib/config";
import { siteUrl } from "@/lib/email";

export type ChatActionResult =
  | { ok: true; message: ChatMessageView }
  | { ok: false; error: string };

/** Dedup marker for the you-have-a-message SMS — only the pre-9980 fallback
 * scan still greps for it; post-9980 the users.chat_nudged_at column rules. */
const CHAT_NUDGE_MARKER = "message waiting for you";

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

/**
 * One deduped "you have a message on the website" SMS to the other party.
 * ABSOLUTE RULE: this is plain text, always — chat media never rides an
 * outbound SMS, picture messages get the same website pointer.
 * `lastNudgedAt` comes back from the send itself (9980); `undefined` means
 * the column isn't there yet, so fall back to the audit-log scan.
 */
async function nudgeOtherParty(
  phone: string,
  lastNudgedAt: string | null | undefined,
): Promise<void> {
  if (!phone) return;
  try {
    if (lastNudgedAt !== undefined) {
      if (!nudgeWindowOpen(lastNudgedAt, Date.now())) return;
    } else {
      const recent = await countRecentOutboundContaining(
        phone,
        CHAT_NUDGE_MARKER,
        CHAT_NUDGE_WINDOW_MS,
      );
      if (recent > 0) return;
    }
    const text = `${site.name}: you have a message waiting for you on the website. Read and reply at ${siteUrl}/account/messages — sign in with your phone number.`;
    const { sent } = await dispatchSms(phone, text, { cls: "reply" });
    if (sent) {
      await setChatNudgedAt(phone); // no-op pre-9980; the scan covers that era
      await logMessage({ direction: "outbound", channel: "sms", address: phone, body: text });
    }
  } catch (e) {
    console.error("[chat] nudge failed:", e);
  }
}

/** The shared send core: store write on the critical path, everything else
 * (audit copy when needed, SMS nudge) deferred to after the response. */
async function deliver(
  chatId: number,
  phone: string,
  body: string,
  photo?: string | null,
  opts?: { skipLinkCheck?: boolean },
): Promise<ChatActionResult> {
  if (!body && !photo) return { ok: false, error: "empty" };
  // Walled garden (item 13): links can't be sent in chat, same as in ads.
  if (!opts?.skipLinkCheck && body && hasLink(body)) return { ok: false, error: "link" };
  const t0 = Date.now();
  const result = await sendChatMessage(chatId, phone, body, photo);
  const storeMs = Date.now() - t0;
  if (result.outcome !== "sent") {
    console.log(`[chat] send chat#${chatId} refused (${result.outcome}) store=${storeMs}ms`);
    return { ok: false, error: result.outcome };
  }
  after(async () => {
    if (!result.audited) await auditChat(phone, body, photo);
    await nudgeOtherParty(result.otherPhone, result.otherNudgedAt);
  });
  console.log(
    `[chat] send chat#${chatId} path=${result.path} store=${storeMs}ms critical=${Date.now() - t0}ms (audit+nudge deferred)`,
  );
  return { ok: true, message: result.message };
}

// ---------- client-invoked actions (optimistic thread UI) ----------

/** Send a text message; returns the stored message for confirmed append. */
export async function sendChatText(chatId: number, rawBody: string): Promise<ChatActionResult> {
  const phone = await requirePhone();
  if (!Number.isInteger(chatId)) return { ok: false, error: "denied" };
  const body = String(rawBody ?? "").trim().slice(0, CHAT_MAX_BODY);
  return deliver(chatId, phone, body);
}

/**
 * Send a picture into a thread (item 14): byte-sniffed and re-hosted exactly
 * like every other image (storeImageBytes, 8 MB), stored on the chat message.
 * Chat media NEVER rides an outbound SMS — see nudgeOtherParty.
 */
export async function sendChatPhoto(formData: FormData): Promise<ChatActionResult> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) return { ok: false, error: "denied" };
  const caption = String(formData.get("body") ?? "").trim().slice(0, CHAT_MAX_BODY);
  if (caption && hasLink(caption)) return { ok: false, error: "link" };
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, error: "badphoto" };
  if (photo.size > MAX_CHAT_PHOTO_BYTES) return { ok: false, error: "badphoto" };
  // Dev mode has no storage bucket — a friendly note, never a 500.
  if (!supabaseConfigured) return { ok: false, error: "devphotos" };
  const stored = await storeImageBytes(Buffer.from(await photo.arrayBuffer()));
  if (!stored.ok) return { ok: false, error: "badphoto" };
  return deliver(chatId, phone, caption, stored.url, { skipLinkCheck: true });
}

/** The EXPLICIT act that shares the private pickup address into one chat. */
export async function shareAddress(chatId: number): Promise<ChatActionResult> {
  const phone = await requirePhone();
  if (!Number.isInteger(chatId)) return { ok: false, error: "denied" };
  const profile = await getProfile(phone);
  if (!profile?.pickupAddress) return { ok: false, error: "noaddress" };
  // The body is server-composed from the member's own saved field — the link
  // filter would false-positive on street-address punctuation.
  return deliver(chatId, phone, `My pickup address: ${profile.pickupAddress}`, null, {
    skipLinkCheck: true,
  });
}

/** Member reports a message in their thread → the operator queue (item 13). */
export async function reportChat(
  chatId: number,
  messageId: number,
): Promise<{ ok: boolean; error?: string }> {
  const phone = await requirePhone();
  if (!Number.isInteger(chatId) || !Number.isInteger(messageId)) {
    return { ok: false, error: "denied" };
  }
  const outcome = await flagChatMessage(chatId, messageId, phone);
  return outcome === "reported" ? { ok: true } : { ok: false, error: outcome };
}

// ---------- <form action> fallbacks (no-JS: redirect with a note) ----------

function threadUrl(chatId: number, note = ""): string {
  return `/account/messages/${chatId}${note}`;
}

export async function sendChat(formData: FormData): Promise<void> {
  const phone = await requirePhone();
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const body = String(formData.get("body") ?? "").trim().slice(0, CHAT_MAX_BODY);
  const result = await deliver(chatId, phone, body);
  redirect(threadUrl(chatId, result.ok || result.error === "empty" ? "" : `?send=${result.error}`));
}

export async function sendChatPhotoForm(formData: FormData): Promise<void> {
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const result = await sendChatPhoto(formData);
  redirect(threadUrl(chatId, result.ok ? "" : `?send=${result.error}`));
}

export async function sharePickupAddress(formData: FormData): Promise<void> {
  const chatId = Number(formData.get("chatId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const result = await shareAddress(chatId);
  redirect(
    threadUrl(
      chatId,
      result.ok ? "" : result.error === "noaddress" ? "?share=noaddress" : `?send=${result.error}`,
    ),
  );
}

export async function reportChatMessage(formData: FormData): Promise<void> {
  const chatId = Number(formData.get("chatId"));
  const messageId = Number(formData.get("messageId"));
  if (!Number.isInteger(chatId)) redirect("/account/messages");
  const result = await reportChat(chatId, messageId);
  const note = result.ok ? "?report=ok" : result.error === "unsupported" ? "?report=unavailable" : "";
  redirect(threadUrl(chatId, note));
}
