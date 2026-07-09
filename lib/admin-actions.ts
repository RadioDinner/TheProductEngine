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
import { blockNumber, unblockNumber } from "@/lib/blocklist";
import { cancelQueuedOutboxFor } from "@/lib/engine-store";
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

// Sane ceilings so one fat-fingered save can't create a runaway-cost digest
// (thousands of ads / giant bodies) or neutralize the abuse circuit breaker.
const SETTING_MAX: Record<string, number> = {
  costText: 100,
  costPhoto: 100,
  bumpCost: 100,
  digestCap: 15,
  maxChars: 300,
  expiryDays: 365,
  smsRepliesPerHour: 200,
  smsPicsPerHour: 100,
  smsGlobalPerHour: 5000,
  digestDailySegmentBudget: 100000,
  picAbusePerDay: 1000,
  picDailyAllowance: 1000,
  picBankCap: 10000,
  savedCardDiscountPercent: 100,
  outboundThrottlePerMin: 10000,
};

export async function adminSaveSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const num = (name: string) => {
    const raw = formData.get(name);
    // A blank or absent field means "leave this setting unchanged" — NOT zero.
    // Number("") and Number(null) are both 0, which used to silently save 0 and
    // disable core features (digestCap 0 = no ads, budget 0 = digests paused,
    // maxChars 0 = every ad too long). An explicit "0" the admin types is kept.
    if (raw === null) return null;
    const str = String(raw).trim();
    if (str === "") return null;
    const value = Number(str);
    if (!Number.isFinite(value) || value < 0) return null;
    const max = SETTING_MAX[name] ?? Number.MAX_SAFE_INTEGER;
    return Math.min(Math.floor(value), max);
  };
  const parseSlots = (name: string) =>
    String(formData.get(name) ?? "")
      .split(",")
      .map((s) => s.trim())
      // Drop empty tokens BEFORE Number(): a trailing/double comma ("7,18,")
      // otherwise became Number("") = 0 = an unintended midnight (hour 0) slot.
      .filter((s) => s !== "")
      .map(Number)
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
    "digestDailySegmentBudget",
    "picAbusePerDay",
    "picDailyAllowance",
    "picBankCap",
    "savedCardDiscountPercent",
    "outboundThrottlePerMin",
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

// ---------- operator kill switches (PAUSE + UNDER ATTACK) ----------

/** Set the master outbound pause: "off" | "bulk" (partial) | "all" (full). */
export async function adminSetPause(formData: FormData): Promise<void> {
  await requireAdmin();
  const mode = String(formData.get("mode"));
  if (mode === "off" || mode === "bulk" || mode === "all") {
    await saveEngineSettings({ pauseMode: mode });
  }
  redirect("/admin/settings?saved=pause");
}

/** Toggle UNDER ATTACK mode (suppress + auto-tighten caps + throttle). */
export async function adminSetUnderAttack(formData: FormData): Promise<void> {
  await requireAdmin();
  await saveEngineSettings({ underAttack: String(formData.get("on")) === "yes" });
  redirect("/admin/settings?saved=attack");
}

/** Block a number (one-click from Insights, or by hand on Settings). */
export async function adminBlockNumber(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || "Blocked from admin";
  // Whitelisted return targets — never trust a redirect string from the form.
  const back = String(formData.get("back")) === "/admin/insights" ? "/admin/insights" : "/admin/settings";
  if (phone) {
    await blockNumber(phone, reason, admin);
    // Drop any digest already queued for this number so the block takes effect
    // immediately, even for a broadcast composed before the block.
    await cancelQueuedOutboxFor(phone);
  }
  redirect(back);
}

/** Remove a number from the blocklist. */
export async function adminUnblockNumber(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (phone) await unblockNumber(phone);
  redirect("/admin/settings?saved=unblock");
}
