/**
 * Operator notifications. When ADMIN_EMAIL is set, the admin gets an email
 * as soon as an ad is posted by text, so the review queue never sits unseen.
 * Best-effort: a send failure is logged and swallowed — it must never break
 * ad posting.
 */
import { email, siteUrl } from "@/lib/email";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";

export async function notifyAdminNewAd(args: {
  id: number;
  from: string;
  hasPhoto: boolean;
  body: string;
}): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const reviewUrl = `${siteUrl}/admin`;
  const kind = args.hasPhoto ? "picture ad" : "text ad";
  const subject = `New ad #${args.id} to review — ${site.name}`;
  const text = [
    `A new ${kind} was posted and is waiting for review.`,
    ``,
    `Ad #${args.id}`,
    `From: ${formatPhone(args.from)}`,
    ``,
    args.body,
    ``,
    `Review it: ${reviewUrl}`,
  ].join("\n");
  const html = `<div style="max-width:600px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
    <p style="font-size:16px;">A new ${kind} is waiting for review.</p>
    <p style="font-size:14px;color:#5b6670;">Ad #${args.id} · from ${formatPhone(args.from)}</p>
    <blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #2d5570;">${args.body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</blockquote>
    <p><a href="${reviewUrl}" style="color:#2d5570;font-weight:600;">Open the review queue</a></p>
  </div>`;
  try {
    await email.send({ to, subject, html, text });
  } catch (e) {
    console.error("[notify] admin new-ad email failed:", e);
  }
}
