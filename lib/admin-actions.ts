"use server";

import "@/analytics/src/register-after";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { redirect } from "next/navigation";
import { normalizeAdminMessage } from "@/lib/admin-messages";
import { cancelAdminMessage, createAdminMessage } from "@/lib/engine-store";
import { requireAdmin } from "@/lib/admin";
import { approveAd, rejectAd } from "@/lib/moderation";
import {
  addLedgerEntry,
  ensureAccount,
  getAccount,
  getCreditBalance,
  getLedger,
  hasLedgerRef,
  type LedgerKind,
  listSubscribersWithCategories,
  mergeAccounts,
  resolveChatReport,
  setOffenseCount,
  purgeMember,
  setMemberArchived,
  setPostingBanned,
  setVerified,
  type PurgeCounts,
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
  addWordRule,
  getWordRules,
  removeWordRule,
  replaceWordRules,
  saveEngineSettings,
} from "@/lib/settings";
import { buildWordRules, parseWordList } from "@/lib/word-filter";
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
import { refundableCents } from "@/lib/money";
import { etParts } from "@/lib/et";
import { featuredSchedule } from "@/lib/featured-schedule";
import {
  decideFeaturedRequest,
  listBookedStartDays,
  listPendingRequests,
} from "@/lib/featured-requests";
import { stripEmoji } from "@/lib/content-filter";
import { normalizePhone } from "@/lib/phone";
import { type LineType } from "@/lib/number-lookup";
import { lookupLineTypeDetailed } from "@/lib/number-lookup-server";
import { resolveHelpReport } from "@/lib/help-report-store";
import {
  filterParams,
  parseFilter,
  parseSort,
  parseWidths,
  validColumns,
  type Filter,
} from "@/lib/user-table";
import { deleteView, saveView } from "@/lib/user-table-store";
import { parseTestNumbers, testModeExpiry } from "@/lib/test-mode";
import { readSession } from "@/lib/session";

/**
 * Where a shared ad action returns to.
 *
 * The PATH stays a two-entry allowlist — a server action that redirected to
 * whatever a form field said would be an open redirect, and these forms are
 * one CSRF away from being posted by someone else's page.
 *
 * The /admin/ads list filters ride their own named fields and are re-encoded
 * here, so saving an edit lands back on the SAME filtered list. Editing used
 * to bounce the operator to the unfiltered page, which on a hundred-ad list
 * means finding your place again after every save. Both are length-capped:
 * they end up in a URL, and a form field is not a size the page controls.
 */
function backTarget(formData: FormData, extra?: Record<string, string>): string {
  const path = String(formData.get("back")) === "/admin/digests" ? "/admin/digests" : "/admin/ads";
  const params = new URLSearchParams();
  if (path === "/admin/ads") {
    const q = String(formData.get("q") ?? "").slice(0, 200);
    const status = String(formData.get("status") ?? "").slice(0, 20);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
  }
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return params.size ? `${path}?${params}` : path;
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
  redirect("/admin/review");
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
  redirect("/admin/review");
}

/**
 * Edit an ad's public text (and, where the form offers it, its category) from
 * the Ads or Digests tab.
 *
 * Editable in EVERY status but deleted (user decision, session 021 — "operator
 * only, but everywhere"). The case that prompted it is a held `unpaid` ad: the
 * seller rings in about the ad they are one card away from running, and their
 * text was the one thing that could not be fixed while they were on the line.
 * `rejected` and `sold` were shut out for no better reason. Nothing here reads
 * the status at all — the page decides what to offer, and this action simply
 * writes what it is given.
 *
 * The seller's own words are never overwritten: `updateAdBody` sets `body`
 * alone, so `originalBody` and the message log keep what they actually sent.
 */
export async function adminEditAd(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  // Same ceiling as the maxChars setting clamp — an admin edit shouldn't be
  // able to balloon a digest.
  const body = String(formData.get("body") ?? "").trim().slice(0, 300);
  if (!Number.isInteger(id)) redirect(backTarget(formData));
  // An emptied box used to write nothing and redirect silently, which looks
  // exactly like a save that worked. Blanking an ad is never what the operator
  // meant — Delete is that — so refuse it out loud instead of no-opping.
  if (!body) redirect(backTarget(formData, { error: "emptybody", id: String(id) }));
  await updateAdBody(id, body);
  // Inline category (item 22): only forms that rendered the select send it
  // (it's hidden pre-9976), so a missing field never clears a category.
  const rawCategory = formData.get("category");
  if (rawCategory !== null) {
    await setAdCategory(id, isCategoryKey(String(rawCategory)) ? String(rawCategory) : null);
  }
  redirect(backTarget(formData, { saved: String(id) }));
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
  redirect("/admin/review");
}

/** Approve a pending town-hall event (item 18): it appears on the homepage
 * sidebar and /town-hall until its date passes, then drops off by itself. */
export async function adminApproveEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await resolveEvent(id, "approved");
  redirect("/admin/review");
}

/** Decline a pending town-hall event — simple by design: listings are FREE
 * in v1, so there is nothing to refund and no strike machinery. */
export async function adminDeclineEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await resolveEvent(id, "declined");
  redirect("/admin/review");
}

/**
 * Approve or decline a featured / premium-listing request (session 019).
 *
 * Approving BOOKS a start day, and the day it books is computed from the same
 * `lib/featured-schedule.ts` arithmetic the public request page quotes — so
 * the date the business was told and the date they actually get are the same
 * number, not two implementations that agree until they don't.
 *
 * `queueAhead` comes from the form because it is a property of where the
 * request sits in the list the operator is looking at. It is re-derived from
 * stored order rather than trusted: a stale page must not let a later request
 * jump the line by carrying a smaller number.
 */
export async function adminDecideFeaturedRequest(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const decision = String(formData.get("decision")) === "approved" ? "approved" : "declined";
  if (!Number.isInteger(id)) redirect("/admin/featured");

  let startDay: string | null = null;
  if (decision === "approved") {
    const pending = await listPendingRequests();
    // Where this request REALLY sits, by submission time — not where the page
    // that was open thought it sat.
    const queueAhead = Math.max(0, pending.findIndex((r) => r.id === id));
    const booked = await listBookedStartDays();
    const today = etParts(new Date()).day;
    startDay = featuredSchedule({ approvedStarts: booked, today, queueAhead }).nextStartDay;
  }

  const outcome = await decideFeaturedRequest(id, decision, startDay);
  if (outcome === "unsupported") redirect("/admin/featured?error=migration9956");
  redirect(
    decision === "approved"
      ? `/admin/featured?saved=booked&day=${startDay}`
      : "/admin/featured?saved=declined",
  );
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

/**
 * Move a member's balance by hand: a cheque arrived, a phone order, a
 * make-good, or money going back out to their card.
 *
 * Since session 019 the form must say WHICH of those it is, because the four
 * are not interchangeable (lib/money.ts): a payment is refundable cash, a
 * courtesy credit never is, and a payout is money leaving. Writing them all as
 * `adjustment` is what made "how much may I refund this person?" unanswerable.
 *
 * The guard that matters: **a payout can never exceed the member's refundable
 * cash.** That is the user's session-019 ask — someone who adds $20, collects
 * the $40 starter credit and asks for their money back gets $20, not $60, and
 * the page refuses rather than relying on the operator to notice.
 */
export async function adminGrantCredits(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  // The form takes DOLLARS (checks, cash, make-goods); the ledger stores
  // cents. Clamp to ±$5,000 so a fat-fingered entry can't mint a fortune.
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

  const kind = ledgerKindFor(String(formData.get("kind") ?? ""), deltaCents);

  if (kind === "payout") {
    // Read the ledger fresh here rather than trusting anything the form
    // carried: this is the money-out check, so it reads the same source the
    // member's own balance does.
    const refundable = refundableCents(await getLedger(phone));
    if (-deltaCents > refundable) {
      redirect(
        `/admin/users?phone=${phone}&error=payout&max=${refundable}`,
      );
    }
  }

  await addLedgerEntry(phone, { delta: deltaCents, kind, note });
  redirect(`/admin/users?phone=${phone}&saved=grant`);
}

/** Which ledger kind the Adjust-balance form asked for. Anything unrecognised
 * falls back to the legacy `adjustment`, which lib/money.ts treats
 * conservatively — an unclassified row can never fund a refund. */
function ledgerKindFor(raw: string, deltaCents: number): LedgerKind {
  if (deltaCents < 0) return raw === "payout" ? "payout" : "adjustment";
  if (raw === "payment") return "payment";
  if (raw === "courtesy") return "courtesy";
  return "adjustment";
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

/**
 * Add words to one of the lists WITHOUT the page ever showing what is already
 * there (session 019, user request).
 *
 * The reason is not squeamishness. The filter list is several hundred obscene
 * words, and the operator opens this page from an ordinary workplace: a
 * corporate web filter or DLP agent watching that browser sees the rendered
 * page, and a screen full of slurs is exactly what those systems escalate on.
 * The words live in the database and there is no reason a routine edit has to
 * put all of them on screen.
 *
 * So this is append-only, and it never echoes the list back — only a count.
 * The full editor is still there behind an explicit click.
 */
export async function adminAddWords(formData: FormData): Promise<void> {
  await requireAdmin();
  const autoReject = String(formData.get("list")) !== "flag";
  const words = parseWordList(String(formData.get("words") ?? ""));
  if (!words.length) redirect("/admin/words?error=nowords");
  for (const word of words) await addWordRule(word, autoReject);
  redirect(`/admin/words?added=${words.length}&list=${autoReject ? "reject" : "flag"}`);
}

/** Remove words by name, same reasoning: you type what goes, and the page
 * never has to show you the rest of the list to do it. */
export async function adminRemoveWords(formData: FormData): Promise<void> {
  await requireAdmin();
  const words = parseWordList(String(formData.get("words") ?? ""));
  if (!words.length) redirect("/admin/words?error=nowords");
  // Count what was actually there, so "removed 3" never means "removed 0 and
  // you misspelled all three".
  const before = new Set((await getWordRules()).map((r) => r.word));
  let removed = 0;
  for (const word of words) {
    if (!before.has(word)) continue;
    await removeWordRule(word);
    removed += 1;
  }
  redirect(`/admin/words?removed=${removed}&asked=${words.length}`);
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
  batchMinAds: 15,
  batchMaxWaitMinutes: 720,
  // An hour of the day, nothing more. Saturday can only ever close EARLIER
  // than the published window (digest-engine clamps it), so the ceiling here
  // just keeps the stored value a real hour.
  smsSaturdayEndHour: 23,
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
  pacedReleaseOver: 500,
  pacedGapMinMinutes: 240,
  pacedGapMaxMinutes: 240,
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
    "batchMinAds",
    "batchMaxWaitMinutes",
    "smsSaturdayEndHour",
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
    "pacedReleaseOver",
    "pacedGapMinMinutes",
    "pacedGapMaxMinutes",
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

/**
 * Test a line-type lookup against one number, from /admin/settings.
 *
 * This exists because the VoIP policy fails open: if the credentials are
 * wrong, every lookup silently returns "allow" and the operator sees exactly
 * what they'd see if no burner had ever signed up. Without a way to prove the
 * check works, a misconfigured deploy would look identical to a working one —
 * possibly for months. This is the proof.
 *
 * Deliberately does NOT cache what it finds: it is a diagnostic, and a
 * number the operator typed to test the wiring shouldn't quietly become that
 * member's stored line type.
 */
export interface LookupTestResult {
  phone: string;
  type: LineType;
  reason?: string;
  status?: number;
  carrier?: string;
}

/**
 * Returns its result instead of redirecting, so the tester can render inline.
 *
 * It used to redirect back to /admin/settings with the answer in the query
 * string, which meant every check was a full navigation — and the page jumped
 * back to the top, away from the tool and the answer, every single time. A
 * diagnostic you run repeatedly must not move the page out from under you.
 */
export async function adminTestLookup(
  _prev: LookupTestResult | null,
  formData: FormData,
): Promise<LookupTestResult> {
  await requireAdmin();
  const raw = String(formData.get("testPhone") ?? "");
  const phone = normalizePhone(raw);
  if (!phone) return { phone: raw, type: "unchecked", reason: "bad-number" };
  const outcome = await lookupLineTypeDetailed(phone);
  return {
    phone,
    type: outcome.type,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.status ? { status: outcome.status } : {}),
    ...(outcome.carrier ? { carrier: outcome.carrier } : {}),
  };
}

/**
 * Preview or run a member purge (/admin/purge).
 *
 * Two-step by construction: the first submit is always a dry run, and only a
 * form carrying BOTH the exact phone it previewed and the typed word DELETE
 * performs the deletion. That makes the destructive path impossible to reach
 * by accident — a stray double-submit re-previews, it does not delete.
 */
export interface PurgeState {
  phone: string;
  counts?: PurgeCounts;
  unsupported?: boolean;
  notFound?: boolean;
  deleted?: boolean;
  error?: string;
}

export async function adminPurgeMember(
  _prev: PurgeState | null,
  formData: FormData,
): Promise<PurgeState> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) return { phone: "", error: "That isn't a 10-digit number." };

  // The delete only happens when the operator typed DELETE **and** the
  // confirmation is for the same number that was previewed — so editing the
  // number after previewing drops back to a fresh preview rather than
  // purging whoever is now in the box.
  const confirmed =
    String(formData.get("confirm") ?? "").trim().toUpperCase() === "DELETE" &&
    normalizePhone(String(formData.get("previewedPhone") ?? "")) === phone;

  const result = await purgeMember(phone, !confirmed);
  if (result === "unsupported") return { phone, unsupported: true };
  if (!result.found) return { phone, notFound: true };
  return { phone, counts: result, deleted: Boolean(result.deleted) };
}

/**
 * Schedule an ADMIN BROADCAST — the operator's own message to every SMS
 * subscriber (session 020; migration 9952).
 *
 * The time typed is LOCAL to the operator (America/New_York, like every other
 * hour in this service) and is a FLOOR, not an appointment: the send window
 * decides the real moment, so scheduling into a Sunday means Monday morning
 * rather than a message that quietly never goes.
 */
export async function adminScheduleMessage(formData: FormData): Promise<void> {
  await requireAdmin();
  const body = normalizeAdminMessage(String(formData.get("body") ?? ""));
  if (!body) redirect("/admin/digests?msgerror=empty");
  // datetime-local gives "2026-08-21T14:30" with no zone. Read it as ET, which
  // is what the operator meant and what every other hour in this service is.
  const typed = String(formData.get("sendAfter") ?? "").trim();
  const sendAfter = typed ? etLocalToIso(typed) : new Date().toISOString();
  if (!sendAfter) redirect("/admin/digests?msgerror=when");
  const id = await createAdminMessage(body, sendAfter);
  redirect(id ? `/admin/digests?msgqueued=${id}` : "/admin/digests?msgerror=unsupported");
}

/** Cancel a scheduled broadcast that has not gone out yet. */
export async function adminCancelMessage(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await cancelAdminMessage(id);
  redirect("/admin/digests?msgcanceled=1");
}

/**
 * "2026-08-21T14:30" typed by an operator in Ohio -> the matching UTC instant.
 *
 * Done by probing rather than by hardcoding -4/-5: the offset depends on the
 * DATE, and a hardcoded one is how a scheduled message lands an hour out for
 * half the year. Parse as UTC, ask what that instant reads as in ET, and shift
 * by the difference.
 */
function etLocalToIso(local: string): string | null {
  // Validate the SHAPE first. Date.parse is lenient enough to turn junk into a
  // real date — "nonsense:00Z" parsed to the year 2000 — which would schedule a
  // broadcast to the distant past and send it on the very next cron tick.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asUtc = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(asUtc)) return null;
  const shown = new Date(asUtc).toLocaleString("en-US", { timeZone: "America/New_York" });
  const offsetMs = asUtc - Date.parse(`${shown} UTC`);
  return new Date(asUtc + offsetMs).toISOString();
}

/** Mark a help report dealt with, or reopen it. */
export async function adminResolveHelpReport(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const resolved = String(formData.get("resolved")) === "yes";
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (Number.isInteger(id)) await resolveHelpReport(id, note, resolved);
  redirect(`/admin/help-reports${formData.get("all") === "1" ? "?all=1" : ""}`);
}

/**
 * Archive or restore a member (user request, session 016).
 *
 * The reversible half of the pair. Deliberately NOT confirmed with a typed
 * word the way purging is: the whole reason archive exists is that it can be
 * undone, so making it feel as heavy as a delete would push people toward
 * the delete instead.
 */
export async function adminSetArchived(formData: FormData): Promise<void> {
  await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) redirect("/admin/users");
  const archived = String(formData.get("archived")) === "yes";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const result = await setMemberArchived(phone, archived, reason);
  if (result === "unsupported") {
    redirect(`/admin/users?phone=${phone}&error=migration9964`);
  }
  redirect(`/admin/users?phone=${phone}&saved=${archived ? "archived" : "restored"}`);
}

/**
 * Save the current members-table layout under a name (feature 41).
 *
 * Scoped to the operator's own phone, so two people using the admin don't
 * overwrite each other's layouts. Everything is re-parsed through the column
 * catalogue on the way in — a saved view is read back later and turned into a
 * query, so it must not be able to store a column name nothing recognises.
 */
export async function adminSaveUserView(formData: FormData): Promise<void> {
  await requireAdmin();
  const session = await readSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const back = String(formData.get("cols") ?? "");
  const columns = validColumns(back ? back.split(",") : undefined);

  // Filters arrive as JSON, not the old comma-joined "col:value" string: a
  // filter value containing a comma silently split into two broken filters.
  // Every entry still goes back through parseFilter, so nothing unrecognised
  // can be stored — a saved view is read back later and turned into a query.
  let filters: Filter[] = [];
  try {
    const raw = JSON.parse(String(formData.get("filters") ?? "[]")) as unknown;
    if (Array.isArray(raw)) {
      filters = raw
        .map((f) => parseFilter((f ?? {}) as Partial<Filter>))
        .filter((f): f is Filter => f !== null);
    }
  } catch {
    /* an unreadable filter payload saves the layout without filters */
  }

  const backTo = `/admin/users/table?${new URLSearchParams({
    cols: columns.join(","),
    ...filterParams(filters),
  })}`;
  if (!session || !name) redirect(backTo);

  const sort = parseSort(formData.get("sort"), formData.get("dir"));

  // Widths come from the operator's own browser (the grid stores them there),
  // so treat the payload as untrusted: parseWidths keeps only real columns and
  // clamps every value to a sane pixel range.
  let widths: Record<string, number> = {};
  try {
    const raw = String(formData.get("widths") ?? "");
    if (raw) widths = parseWidths(JSON.parse(raw));
  } catch {
    /* unreadable widths just mean the layout opens at its default sizes */
  }

  const result = await saveView(session.phone, name, {
    columns,
    filters,
    sortColumn: sort.column,
    sortAscending: sort.ascending,
    widths,
  });
  if (result === "unsupported") redirect("/admin/users/table?error=migration9962");
  redirect(backTo);
}

/** Delete one of the operator's own saved views. */
export async function adminDeleteUserView(formData: FormData): Promise<void> {
  await requireAdmin();
  const session = await readSession();
  const id = Number(formData.get("id"));
  const cols = validColumns(String(formData.get("cols") ?? "").split(",")).join(",");
  if (session && Number.isInteger(id)) await deleteView(session.phone, id);
  // Back to the layout they were looking at, not a reset one — deleting a
  // saved view shouldn't also throw away the columns on screen.
  redirect(`/admin/users/table?cols=${encodeURIComponent(cols)}`);
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

  // Announce or stay quiet (user decision, session 016). The notice used to
  // be automatic, which is right for an OUTAGE and wrong for everything else:
  // pausing ads before launch, or for an evening, would have texted every
  // subscriber that the service is in technical trouble when it plainly
  // isn't. The form asks; "announce" has to be chosen explicitly, so a pause
  // is silent unless you say otherwise.
  if (formData.get("announce") !== "yes") {
    redirect("/admin/settings?saved=pause&notice=silent");
  }

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

/**
 * Turn TEST MODE on or off (session 021).
 *
 * The EXPIRY IS STAMPED HERE, at the moment the switch goes on, rather than
 * being a duration checked against some later "when did this start" guess.
 * That is what makes the auto-off real: the deadline is a fact written down
 * beside the flag, so nothing has to remember to compute it, and a switch left
 * on simply stops being in force. Every flip-on re-stamps it, so a genuinely
 * long bench session is a second click rather than an indefinite blackout.
 *
 * Turning it OFF clears the deadline too — leaving a stale future timestamp
 * behind would make the next flip-on look like it had hours left when it does
 * not.
 */
export async function adminSetTestMode(formData: FormData): Promise<void> {
  await requireAdmin();
  const on = String(formData.get("on")) === "yes";
  await saveEngineSettings({
    testMode: on,
    testModeExpiresAt: on ? testModeExpiry(Date.now()) : "",
  });
  redirect(`/admin/settings?saved=${on ? "test-on" : "test-off"}`);
}

/**
 * Save the test-number list. Stored as the operator typed it; parseTestNumbers
 * is what decides which entries are usable, and the Settings page shows that
 * verdict back so a typo is visible immediately rather than at send time.
 */
export async function adminSaveTestNumbers(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = String(formData.get("numbers") ?? "").trim();
  // Re-serialize from the parse so what is stored is what will actually be
  // used — an entry that did not survive parsing must not sit in the box
  // looking like it is configured.
  await saveEngineSettings({ testNumbers: parseTestNumbers(raw).join(",") });
  redirect("/admin/settings?saved=test-numbers");
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
  // Four slots since session 019 — 1-2 render in the homepage's left column,
  // 3-4 in the right. Anything else falls back to 1 rather than being stored.
  const rawSlot = Number(formData.get("slot"));
  const slot = rawSlot >= 1 && rawSlot <= 4 ? Math.trunc(rawSlot) : 1;
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
