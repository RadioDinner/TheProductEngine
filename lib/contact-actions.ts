"use server";

/**
 * "Ask a question" / "Suggest an idea" (FEATURES item 27). A member or a
 * visitor sends the operator a question or an idea; it emails ADMIN_EMAIL
 * with the message AND the sender's contact info so the operator can reach
 * back out. Best-effort through the operator-class outbound seam (never
 * blocked by a pause/blocklist/throttle — the business always hears from its
 * own customers). Emoji stripped and links refused, the same walled-garden
 * hygiene as ads and events; a signed-in member's phone rides along too.
 *
 * Outcomes are signaled repo-style: redirect() with query params.
 */

import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { hasLink, stripEmoji } from "@/lib/content-filter";
import { dispatchEmail } from "@/lib/outbound";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";

const MESSAGE_MAX = 1500;
const NAME_MAX = 80;
const CONTACT_MAX = 120;

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function submitFeedback(formData: FormData): Promise<void> {
  const session = await readSession();

  const kind = String(formData.get("kind") ?? "") === "idea" ? "idea" : "question";
  const label = kind === "idea" ? "idea" : "question";
  const back = (err: string): never =>
    redirect(`/contact?type=${kind}&error=${err}`);

  const name = stripEmoji(String(formData.get("name") ?? "")).trim();
  const emailContact = String(formData.get("email") ?? "").trim();
  const phoneContact = String(formData.get("phone") ?? "").trim();
  const message = stripEmoji(String(formData.get("message") ?? "")).trim();

  if (!message) back("empty");
  if (
    message.length > MESSAGE_MAX ||
    name.length > NAME_MAX ||
    emailContact.length > CONTACT_MAX ||
    phoneContact.length > CONTACT_MAX
  ) {
    back("toolong");
  }
  // Same as event listings: no links, keep it plain words (also blocks the
  // form from being used as a link-spam relay to the operator's inbox).
  if (hasLink(message)) back("link");

  // We must be able to reach them back — a signed-in member always has a phone.
  const sessionPhone = session?.phone ?? "";
  if (!emailContact && !phoneContact && !sessionPhone) back("nocontact");

  // Inline redirect (not the back() helper) so TS narrows `to` to a string
  // for the send below. No operator inbox configured — tell them to call.
  const to = process.env.ADMIN_EMAIL;
  if (!to) redirect(`/contact?type=${kind}&error=noinbox`);

  const subject = `New ${label} from the website — ${site.name}`;
  const text = [
    `Someone sent a ${label} through the website.`,
    ``,
    name ? `Name: ${name}` : `Name: (not given)`,
    emailContact ? `Email: ${emailContact}` : null,
    phoneContact ? `Phone they gave: ${phoneContact}` : null,
    sessionPhone
      ? `Signed-in member: ${formatPhone(sessionPhone)}`
      : `Signed in: no`,
    ``,
    `Message:`,
    message,
    ``,
    `Reach back out using the phone or email above.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const html = `<div style="max-width:600px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
    <p style="font-size:16px;">New ${label} from the website.</p>
    <p style="font-size:14px;color:#5b6670;">
      ${name ? `Name: ${esc(name)}<br/>` : ""}
      ${emailContact ? `Email: ${esc(emailContact)}<br/>` : ""}
      ${phoneContact ? `Phone they gave: ${esc(phoneContact)}<br/>` : ""}
      ${sessionPhone ? `Signed-in member: ${esc(formatPhone(sessionPhone))}` : "Signed in: no"}
    </p>
    <blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #2d5570;">${esc(
      message,
    ).replace(/\n/g, "<br/>")}</blockquote>
  </div>`;

  try {
    await dispatchEmail({ to, subject, html, text }, { cls: "operator" });
  } catch (e) {
    console.error("[contact] feedback email failed:", e);
    back("send");
  }
  redirect(`/contact?type=${kind}&sent=1`);
}
