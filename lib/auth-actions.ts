"use server";

import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import { gaClientIdFromCookie } from "@/analytics/src/ids";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizePhone } from "@/lib/phone";
import {
  createCode,
  getAccount,
  hashPassword,
  upsertAccountPassword,
  verifyCode,
  verifyPassword,
} from "@/lib/store";
import { smsDevEcho } from "@/lib/sms";
import { dispatchSms } from "@/lib/outbound";
import { reserveSms } from "@/lib/engine-store";
import { getEngineSettings, effectiveSmsCaps } from "@/lib/settings";
import {
  createSession,
  createTicket,
  destroySession,
  destroyTicket,
  readTicket,
} from "@/lib/session";
import { site } from "@/lib/config";
import { devToolsEnabled } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";
import { isBlockedNumber } from "@/lib/blocklist";

const safeNext = (raw: FormDataEntryValue | null) => safeNextPath(raw);

function loginUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/login${qs ? `?${qs}` : ""}`;
}

/** Where to land after signing in: back where they came from, else the account page. */
function landing(next: string): string {
  return next === "/" ? "/account" : next;
}

async function issueCode(phone: string, next: string): Promise<never> {
  // Refuse before spending a code (and a segment) on a number we already
  // threw out. dispatchSms would drop the text anyway, but the member would
  // see a generic "couldn't send" and keep retrying.
  if (await isBlockedNumber(phone)) {
    redirect(loginUrl({ phone, next, error: "blocked" }));
  }
  // Only persist the plaintext OTP for on-screen echo when dev tools are on —
  // never store it in a production DB just because Telnyx isn't wired yet.
  const result = await createCode(phone, smsDevEcho && devToolsEnabled);
  if (!result.ok) {
    redirect(loginUrl({ step: "code", phone, next, error: "rate" }));
  }
  // Count the login-code SMS against the SAME service-wide breaker as every
  // other outbound reply. /login is unauthenticated, so without this an outsider
  // scripting submitPhone/requestCode across enumerated numbers could pump
  // unbounded SMS to arbitrary phones — denial-of-wallet AND mass unsolicited
  // codes that risk 10DLC campaign suspension. createCode already caps 3/number/
  // hour; this adds the global ceiling the login path otherwise bypassed.
  const settings = await getEngineSettings();
  const caps = effectiveSmsCaps(settings);
  const HOUR = 60 * 60 * 1000;
  if (
    !(await reserveSms(phone, "reply", caps.repliesPerHour, caps.globalPerHour, caps.picsPerHour, HOUR))
  ) {
    redirect(loginUrl({ phone, next, error: "sms" }));
  }
  // Sign-in code is a "transactional" send: it survives a PARTIAL pause but is
  // suppressed by a FULL pause (in that emergency, admins use their password).
  // A throw (provider down) or a non-send (paused/throttled) both fall to the
  // same plain "couldn't text you" screen rather than a crash. redirect() must
  // stay OUT of the try — it signals by throwing.
  let codeSent = false;
  try {
    codeSent = (
      await dispatchSms(
        phone,
        `${site.name}: your sign-in code is ${result.code}. It expires in 5 minutes.`,
        { cls: "transactional", settings },
      )
    ).sent;
  } catch (e) {
    console.error("[auth] sign-in code send failed:", e);
  }
  if (!codeSent) {
    redirect(loginUrl({ phone, next, error: "sms" }));
  }
  redirect(loginUrl({ step: "code", phone, next }));
}

export async function submitPhone(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(loginUrl({ next, error: "phone" }));
  }
  const account = await getAccount(phone);
  if (account?.passwordHash) {
    redirect(loginUrl({ step: "password", phone, next }));
  }
  await issueCode(phone, next);
}

export async function requestCode(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(loginUrl({ next, error: "phone" }));
  }
  await issueCode(phone, next);
}

export async function submitPassword(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(loginUrl({ next, error: "phone" }));
  }
  const password = String(formData.get("password") ?? "");
  const account = await getAccount(phone);
  if (!account?.passwordHash || !verifyPassword(password, account.passwordHash)) {
    redirect(loginUrl({ step: "password", phone, next, error: "password" }));
  }
  // The password lane sends no SMS, so the outbound blocklist check never sees
  // it — without this, a blocked number that had ever set a password could
  // still sign in and act on the website. Checked AFTER the password so a
  // wrong guess can't be used to probe who is blocked.
  if (await isBlockedNumber(phone)) {
    redirect(loginUrl({ phone, next, error: "blocked" }));
  }
  const gaCookie = (await cookies()).get("_ga")?.value;
  const signInMethod = "password";
  await createSession(phone);
  afterResponse(() =>
    analytics.custom({ phone, clientId: gaClientIdFromCookie(gaCookie) ?? undefined }, "login", {
      method: signInMethod,
    }),
  );
  redirect(landing(next));
}

export async function submitCode(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(loginUrl({ next, error: "phone" }));
  }
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const result = await verifyCode(phone, code);
  if (result !== "ok") {
    const error =
      result === "wrong" ? "code" : result === "attempts" ? "attempts" : "expired";
    redirect(loginUrl({ step: "code", phone, next, error }));
  }
  await createTicket(phone);
  redirect(loginUrl({ step: "set-password", phone, next }));
}

export async function submitSetPassword(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(loginUrl({ next, error: "phone" }));
  }
  const ticketPhone = await readTicket();
  if (ticketPhone !== phone) {
    redirect(loginUrl({ next, error: "ticket" }));
  }
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    redirect(loginUrl({ step: "set-password", phone, next, error: "weak" }));
  }
  await upsertAccountPassword(phone, hashPassword(password));
  await destroyTicket();
  const gaCookie = (await cookies()).get("_ga")?.value;
  const signInMethod = "code";
  await createSession(phone);
  afterResponse(() =>
    analytics.custom({ phone, clientId: gaClientIdFromCookie(gaCookie) ?? undefined }, "login", {
      method: signInMethod,
    }),
  );
  redirect(landing(next));
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/");
}
