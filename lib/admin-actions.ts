"use server";

import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { approveAd, rejectAd } from "@/lib/moderation";
import {
  addLedgerEntry,
  ensureAccount,
  getAccount,
  getCreditBalance,
  hasLedgerRef,
  listSubscribersWithCategories,
  mergeAccounts,
  resolveChatReport,
  setOffenseCount,
  setPostingBanned,
  setVerified,
} from "@/lib/store";
import { headers } from "next/headers";
import { dispatchSms } from "@/lib/outbound";
import { customAmountCents, formatPrice, isTopUpPreset, site } from "@/lib/config";
import {
  chargeSavedCard,
  createCheckoutSession,
  paymentsDevMode,
  resolveStripeCustomer,
} from "@/lib/payments";
import { devToolsEnabled } from "@/lib/env";
import {
  getEngineSettings,
  replaceWordRules,
  saveEngineSettings,
} from "@/lib/settings";
import { buildWordRules } from "@/lib/word-filter";
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
  setAdCategory,
  setAdHold,
  swapAdApprovalOrder,
  updateAdBody,
} from "@/lib/engine-store";
import { isCategoryKey } from "@/lib/categories";
import { nextSlotOccurrence, selectDigestItems, sendDigestNow } from "@/lib/digest-engine";
import {
  approveBusinessPackage,
  declineBusinessPackage,
  markBusinessRefunded,
} from "@/lib/business";
import { resolveEvent } from "@/lib/town-hall-store";
import { FEATURED_CAPTION_MAX, acceptableSpotLink } from "@/lib/featured";
import {
  addFeaturedSpot,
  deleteFeaturedSpot,
  setFeaturedSpotActive,
} from "@/lib/featured-store";
import { removeHostedPhotos, storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";
import { stripEmoji } from "@/lib/content-filter";
import { normalizePhone } from "@/lib/phone";

/** Whitelisted return targets for shared ad actions — never trust a form string. */
function backTarget(formData: FormData): string {
  return String(formData.get("back")) === "/admin/digests" ? "/admin/digests" : "/admin/ads";
}

export async function adminApprove(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const body = String(formData.get("body") ?? "");
  // Category (item 22): the operator assigns it at review. No form field
  // (pre-9976 the dropdown is hidden) = undefined = leave the ad's category
  // alone; "" or junk = explicit Uncategorized (rides every digest).
  const rawCategory = formData.get("category");
  const category =
    rawCategory === null
      ? undefined
      : isCategoryKey(String(rawCategory))
        ? String(rawCategory)
        : null;
  if (Number.isInteger(id)) await approveAd(id, body, category);
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

/** Edit an ad's public text (and, where the form offers it, its category)
 * from the Ads or Digests tab. */
export async function adminEditAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  // Same ceiling as the maxChars setting clamp — an admin edit shouldn't be
  // able to balloon a digest.
  const body = String(formData.get("body") ?? "").trim().slice(0, 300);
  if (Number.isInteger(id) && body) await updateAdBody(id, body);
  // Inline category (item 22): only forms that rendered the select send it
  // (it's hidden pre-9976), so a missing field never clears a category.
  const rawCategory = formData.get("category");
  if (Number.isInteger(id) && rawCategory !== null) {
    await setAdCategory(id, isCategoryKey(String(rawCategory)) ? String(rawCategory) : null);
  }
  redirect(backTarget(formData));
}

/** Queue a free admin re-run: the ad rides the next digest again. An expired
 * ad is relisted first. Operator-only — the member-facing BUMP feature was
 * removed entirely in session 016 (user decision); this internal tool is how
 * the operator re-runs or relists an ad when it's warranted. */
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

/** Approve a pending town-hall event (item 18): it appears on the homepage
 * sidebar and /town-hall until its date passes, then drops off by itself. */
export async function adminApproveEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await resolveEvent(id, "approved");
  redirect("/admin");
}

/** Decline a pending town-hall event — simple by design: listings are FREE
 * in v1, so there is nothing to refund and no strike machinery. */
export async function adminDeclineEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await resolveEvent(id, "declined");
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

/**
 * Phone orders (call-in card payments). Both actions create a REAL Stripe
 * Checkout session for an ad-credit top-up ON BEHALF of the member being
 * viewed — same metadata/webhook path as self-serve, so completing it grants
 * the money AND saves the card to that member's Stripe customer (enabling
 * automatic top-up). Card numbers never touch this app: they are keyed
 * directly into Stripe's hosted page — either by the OPERATOR while the
 * caller reads the card out (open-here), or by the member themselves via a
 * texted link. Cash/check stays on Adjust balance above.
 */
/** The phone-order forms' amount: the "custom $" box wins when filled
 * (dollars, validated/clamped by customAmountCents), otherwise the preset
 * select. Null means neither was usable. */
function phoneOrderAmountCents(formData: FormData): number | null {
  const custom = String(formData.get("customAmount") ?? "").trim();
  if (custom) return customAmountCents(custom);
  const preset = Number(formData.get("amount"));
  return isTopUpPreset(preset) ? preset : null;
}

async function phoneOrderSession(
  formData: FormData,
  urls: (origin: string, phone: string) => { successUrl?: string; cancelUrl?: string },
): Promise<{ phone: string; url: string; amountCents: number } | { phone: string; error: string }> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) redirect("/admin/users");
  const amountCents = phoneOrderAmountCents(formData);
  if (amountCents === null) return { phone, error: "phoneorder_pack" };
  if (paymentsDevMode) return { phone, error: "phoneorder_dev" };
  // A brand-new caller gets an account minted right here, so the very first
  // contact with the exchange can be "call in, pay, start posting".
  await ensureAccount(phone);
  const requestHeaders = await headers();
  const origin =
    process.env.SITE_URL || `https://${requestHeaders.get("host") ?? "localhost:3000"}`;
  try {
    const url = await createCheckoutSession({
      amountCents,
      phone,
      origin,
      ...urls(origin, phone),
    });
    return { phone, url, amountCents };
  } catch (e) {
    console.error("[admin] phone-order session failed:", e);
    return { phone, error: "phoneorder" };
  }
}

/**
 * Bill the member's SAVED card for an ad-credit top-up while they're on the
 * phone ("charge my card on file"). Same off-session charge and idempotent
 * ref-then-grant as automatic top-up — but the confirmation is verbal, so
 * the form carries a render-time nonce as the ref: a double-click (or a
 * Stripe retry) can neither double-charge nor double-grant. Declines (incl.
 * banks demanding 3-D Secure, which can't happen over the phone) come back
 * as a readable reason; the fallback is the checkout lane below, where the
 * bank challenge can actually be met.
 */
export async function adminBillSavedCard(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) redirect("/admin/users");
  // The explicit `never` annotation on the CONST (not just the arrow) is what
  // lets TS narrow after each `back(...)` guard below.
  const back: (q: string) => never = (q) => redirect(`/admin/users?phone=${phone}&${q}`);

  const amountCents = phoneOrderAmountCents(formData);
  if (amountCents === null) back("error=phoneorder_pack");
  const nonce = String(formData.get("nonce") ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!nonce) back("error=bill");
  const account = await getAccount(phone);
  // A card saved through the pay-by-phone line is adopted here on first use.
  const customerId = account
    ? await resolveStripeCustomer(phone, account.stripeCustomerId)
    : null;
  if (!customerId) back("error=bill_nocard");

  const ref = `adminbill:${phone}:${nonce}`;
  if (await hasLedgerRef(ref)) {
    back(`saved=bill&detail=${encodeURIComponent(`That money was already added — balance ${formatPrice(await getCreditBalance(phone))}.`)}`);
  }

  let result: { ok: boolean; last4?: string; reason?: string };
  if (!paymentsDevMode) {
    result = await chargeSavedCard({
      customerId: customerId!,
      amountCents,
      ref,
      phone,
      description: `${formatPrice(amountCents)} ad credit — ${site.name} (phone order)`,
    });
  } else if (devToolsEnabled) {
    result = { ok: true, last4: "0000" }; // dev simulation (never in a real prod deploy)
  } else {
    back("error=phoneorder_dev");
    return; // unreachable — keeps TS happy about `result`
  }
  if (!result.ok) {
    back(`error=bill&reason=${encodeURIComponent(result.reason ?? "charge failed")}`);
  }
  await addLedgerEntry(phone, {
    delta: amountCents,
    kind: "purchase",
    note: `Added ${formatPrice(amountCents)} of ad credit — saved card, phone order`,
    ref,
  });
  const last4 = result.last4 ? ` ending ${result.last4}` : "";
  back(
    `saved=bill&detail=${encodeURIComponent(
      `Charged ${formatPrice(amountCents)} to the card${last4}. Balance is now ${formatPrice(await getCreditBalance(phone))}.`,
    )}`,
  );
}

/** Open the Stripe checkout in the ADMIN's browser — the operator keys in the
 * card while the caller reads it out, then lands back on the member's page. */
export async function adminPhoneOrderCheckout(formData: FormData): Promise<void> {
  const out = await phoneOrderSession(formData, (origin, phone) => ({
    successUrl: `${origin}/admin/users?phone=${encodeURIComponent(phone)}&saved=phoneorder`,
    cancelUrl: `${origin}/admin/users?phone=${encodeURIComponent(phone)}&error=phoneorder_cancel`,
  }));
  if ("error" in out) redirect(`/admin/users?phone=${out.phone}&error=${out.error}`);
  redirect(out.url);
}

/** Text the member a checkout link instead (for callers with someone who can
 * open a web page). Same session shape; they land on the normal receipt. */
export async function adminTextCheckoutLink(formData: FormData): Promise<void> {
  const out = await phoneOrderSession(formData, () => ({}));
  if ("error" in out) redirect(`/admin/users?phone=${out.phone}&error=${out.error}`);
  const body =
    `${site.name}: secure checkout for ${formatPrice(out.amountCents)} of ad credit — pay by card here ` +
    `(link good for 24 hours): ${out.url}`;
  const { sent, reason } = await dispatchSms(out.phone, body, { cls: "reply" });
  if (!sent) {
    console.warn(`[admin] checkout-link text suppressed: ${reason ?? "unknown"}`);
    redirect(`/admin/users?phone=${out.phone}&error=phoneorder_sms`);
  }
  await logMessage({ direction: "outbound", channel: "sms", address: out.phone, body });
  redirect(`/admin/users?phone=${out.phone}&saved=phoneorder_link`);
}

export async function adminGrantCredits(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  // The form takes DOLLARS (checks, cash, make-goods); the ledger stores
  // cents. Clamp to ±$5,000 so a fat-fingered grant can't mint a fortune.
  const dollars = Number(String(formData.get("delta") ?? "").trim());
  const deltaCents = Math.round(dollars * 100);
  const note = String(formData.get("note") ?? "").trim();
  if (!phone) redirect("/admin/users");
  if (
    !Number.isFinite(deltaCents) ||
    deltaCents === 0 ||
    Math.abs(deltaCents) > 500_000 ||
    !note
  ) {
    redirect(`/admin/users?phone=${phone}&error=grant`);
  }
  await addLedgerEntry(phone, { delta: deltaCents, kind: "adjustment", note });
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
  // Dollars in the form, cents in the ledger — capped at $1,000.
  const rawDollars = Number(String(formData.get("credits") ?? "").trim() || 0);
  const startingCents = Number.isFinite(rawDollars)
    ? Math.min(Math.max(Math.round(rawDollars * 100), 0), 100_000)
    : 0;
  if (startingCents > 0) {
    await addLedgerEntry(phone, {
      delta: startingCents,
      kind: "grant",
      note: "Starting ad credit — added with the admin invite",
    });
  }

  const invite =
    `${site.name}: you're invited to Holmes County's classifieds by text. ` +
    `${INVITE_MARKER} (up to 4 msgs/day; msg&data rates may apply). ` +
    `Reply HELP for help, STOP to opt out. Info: ThePlainExchange.com/sms or call ${site.supportPhone}.`;
  const { sent, reason } = await dispatchSms(phone, invite, { cls: "reply" });
  if (!sent) back("error", `Account created${startingCents ? ` with ${formatPrice(startingCents)} of ad credit` : ""}, but the text was not sent (${reason ?? "suppressed"}).`);
  await logMessage({ direction: "outbound", channel: "sms", address: phone, body: invite });
  back("saved", `Invite sent${startingCents ? ` and ${formatPrice(startingCents)} of ad credit granted` : ""}.`);
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

/**
 * Save the whole word filter from the two comma-separated boxes on
 * /admin/words. The boxes ARE the state: a word deleted from a box is a word
 * deleted from the filter, which is the point of editing a list as text.
 *
 * Both boxes empty is a legitimate save — "turn the filter off" has to be
 * expressible — but it is also what a mangled form post looks like, so it is
 * accepted only when the form says so explicitly with its hidden marker. A
 * request missing either field leaves the filter untouched.
 */
export async function adminSaveWordFilter(formData: FormData): Promise<void> {
  await requireAdmin();
  const reject = formData.get("reject");
  const flag = formData.get("flag");
  if (reject === null || flag === null) redirect("/admin/words");
  const desired = buildWordRules(String(reject), String(flag));
  if (!desired.length && formData.get("confirmEmpty") !== "yes") {
    redirect("/admin/words?saved=empty");
  }
  await replaceWordRules(desired);
  redirect(`/admin/words?saved=${desired.length}`);
}

// Sane ceilings so one fat-fingered save can't create a runaway-cost digest
// (thousands of ads / giant bodies) or neutralize the abuse circuit breaker.
// Money fields are entered in DOLLARS on the form and stored in cents — their
// ceilings here are in dollars.
const SETTING_MAX: Record<string, number> = {
  costTextCents: 1000,
  photoPrice1Cents: 1000,
  photoPrice2Cents: 1000,
  photoPrice3Cents: 1000,
  webAddonCents: 500,
  starterCreditCents: 1000,
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
  categoryConfirmsPerHour: 100,
  outboundThrottlePerMin: 10000,
};

/** Settings the admin types in DOLLARS (converted to cents on save). */
const DOLLAR_SETTINGS = new Set([
  "costTextCents",
  "photoPrice1Cents",
  "photoPrice2Cents",
  "photoPrice3Cents",
  "webAddonCents",
  "starterCreditCents",
]);

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
    const clamped = Math.min(value, max);
    // Dollar fields allow cents ("59.99") and store whole cents.
    return DOLLAR_SETTINGS.has(name) ? Math.round(clamped * 100) : Math.floor(clamped);
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
    "costTextCents",
    "webAddonCents",
    "starterCreditCents",
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
    "categoryConfirmsPerHour",
    "outboundThrottlePerMin",
  ]) {
    const value = num(key);
    if (value !== null) update[key] = value;
  }
  // The picture ladder is three form fields and one stored array. A rung left
  // blank (or junk) keeps its current value, so a half-filled form can never
  // zero a price — and costPhotoCents follows rung 1, since it IS the
  // one-picture price everywhere a single number is still wanted.
  const current = await getEngineSettings();
  const rungs = [1, 2, 3].map(
    (n, i) => num(`photoPrice${n}Cents`) ?? current.photoPricesCents[i] ?? 0,
  );
  if (rungs.some((v, i) => v !== current.photoPricesCents[i])) {
    update.photoPricesCents = rungs;
    update.costPhotoCents = rungs[0];
  }
  const slots = parseSlots("slots");
  if (slots.length) update.slots = [...new Set(slots)].sort((a, b) => a - b);
  await saveEngineSettings(update);

  // Line-type policy checkboxes. An unchecked box sends NOTHING, so absence
  // can't be read as false the way a blank number field is read as
  // "unchanged" — the form ships a hidden marker, and only when that marker
  // is present is an absent box taken to mean off. Without it, any partial
  // POST would silently switch the whole policy off.
  if (formData.get("lookupForm") === "1") {
    await saveEngineSettings({
      lookupEnabled: formData.get("lookupEnabled") === "on",
      voipStarterCredit: formData.get("voipStarterCredit") === "on",
      voipReveals: formData.get("voipReveals") === "on",
      voipPosting: formData.get("voipPosting") === "on",
    });
  }

  // Homepage promo banner: free text, clamped; CLEARING the field is how the
  // admin hides the banner, so blank saves as "" (unlike the numbers above).
  // The link must stay a site-relative path — anything else falls back to the
  // credits section so a typo can never send the homepage off-site.
  const bannerText = formData.get("bannerText");
  if (bannerText !== null) {
    const text = String(bannerText).replace(/\s+/g, " ").trim().slice(0, 200);
    const rawLink = String(formData.get("bannerLink") ?? "").trim();
    const link =
      rawLink.startsWith("/") && !rawLink.startsWith("//") && rawLink.length <= 200
        ? rawLink
        : "/account#credits";
    await saveEngineSettings({ promoBannerText: text, promoBannerLink: link });
  }
  redirect("/admin/settings?saved=1");
}

// ---------- operator kill switches (PAUSE + UNDER ATTACK) ----------

/**
 * The two emergency stops (session 016). Each is a plain on/off, and turning
 * one ON texts subscribers a notice — "nobody should be left wondering why
 * the service went quiet." Turning one OFF is silent: the ads resuming, or a
 * reply arriving, is its own announcement.
 *
 * The notice rides the CRITICAL class, so it goes out even while non-ad
 * outbound is stopped — that is the whole point of it. It is sent ONLY on the
 * off→on edge, so re-saving a already-paused switch never re-texts anyone.
 */
export async function adminSetPause(formData: FormData): Promise<void> {
  await requireAdmin();
  const which = String(formData.get("which"));
  const on = String(formData.get("on")) === "yes";
  if (which !== "ads" && which !== "outbound") redirect("/admin/settings?saved=pause");
  const settings = await getEngineSettings();
  const wasOn = which === "ads" ? settings.adsPaused : settings.outboundPaused;
  await saveEngineSettings(which === "ads" ? { adsPaused: on } : { outboundPaused: on });
  if (!on || wasOn) redirect("/admin/settings?saved=pause");

  const notice =
    which === "ads"
      ? `${site.name}: we're having technical trouble and new ads are paused for a bit. Nothing you posted is lost - queued ads go out as soon as we're back. Sorry for the trouble.`
      : `${site.name}: we're having technical trouble. You'll still get the ads, but replies to commands (MY ADS, STATUS, PIC and the rest) are paused for a bit. We're on it - sorry for the trouble.`;
  const sent = await broadcastNotice(notice);
  redirect(`/admin/settings?saved=pause&notice=${sent}`);
}

/**
 * Text every subscriber one operational notice. Deliberately simple and
 * bounded: this runs inside an admin action, so it sends a few at a time and
 * reports how many it reached rather than pretending to be the digest
 * pipeline. A failure to text one member must never abort the pause itself —
 * the switch is already saved by the time this runs.
 */
async function broadcastNotice(body: string): Promise<number> {
  let sent = 0;
  try {
    const subscribers = await listSubscribersWithCategories();
    const deadline = Date.now() + 20_000;
    for (let i = 0; i < subscribers.length; i += 8) {
      if (Date.now() > deadline) {
        console.error(`[admin] outage notice ran out of time after ${sent} of ${subscribers.length}`);
        break;
      }
      const batch = subscribers.slice(i, i + 8);
      const results = await Promise.all(
        batch.map((s) =>
          dispatchSms(s.phone, body, { cls: "critical" }).catch((e) => {
            console.error(`[admin] outage notice to ${s.phone} failed:`, e);
            return { sent: false };
          }),
        ),
      );
      sent += results.filter((r) => r.sent).length;
    }
  } catch (e) {
    console.error("[admin] outage notice failed:", e);
  }
  return sent;
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

// ---------- business advertising packages (FEATURES item 17) ----------

/** Approve a paid business package: it goes ACTIVE and the run clock starts
 * NOW (user decision: approval, not payment, starts the 7/14/30 days). The
 * sponsor line rides the first digest of each day from here. */
export async function adminApproveBusiness(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await approveBusinessPackage(id);
  redirect("/admin/business");
}

/** Decline a paid business package. NOTHING is auto-refunded (v1 is manual by
 * design): the package never ran, so the money goes back per the refund
 * policy — the Business page flags it "refund due" with the amount and the
 * Stripe payment ref until the operator does the refund in the Stripe
 * dashboard and marks it done here. */
export async function adminDeclineBusiness(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await declineBusinessPackage(id);
  redirect("/admin/business?declined=1");
}

/** Operator confirms the manual Stripe refund of a declined package is done. */
export async function adminMarkBusinessRefunded(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await markBusinessRefunded(id);
  redirect("/admin/business");
}

// ---------- Featured sidebar spots (item 19 — operator-posted only) ----------

/** Same ceiling as every other image ingest path (lib/upload-limits.ts). */
const MAX_FEATURED_IMAGE_BYTES = MAX_UPLOAD_BYTES;

/**
 * Add a Featured spot: image (required, byte-sniffed, re-hosted), optional
 * caption, optional EXTERNAL http(s) link (the operator-only exception to the
 * no-links rule), slot 1|2, order 1–3, active toggle. Dev mode has no storage
 * bucket, so — matching the profile-photo and web-extras pattern — the
 * sniff-verified image is inlined as a data: URI (the sidebar renders it with
 * a plain <img>, so dev walks see the real rotation).
 */
export async function adminAddFeaturedSpot(formData: FormData): Promise<void> {
  await requireAdmin();
  const slot = Number(formData.get("slot")) === 2 ? 2 : 1;
  const rawPosition = Number(formData.get("position"));
  const position = rawPosition === 2 || rawPosition === 3 ? rawPosition : 1;
  const caption = stripEmoji(String(formData.get("caption") ?? "")).slice(0, FEATURED_CAPTION_MAX);
  const linkUrl = String(formData.get("link") ?? "").trim();
  if (linkUrl && !acceptableSpotLink(linkUrl)) redirect("/admin/featured?error=link");
  const active = formData.get("active") === "on";

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) redirect("/admin/featured?error=photo");
  if (image.size > MAX_FEATURED_IMAGE_BYTES) redirect("/admin/featured?error=photo");
  const bytes = Buffer.from(await image.arrayBuffer());
  let src: string;
  if (supabaseConfigured) {
    const stored = await storeImageBytes(bytes);
    if (!stored.ok) redirect("/admin/featured?error=photo");
    src = (stored as { ok: true; url: string }).url;
  } else {
    const ext = sniffImage(bytes);
    if (!ext) redirect("/admin/featured?error=photo");
    src = `data:${CONTENT_TYPE_BY_EXT[ext!]};base64,${bytes.toString("base64")}`;
  }

  const outcome = await addFeaturedSpot({
    slot,
    position,
    src,
    caption: caption || null,
    linkUrl: linkUrl || null,
    active,
  });
  redirect(outcome === "added" ? "/admin/featured?saved=1" : "/admin/featured?error=migration");
}

/** Turn a Featured spot on or off without deleting it. */
export async function adminSetFeaturedActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await setFeaturedSpotActive(id, formData.get("on") === "yes");
  }
  redirect("/admin/featured");
}

/** Delete a Featured spot and clean its image out of storage (best-effort;
 * dev data: URIs are naturally skipped by removeHostedPhotos). */
export async function adminDeleteFeaturedSpot(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    const src = await deleteFeaturedSpot(id);
    if (src) await removeHostedPhotos([src]);
  }
  redirect("/admin/featured?deleted=1");
}
