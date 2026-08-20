"use server";

/**
 * Filing an "I need help!" report (feature 39).
 *
 * The browser sends what only it knows (which page, how wide, what browser,
 * the last error it saw); this fills in what only the SERVER knows (who is
 * signed in, whether we hold an email for them) and never trusts the client
 * for either. A report claiming to be from someone else would be worse than
 * no report.
 *
 * User decision: email the operator immediately AND queue for review. The
 * email is how you find out; the queue is how you work through them and see
 * patterns — three reports from one page in an hour is a bug report even when
 * no single one of them reads like one.
 */
import { readSession } from "@/lib/session";
import { getAccount } from "@/lib/store";
import { dispatchEmail } from "@/lib/outbound";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { stripEmoji } from "@/lib/content-filter";
import {
  reportSummary,
  sanitizeDiagnostics,
  type HelpDiagnostics,
} from "@/lib/help-reports";
import { addHelpReport } from "@/lib/help-report-store";

export interface HelpSubmitState {
  ok?: boolean;
  queued?: boolean;
  error?: string;
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function submitHelpReport(
  _prev: HelpSubmitState | null,
  formData: FormData,
): Promise<HelpSubmitState> {
  const raw: Partial<HelpDiagnostics> = {
    path: String(formData.get("path") ?? "/"),
    referrer: String(formData.get("referrer") ?? ""),
    userAgent: String(formData.get("userAgent") ?? ""),
    viewport: String(formData.get("viewport") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    lastError: String(formData.get("lastError") ?? ""),
    // Emoji stripped for the same reason as everywhere else: this text can
    // ride an SMS-adjacent path and reads badly on a plain terminal.
    note: stripEmoji(String(formData.get("note") ?? "")),
  };
  const diag = sanitizeDiagnostics(raw);

  // Identity comes from the session cookie, NEVER from the form.
  const session = await readSession();
  const phone = session?.phone ?? null;
  let memberId: string | null = null;
  let hasEmail = false;
  if (phone) {
    try {
      const account = await getAccount(phone);
      hasEmail = Boolean(account?.email);
      memberId = account?.userId ?? null;
    } catch (e) {
      // A lookup failure must not lose the report — the diagnostics are the
      // valuable part and they are already in hand.
      console.error("[help] account lookup failed:", e);
    }
  }

  // Queue first, so a mail outage still leaves a record. "unsupported" means
  // migration 9965 isn't pasted — the email below still goes.
  let queued = false;
  try {
    queued = (await addHelpReport({ ...diag, phone, memberId, hasEmail })) === "saved";
  } catch (e) {
    console.error("[help] could not queue report:", e);
  }

  const to = process.env.ADMIN_EMAIL;
  if (to) {
    const lines = [
      `Someone pressed "I need help!" on the website.`,
      ``,
      `Page: ${diag.path}`,
      diag.referrer ? `Came from: ${diag.referrer}` : null,
      phone ? `Signed in as: ${formatPhone(phone)}` : `Signed in: no`,
      memberId ? `Member id: ${memberId}` : null,
      phone ? `Email on file: ${hasEmail ? "yes" : "no"}` : null,
      ``,
      diag.note ? `What they said:` : `They didn't type anything.`,
      diag.note ?? null,
      ``,
      `Browser: ${diag.userAgent ?? "(not given)"}`,
      `Screen: ${diag.viewport ?? "(not given)"}`,
      `Their timezone: ${diag.timezone ?? "(not given)"}`,
      diag.lastError ? `Last error on the page: ${diag.lastError}` : null,
      ``,
      `Filed: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET`,
      queued
        ? `Waiting for you in the admin Help reports tab.`
        : `NOT queued — migration 9965 may still need pasting.`,
    ].filter((l) => l !== null);
    const html = `<div style="max-width:600px;font-family:'Segoe UI',Arial,sans-serif;color:#20262b;">
      <p style="font-size:16px;"><strong>Someone pressed &ldquo;I need help!&rdquo;</strong></p>
      <p style="font-size:14px;">Page: <strong>${esc(diag.path)}</strong><br/>
      ${phone ? `Signed in as: ${esc(formatPhone(phone))}` : "Signed in: no"}${
        memberId ? `<br/>Member id: ${esc(memberId)}` : ""
      }${phone ? `<br/>Email on file: ${hasEmail ? "yes" : "no"}` : ""}</p>
      ${
        diag.note
          ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #2d5570;">${esc(
              diag.note,
            ).replace(/\n/g, "<br/>")}</blockquote>`
          : `<p style="font-size:14px;color:#5b6670;">They didn&rsquo;t type anything.</p>`
      }
      <p style="font-size:12px;color:#5b6670;">
        ${diag.referrer ? `Came from: ${esc(diag.referrer)}<br/>` : ""}
        Browser: ${esc(diag.userAgent ?? "(not given)")}<br/>
        Screen: ${esc(diag.viewport ?? "(not given)")}<br/>
        Their timezone: ${esc(diag.timezone ?? "(not given)")}
        ${diag.lastError ? `<br/>Last error on the page: ${esc(diag.lastError)}` : ""}
      </p>
    </div>`;
    try {
      // Operator class: this is the business hearing from its own customers,
      // so it is never held by a pause, a blocklist or a throttle.
      await dispatchEmail(
        {
          to,
          subject: `${site.name}: ${reportSummary({ path: diag.path, phone, note: diag.note })}`,
          html,
          text: lines.join("\n"),
        },
        { cls: "operator" },
      );
    } catch (e) {
      console.error("[help] report email failed:", e);
      // Not an error to the member: their report IS filed if it queued.
      if (!queued) return { error: "send" };
    }
  }

  if (!queued && !to) return { error: "send" };
  return { ok: true, queued };
}
