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

/**
 * The digest circuit breaker tripped: the rolling-24h billed-segment budget
 * is spent and deliveries are waiting. Sent once per trip (the drain only
 * alerts on the crossing run / a fresh enqueue), so the 5-minute cron can't
 * flood the inbox. Also logged, so it's visible even without ADMIN_EMAIL.
 */
export async function notifyAdminDigestHalted(args: {
  spent: number;
  budget: number;
  remaining: number;
}): Promise<void> {
  console.error(
    `[digest] BUDGET HALT: ${args.spent} segments sent in the last 24h ` +
      `(budget ${args.budget}); ${args.remaining} deliveries waiting.`,
  );
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const settingsUrl = `${siteUrl}/admin/settings`;
  const subject = `Digest sending paused — segment budget reached — ${site.name}`;
  const text = [
    `Digest delivery halted: ${args.spent} SMS segments were sent in the last 24 hours,`,
    `which meets the daily budget of ${args.budget}.`,
    ``,
    `${args.remaining} queued deliveries are waiting and will resume automatically`,
    `once the 24-hour window frees up room — or immediately if you raise the`,
    `"Daily digest segment budget" in settings.`,
    ``,
    `Settings: ${settingsUrl}`,
  ].join("\n");
  const html = `<div style="max-width:600px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
    <p style="font-size:16px;"><strong>Digest sending is paused.</strong></p>
    <p style="font-size:14px;">${args.spent} SMS segments went out in the last 24 hours, meeting the daily budget of ${args.budget}. ${args.remaining} queued deliveries are waiting.</p>
    <p style="font-size:14px;">They resume automatically as the 24-hour window frees room — or immediately if you raise the budget.</p>
    <p><a href="${settingsUrl}" style="color:#2d5570;font-weight:600;">Open settings</a></p>
  </div>`;
  try {
    await email.send({ to, subject, html, text });
  } catch (e) {
    console.error("[notify] digest-halt email failed:", e);
  }
}
