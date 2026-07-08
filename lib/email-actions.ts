"use server";

import { redirect } from "next/navigation";
import { confirmUrl, emailDevEcho, verifyEmailToken } from "@/lib/email";
import { dispatchEmail } from "@/lib/outbound";
import { cancelQueuedOutboxFor, logMessage } from "@/lib/engine-store";
import { subscribeEmailOnly, unsubscribeEmail } from "@/lib/store";
import { devToolsEnabled } from "@/lib/env";
import { site } from "@/lib/config";

export async function emailSignup(formData: FormData): Promise<void> {
  const address = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    redirect("/email?error=1");
  }
  const link = confirmUrl(address);
  const text = `You're one click from getting ${site.name}'s ads by email. Confirm here: ${link}\n\nIf you didn't ask for this, ignore this message and nothing happens.`;
  const html = `<div style="margin:0 auto;max-width:600px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;">
    <p style="font-size:16px;color:#20262b;">You're one click from getting <strong>${site.name}</strong>'s ads by email.</p>
    <p><a href="${link}" style="display:inline-block;background:#2d5570;color:#ffffff;padding:10px 22px;text-decoration:none;border-radius:2px;font-weight:600;">Confirm my email</a></p>
    <p style="font-size:13px;color:#5b6670;">If you didn't ask for this, ignore this message and nothing happens.</p>
  </div>`;
  // "transactional": through a FULL pause this is suppressed; a PARTIAL pause
  // lets it through. A throw (provider down) or a non-send both land on the
  // same plain error screen. redirect() stays out of the try.
  let confirmSent = false;
  try {
    confirmSent = (
      await dispatchEmail(
        { to: address, subject: `Confirm your email — ${site.name}`, html, text },
        { cls: "transactional" },
      )
    ).sent;
  } catch (e) {
    console.error("[email] confirmation send failed:", e);
  }
  if (!confirmSent) {
    redirect("/email?error=send");
  }
  await logMessage({
    direction: "outbound",
    channel: "email",
    address,
    body: `Confirm your email — ${site.name}\n\n${text}`,
    html,
  });
  // Dev tools surface the confirm link on screen, like the SMS code echo —
  // gated on devToolsEnabled (not just a missing provider key) so a prod
  // deploy without Resend can't let anyone confirm an address they don't own.
  const showLink = emailDevEcho && devToolsEnabled;
  redirect(showLink ? `/email?sent=1&dev=${encodeURIComponent(link)}` : "/email?sent=1");
}

/**
 * Confirm an email subscription — the POST target of the button on
 * /email/confirm. Doing the subscribe here (not on the page GET) means an email
 * link scanner / prefetcher that fetches the link can't silently confirm an
 * address the recipient never chose. The token is re-verified.
 */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const address = String(formData.get("e") ?? "").trim().toLowerCase();
  const token = String(formData.get("t") ?? "");
  if (address && token && verifyEmailToken("confirm", address, token)) {
    await subscribeEmailOnly(address);
    redirect("/email/confirm?ok=1");
  }
  redirect("/email/confirm?ok=0");
}

/** Unsubscribe — the POST target of the button on /email/unsubscribe. */
export async function unsubscribeEmailAction(formData: FormData): Promise<void> {
  const address = String(formData.get("e") ?? "").trim().toLowerCase();
  const token = String(formData.get("t") ?? "");
  if (address && token && verifyEmailToken("unsub", address, token)) {
    await unsubscribeEmail(address);
    // Honor the opt-out immediately for any already-queued email edition too.
    await cancelQueuedOutboxFor(address);
    redirect("/email/unsubscribe?ok=1");
  }
  redirect("/email/unsubscribe?ok=0");
}
