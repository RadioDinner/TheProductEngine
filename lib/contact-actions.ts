"use server";

/**
 * "Ask a question" / "Suggest a feature" (FEATURES item 27; the suggestion
 * side reworked session 018). A member or a visitor sends the operator a
 * question or a feature idea; it emails ADMIN_EMAIL with the message AND the
 * sender's contact info so the operator can reach back out. Best-effort
 * through the operator-class outbound seam (never blocked by a
 * pause/blocklist/throttle — the business always hears from its own
 * customers). Emoji stripped and links refused, the same walled-garden
 * hygiene as ads and events; a signed-in member's phone rides along too.
 *
 * Outcomes are signaled repo-style: redirect() with query params.
 */

import { afterResponse } from "@/analytics/src/after";
import * as analytics from "@/analytics/src/server-events";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { hasLink, stripEmoji } from "@/lib/content-filter";
import { dispatchEmail } from "@/lib/outbound";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import {
  contactLine,
  nameTargetPhone,
  parseContactDetails,
  type ContactProblem,
} from "@/lib/contact-details";
import { setMemberNameIfEmpty } from "@/lib/store";

const MESSAGE_MAX = 1500;

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function submitFeedback(formData: FormData): Promise<void> {
  const session = await readSession();

  const kind = String(formData.get("kind") ?? "") === "idea" ? "idea" : "question";
  const label = kind === "idea" ? "idea" : "question";
  const back = (err: string): never =>
    redirect(`/contact?type=${kind}&error=${err}`);

  const message = stripEmoji(String(formData.get("message") ?? "")).trim();
  if (!message) back("empty");
  if (message.length > MESSAGE_MAX) back("toolong");
  // Same as event listings: no links, keep it plain words (also blocks the
  // form from being used as a link-spam relay to the operator's inbox).
  if (hasLink(message)) back("link");

  // Name and one way to reach them, REQUIRED since session 018 (user
  // decision). It used to accept a signed-in session in place of typed
  // contact details; it no longer does, because "we know their number" is not
  // the same as knowing which of a household's people wrote in, and the reply
  // to a feature idea is a conversation.
  const contact = parseContactDetails({
    firstName: stripEmoji(String(formData.get("firstName") ?? "")),
    lastName: stripEmoji(String(formData.get("lastName") ?? "")),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  // Inline redirect rather than the back() helper, so TS narrows `contact` to
  // the ok branch for everything below (the same trick the ADMIN_EMAIL check
  // uses further down).
  if (!contact.ok) {
    redirect(`/contact?type=${kind}&error=${contactProblemParam(contact.problem)}`);
  }
  const who = contact.details;
  const sessionPhone = session?.phone ?? "";

  // Learn their name (user request, session 018) — fill-only, best-effort,
  // and never a reason the message fails to reach the operator.
  try {
    const target = nameTargetPhone(sessionPhone, who.phone);
    if (target) await setMemberNameIfEmpty(target, who.firstName, who.lastName);
  } catch (e) {
    console.error("[contact] could not save the sender's name:", e);
  }

  // Inline redirect (not the back() helper) so TS narrows `to` to a string
  // for the send below. No operator inbox configured — tell them to call.
  const to = process.env.ADMIN_EMAIL;
  if (!to) redirect(`/contact?type=${kind}&error=noinbox`);

  const subject = `New ${label} from ${who.firstName} ${who.lastName} — ${site.name}`;
  const text = [
    `Someone sent a ${label} through the website.`,
    ``,
    `Get back to them: ${contactLine(who)}`,
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
    <p style="font-size:15px;">Get back to them: <strong>${esc(contactLine(who))}</strong></p>
    <p style="font-size:14px;color:#5b6670;">
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
  afterResponse(() => analytics.custom({}, "contact_submit", { contact_type: kind }));
  redirect(`/contact?type=${kind}&sent=1`);
}

/** Form problems travel back as ?error= on the redirect, repo-style. The
 * suggestion/question page prints the matching sentence. */
function contactProblemParam(problem: ContactProblem): string {
  return problem === "contact" ? "nocontact" : `bad${problem}`;
}
