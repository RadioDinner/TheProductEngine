"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { approveAd, rejectAd } from "@/lib/moderation";
import { addLedgerEntry, setOffenseCount, setPostingBanned } from "@/lib/store";
import {
  addWordRule,
  removeWordRule,
  saveEngineSettings,
  toggleWordRule,
} from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";

export async function adminApprove(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const body = String(formData.get("body") ?? "");
  if (Number.isInteger(id)) await approveAd(id, body);
  redirect("/admin");
}

export async function adminReject(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const kind = formData.get("kind") === "violation" ? "violation" : "benign";
  const reason =
    String(formData.get("reason") ?? "").trim() ||
    (kind === "benign"
      ? "Please include a price and a way to reach you, then send it again."
      : "It offers an item we can't run.");
  if (Number.isInteger(id)) await rejectAd(id, reason, kind);
  redirect("/admin");
}

export async function adminGrantCredits(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const delta = Number(formData.get("delta"));
  const note = String(formData.get("note") ?? "").trim();
  if (!phone) redirect("/admin/users");
  if (!Number.isInteger(delta) || delta === 0 || !note) {
    redirect(`/admin/users?phone=${phone}&error=grant`);
  }
  await addLedgerEntry(phone, { delta, kind: "adjustment", note });
  redirect(`/admin/users?phone=${phone}&saved=grant`);
}

export async function adminSetStrikes(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const count = Number(formData.get("count"));
  if (phone && Number.isInteger(count)) await setOffenseCount(phone, count);
  redirect(phone ? `/admin/users?phone=${phone}` : "/admin/users");
}

export async function adminSetBan(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const banned = formData.get("banned") === "yes";
  if (phone) await setPostingBanned(phone, banned);
  redirect(phone ? `/admin/users?phone=${phone}` : "/admin/users");
}

export async function adminAddWord(formData: FormData): Promise<void> {
  await requireAdmin();
  const word = String(formData.get("word") ?? "");
  const autoReject = formData.get("autoReject") === "on";
  await addWordRule(word, autoReject);
  redirect("/admin/settings");
}

export async function adminRemoveWord(formData: FormData): Promise<void> {
  await requireAdmin();
  await removeWordRule(String(formData.get("word") ?? ""));
  redirect("/admin/settings");
}

export async function adminToggleWord(formData: FormData): Promise<void> {
  await requireAdmin();
  await toggleWordRule(String(formData.get("word") ?? ""));
  redirect("/admin/settings");
}

export async function adminSaveSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const num = (name: string) => {
    const value = Number(formData.get(name));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  };
  const parseSlots = (name: string) =>
    String(formData.get(name) ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);

  const update: Record<string, number | number[]> = {};
  for (const key of [
    "costText",
    "costPhoto",
    "bumpCost",
    "digestCap",
    "maxChars",
    "expiryDays",
    "smsRepliesPerHour",
    "smsPicsPerHour",
    "smsGlobalPerHour",
  ]) {
    const value = num(key);
    if (value !== null) update[key] = value;
  }
  const slots = parseSlots("slots");
  if (slots.length) update.slots = [...new Set(slots)].sort((a, b) => a - b);
  const emailSlots = parseSlots("emailSlots");
  if (emailSlots.length) update.emailSlots = [...new Set(emailSlots)].sort((a, b) => a - b);
  await saveEngineSettings(update);
  redirect("/admin/settings?saved=1");
}
