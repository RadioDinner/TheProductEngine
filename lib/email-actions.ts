"use server";

import { redirect } from "next/navigation";
import { confirmUrl, email, emailDevEcho } from "@/lib/email";
import { logMessage } from "@/lib/engine-store";
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
  try {
    await email.send({ to: address, subject: `Confirm your email — ${site.name}`, html, text });
  } catch (e) {
    // Provider down or domain not yet verified: plain words, not a crash page.
    console.error("[email] confirmation send failed:", e);
    redirect("/email?error=send");
  }
  await logMessage({
    direction: "outbound",
    channel: "email",
    address,
    body: `Confirm your email — ${site.name}\n\n${text}`,
    html,
  });
  // Dev mode surfaces the confirm link on screen, like the SMS code echo.
  redirect(emailDevEcho ? `/email?sent=1&dev=${encodeURIComponent(link)}` : "/email?sent=1");
}
