"use server";

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
import { sms, smsDevEcho } from "@/lib/sms";
import {
  createSession,
  createTicket,
  destroySession,
  destroyTicket,
  readTicket,
} from "@/lib/session";
import { site } from "@/lib/config";

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  // Must be a same-site absolute path. Reject protocol-relative ("//host") and
  // backslash tricks ("/\host") that browsers normalize to an off-site origin.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

function loginUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/login${qs ? `?${qs}` : ""}`;
}

/** Where to land after signing in: back where they came from, else the account page. */
function landing(next: string): string {
  return next === "/" ? "/account" : next;
}

async function issueCode(phone: string, next: string): Promise<never> {
  const result = await createCode(phone, smsDevEcho);
  if (!result.ok) {
    redirect(loginUrl({ step: "code", phone, next, error: "rate" }));
  }
  try {
    await sms.send(
      phone,
      `${site.name}: your sign-in code is ${result.code}. It expires in 5 minutes.`,
    );
  } catch (e) {
    // Provider down or number not yet approved to send: tell the person
    // plainly instead of crashing to an error page.
    console.error("[auth] sign-in code send failed:", e);
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
  await createSession(phone);
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
  await createSession(phone);
  redirect(landing(next));
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/");
}
