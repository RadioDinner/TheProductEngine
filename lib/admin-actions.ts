"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { approveAd, rejectAd } from "@/lib/moderation";
import {
  addLedgerEntry,
  ensureAccount,
  getAccount,
  mergeAccounts,
  resolveChatReport,
  setOffenseCount,
  setPostingBanned,
  setVerified,
} from "@/lib/store";
import { dispatchSms } from "@/lib/outbound";
import { site } from "@/lib/config";
import {
  addWordRule,
  getEngineSettings,
  removeWordRule,
  saveEngineSettings,
  toggleWordRule,
} from "@/lib/settings";
import { blockNumber, unblockNumber } from "@/lib/blocklist";
import {
  cancelQueuedOutboxFor,
  countRecentOutboundContaining,
  deleteAdRecord,
  getAdRecord,
  logMessage,
  queueBump,
  reassignAdOwnership,
  resolvePhotoSubmission,
  revertAdToPending,
  reviveAd,
  setAdHold,
  swapAdApprovalOrder,
  updateAdBody,
} from "@/lib/engine-store";
import { nextSlotOccurrence, selectDigestItems, sendDigestNow } from "@/lib/digest-engine";
import { normalizePhone } from "@/lib/phone";

/** Whitelisted return targets for shared ad actions — never trust a form string. */
function backTarget(formData: FormData): string {
  return String(formData.get("back")) === "/admin/digests" ? "/admin/digests" : "/admin/ads";
}

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

/** Edit an ad's public text from the Ads or Digests tab. */
export async function adminEditAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  // Same ceiling as the maxChars setting clamp — an admin edit shouldn't be
  // able to balloon a digest.
  const body = String(formData.get("body") ?? "").trim().slice(0, 300);
  if (Number.isInteger(id) && body) await updateAdBody(id, body);
  redirect(backTarget(formData));
}

/** Queue a free admin bump: the ad rides the next digest again. An expired ad
 * is relisted first — the same semantics as the seller's own BUMP. */
export async function adminQueueBump(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    const ad = await getAdRecord(id);
    if (ad?.status === "expired") {
      const settings = await getEngineSettings();
      await reviveAd(id, settings.expiryDays);
      await queueBump(id);
    } else if (ad?.status === "approved") {
      await queueBump(id);
    }
  }
  redirect(backTarget(formData));
}

/** Delete an ad (soft — migration 9987): off the website and out of the
 * digest queue immediately, queued bumps dropped, photo removed from storage.
 * Digest history and the message log keep the ad number. No refund and no
 * seller notice — the confirm UI on /admin/ads says so and shows the charge,
 * so a deserved refund goes through Grant credits on the user's page. */
export async function adminDeleteAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/admin/ads");
  const outcome = await deleteAdRecord(id);
  if (outcome === "unsupported") redirect("/admin/ads?error=migration9987");
  redirect(outcome === "deleted" ? `/admin/ads?deleted=${id}` : "/admin/ads");
}

/** Clear a member's chat-message report from the Review queue (item 13).
 * Resolve vs dismiss is just the recorded outcome — any real action (a word
 * with the sender, a posting ban) stays admin judgement on the Users page. */
export async function adminResolveChatReport(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const resolution = formData.get("decision") === "resolved" ? "resolved" : "dismissed";
  if (Number.isInteger(id)) await resolveChatReport(id, resolution);
  redirect("/admin");
}

/** Approve (→ website gallery) or discard an emailed-in extra picture. */
export async function adminResolvePhotoSubmission(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  if (Number.isInteger(id)) await resolvePhotoSubmission(id, approve);
  redirect("/admin/ads");
}

/** Skip the next digest: hold the ad until just after the upcoming slot. */
export async function adminDelayAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    const settings = await getEngineSettings();
    const next = nextSlotOccurrence(settings.slots);
    if (next) {
      // One hour past the skipped slot: safely later than any late-running
      // compose of that slot, and at/before the following slot's compose.
      await setAdHold(id, new Date(next.at.getTime() + 3600_000).toISOString());
    }
  }
  redirect("/admin/digests");
}

/** Release a held ad back into the digest queue immediately. */
export async function adminReleaseAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await setAdHold(id, null);
  redirect("/admin/digests");
}

/** Move an ad up/down in the digest queue by swapping approval order with its
 * neighbor (new ads run FIFO by approval time; bumps always follow new ads). */
export async function adminMoveAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const dir = formData.get("dir") === "up" ? "up" : "down";
  if (Number.isInteger(id)) {
    const settings = await getEngineSettings();
    const { newAds } = await selectDigestItems(settings.digestCap);
    const index = newAds.findIndex((a) => a.id === id);
    const neighbor = dir === "up" ? newAds[index - 1] : newAds[index + 1];
    if (index >= 0 && neighbor) await swapAdApprovalOrder(id, neighbor.id);
  }
  redirect("/admin/digests");
}

/** Pull a queued ad out of the digest queue, back into the review list. */
export async function adminRevertAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await revertAdToPending(id);
  redirect("/admin/digests");
}

/** Send the digest now: "early" (the upcoming slot, ahead of schedule) or
 * "extra" (an additional edition that doesn't consume the queue). */
export async function adminSendDigest(formData: FormData): Promise<void> {
  await requireAdmin();
  const edition = formData.get("edition") === "extra" ? "extra" : "early";
  const result = await sendDigestNow(edition);
  if (result.ok) {
    redirect(
      `/admin/digests?sent=${edition}&items=${result.items}&to=${result.recipients}&emails=${result.emailRecipients}`,
    );
  }
  redirect(`/admin/digests?senderror=${encodeURIComponent(result.reason)}`);
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

/** Merge another identity (a phone account, or an email signup) into the
 * account being viewed. Phone = FULL merge: ads, credits, passes, strikes,
 * saved card move here and the other account is deleted. Email = link the
 * email + its subscription here (the person gets both editions). */
export async function adminMergeUsers(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const source = String(formData.get("source") ?? "").trim();
  if (!phone) redirect("/admin/users");
  if (!source) redirect(`/admin/users?phone=${phone}&error=merge&reason=Enter a phone or email.`);
  const outcome = await mergeAccounts(phone, source);
  if (!outcome.ok) {
    redirect(`/admin/users?phone=${phone}&error=merge&reason=${encodeURIComponent(outcome.reason)}`);
  }
  let detail: string;
  if (outcome.kind === "phone") {
    const fileAdsMoved = await reassignAdOwnership(outcome.loserPhone, phone);
    const adsMoved = outcome.adsMoved + fileAdsMoved;
    detail = `Merged ${outcome.loserPhone}: ${adsMoved} ad${adsMoved === 1 ? "" : "s"} and ${outcome.creditEntriesMoved} credit entr${outcome.creditEntriesMoved === 1 ? "y" : "ies"} moved here; that account is gone. Its message history stays under the old number in the Messages log.`;
  } else {
    detail = `Linked ${outcome.email} — this member now gets both the text and email digests.`;
  }
  redirect(`/admin/users?phone=${phone}&saved=merge&detail=${encodeURIComponent(detail)}`);
}

/** Exact phrase in the invite text — the once-per-day dedup key. */
const INVITE_MARKER = "To sign up, reply START";

/**
 * Add a member from /admin/users (FEATURES item 8): create the account,
 * optionally grant starting credits, and text a compliant invite. The invite
 * is reply-class (pause/blocklist/caps apply), refused for already-subscribed
 * numbers, and deduped to one per number per 24 h — an invite is outreach to
 * someone who never texted us, so it stays polite and non-repeating. Their
 * START then runs the normal subscribe flow (welcome + carrier opt-in text).
 */
export async function adminInviteUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) {
    redirect(`/admin/users?error=invite&reason=${encodeURIComponent("Enter a 10-digit phone number.")}`);
  }
  const back = (kind: "saved" | "error", detail: string) =>
    redirect(`/admin/users?phone=${phone}&${kind}=invite&reason=${encodeURIComponent(detail)}`);

  const existing = await getAccount(phone);
  if (existing?.subscribedAt) back("error", "That number is already subscribed.");
  const invited = await countRecentOutboundContaining(phone, INVITE_MARKER, 24 * 60 * 60 * 1000);
  if (invited > 0) back("error", "That number was already invited in the last day.");

  await ensureAccount(phone);
  const rawCredits = Number(String(formData.get("credits") ?? "").trim() || 0);
  const credits = Number.isInteger(rawCredits) ? Math.min(Math.max(rawCredits, 0), 1000) : 0;
  if (credits > 0) {
    await addLedgerEntry(phone, {
      delta: credits,
      kind: "grant",
      note: "Starting credits — added with the admin invite",
    });
  }

  const invite =
    `${site.name}: you're invited to Holmes County's classifieds by text. ` +
    `${INVITE_MARKER} (up to 4 msgs/day; msg&data rates may apply). ` +
    `Reply HELP for help, STOP to opt out. Info: ThePlainExchange.com/sms or call ${site.supportPhone}.`;
  const { sent, reason } = await dispatchSms(phone, invite, { cls: "reply" });
  if (!sent) back("error", `Account created${credits ? ` with ${credits} credits` : ""}, but the text was not sent (${reason ?? "suppressed"}).`);
  await logMessage({ direction: "outbound", channel: "sms", address: phone, body: invite });
  back("saved", `Invite sent${credits ? ` and ${credits} credit${credits === 1 ? "" : "s"} granted` : ""}.`);
}

/** Grant or revoke the green check (FEATURES item 7) — a manual, human
 * decision only; there is no self-serve path anywhere. */
export async function adminSetVerified(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) redirect("/admin/users");
  const outcome = await setVerified(phone, formData.get("on") === "yes");
  redirect(
    `/admin/users?phone=${phone}${outcome === "saved" ? "&saved=verify" : "&error=verify"}`,
  );
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
  revealsPerDay: 1000,
  revealBankCap: 10000,
  revealAbusePerDay: 1000,
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
    "revealsPerDay",
    "revealBankCap",
    "revealAbusePerDay",
    "savedCardDiscountPercent",
    "outboundThrottlePerMin",
  ]) {
    const value = num(key);
    if (value !== null) update[key] = value;
  }
  const slots = parseSlots("slots");
  if (slots.length) update.slots = [...new Set(slots)].sort((a, b) => a - b);
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
