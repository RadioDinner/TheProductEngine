/**
 * COLLECTING FOR AN AD (session 023).
 *
 * lib/ad-funding.ts holds the arithmetic; this is the part that touches money.
 * Two moments matter and they are deliberately far apart:
 *
 *   posting  — quote a price, reserve it, charge nothing.
 *   the run  — the batch that carries the ad collects for it.
 *
 * The user's sentence is the specification: *"when people create an ad, and
 * have a card on file, I want the confirmation message to include that the
 * card won't be charged until the ad is run. Make the system honor the truth
 * of this message."*
 *
 * ### Why this file is separate from lib/engine.ts
 *
 * The collection runs from lib/digest-engine.ts, and digest-engine cannot
 * import the engine — the engine imports IT. Everything the batch needs to
 * take money lives here, where both can reach it. It also means the whole
 * money path is one file to read.
 *
 * ### The concurrency guard: claim, charge, settle
 *
 * An ad being collected for is in a THIRD state, not just "owing" or "paid",
 * and that is what `charge_claimed_at` is for. `claimAdCharge` stamps it and
 * reports whether THIS caller got it; the price stays on the ad throughout.
 * Only the winner collects, and a second pass reading mid-collection sees an
 * ad that still owes money, loses the claim, and leaves it alone.
 *
 * ⚠️ The two-state version of this was a real bug and is worth remembering.
 * Clearing `owed_cents` at claim time made "nothing owing" mean BOTH "already
 * paid for, run it free" and "being charged for this second" — so a cron tick
 * that read an ad while an approval-triggered send was inside its Stripe call
 * carried it to the whole subscriber list as a freebie, and the losing pass's
 * undo then found `broadcast_at` set and silently dropped the debt. Never
 * collapse those two states again.
 *
 * `settleAdCharge` clears the debt AFTER the money moves. That ordering is a
 * deliberate trade: a crash between the debit and the settle leaves the debt
 * standing and, an hour later, another pass may charge again — but that window
 * is a local database write immediately after another local database write.
 * The window it replaces was a live card charge over the internet.
 *
 * ⚠️ The residual risk, stated plainly: if a card charge SUCCEEDS at Stripe and
 * the response is lost in flight, we read it as a decline, hand the claim back
 * and try again later — and the member is charged twice, with the extra sitting
 * on their balance as credit rather than being lost. This is the same exposure
 * the posting-time charge has always had (lib/payments.ts mints a fresh
 * idempotency ref per attempt on purpose, so that a genuine retry after a
 * genuine decline really does retry). It is not made worse here, and the fix —
 * a per-attempt reference stored on the ad — is worth doing the day anyone sees
 * it happen.
 */
import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import {
  admitHeldAd,
  claimAdCharge,
  clearChargeHolds,
  getAdsOwed,
  holdAdCharge,
  listOwedAds,
  logMessage,
  owedPricesSupported,
  releaseAdCharge,
  settleAdCharge,
  type OwedAd,
  type StoredAd,
} from "@/lib/engine-store";
import {
  ensureAccount,
  getAutoTopUp,
  getCreditBalance,
  spendCredits,
  type Account,
} from "@/lib/store";
import { autoTopUpShortfall, resolveStripeCustomer } from "@/lib/payments";
import { availableCents, runChargePlan, unfundedAdCount } from "@/lib/ad-funding";
import { formatPrice, site } from "@/lib/config";
import { getEngineSettings, type EngineSettings } from "@/lib/settings";
import { messageBook } from "@/lib/messages";
import { dispatchSms } from "@/lib/outbound";

/**
 * Is there a card we could charge when this member's ad runs?
 *
 * Both halves matter. `getAutoTopUp` is the member's standing authorization —
 * the sentence the card line reads out before it takes any digits — and
 * `resolveStripeCustomer` is whether a card actually exists, adopting one
 * saved on the phone line if the account has not met it yet.
 *
 * Best-effort by contract. Anything that goes wrong reads as "no card", which
 * costs the seller a slightly over-cautious confirmation text and never a lost
 * ad: the collection at the run asks again, with the same function.
 */
export async function cardOnFile(phone: string, account: Account | null): Promise<boolean> {
  try {
    if (!(await getAutoTopUp(phone))) return false;
    return Boolean(await resolveStripeCustomer(phone, account?.stripeCustomerId));
  } catch (e) {
    console.error(`[ad-billing] card check failed for ${phone}:`, e);
    return false;
  }
}

export interface MemberFunding {
  balanceCents: number;
  /** Cents promised to ads that haven't run. */
  reservedCents: number;
  /** Spare credit: balance minus reservations, never below zero. */
  availableCents: number;
  owedAds: OwedAd[];
  /** How many of those ads the member cannot currently pay for. */
  awaitingPayment: number;
  hasCard: boolean;
}

/** Everything a posting decision needs about a member's money, in two reads. */
export async function memberFunding(
  phone: string,
  account: Account | null,
): Promise<MemberFunding> {
  const [balanceCents, owedAds, hasCard] = await Promise.all([
    getCreditBalance(phone),
    listOwedAds(phone).catch((e) => {
      console.error(`[ad-billing] reading owed ads for ${phone} failed:`, e);
      return [] as OwedAd[];
    }),
    cardOnFile(phone, account),
  ]);
  const reservedCents = owedAds.reduce((sum, a) => sum + a.owedCents, 0);
  return {
    balanceCents,
    reservedCents,
    availableCents: availableCents(balanceCents, reservedCents),
    owedAds,
    awaitingPayment: unfundedAdCount(
      owedAds.map((a) => a.owedCents),
      balanceCents,
      hasCard,
    ),
    hasCard,
  };
}

export type CollectFailure =
  /** Somebody else is collecting for this ad right now, or already has. */
  | { ok: false; reason: "claimed" }
  /** No credit and no card — the ad waits for money. */
  | { ok: false; reason: "no-money"; balanceCents: number; owedCents: number }
  /** A card was tried and refused. */
  | { ok: false; reason: "declined"; balanceCents: number; owedCents: number; declineReason: string };

export type CollectResult =
  | { ok: true; chargedCents: number; cardCents: number; last4?: string; balanceAfter: number }
  | CollectFailure;

/**
 * Take the money for one ad that is about to go out.
 *
 * Ad credit first, the saved card for whatever is short — the order members
 * expect and the one the price sheet describes. The ledger note keeps the
 * `Ad #<id> (<kind>)` shape because the refund matchers in lib/myads.ts find a
 * charge by that exact delimited token; changing it would make every refund
 * path blind.
 */
export async function collectForAd(args: {
  phone: string;
  adId: number;
  owedCents: number;
  kind: "text" | "picture";
  account?: Account | null;
}): Promise<CollectResult> {
  const { phone, adId, owedCents } = args;
  // The claim is inside its own guard: an unclassified database error here
  // would otherwise escape collectForBatch, take down the whole cron tick, and
  // with it the outbox drain that delivers everything already composed. A
  // failed claim reads as "somebody else has it", which costs this ad one
  // batch and nothing else.
  let claimed = false;
  try {
    claimed = await claimAdCharge(adId, owedCents);
  } catch (e) {
    console.error(`[ad-billing] claiming ad #${adId} failed:`, e);
  }
  if (!claimed) return { ok: false, reason: "claimed" };
  const undo = async () => {
    await releaseAdCharge(adId).catch((e) =>
      console.error(`[ad-billing] could not release the claim on ad #${adId}:`, e),
    );
  };
  try {
    const account = args.account ?? (await ensureAccount(phone));
    let balance = await getCreditBalance(phone);
    const hasCard = await cardOnFile(phone, account);
    const plan = runChargePlan({ owedCents, balanceCents: balance, hasCard });
    if (plan.blocked) {
      await undo();
      return { ok: false, reason: "no-money", balanceCents: balance, owedCents };
    }
    let cardCents = 0;
    let last4: string | undefined;
    if (plan.fromCardCents > 0) {
      const customerId = await resolveStripeCustomer(phone, account.stripeCustomerId);
      if (!customerId) {
        await undo();
        return { ok: false, reason: "no-money", balanceCents: balance, owedCents };
      }
      const topUp = await autoTopUpShortfall({
        phone,
        customerId,
        shortfallCents: plan.fromCardCents,
      });
      if (!topUp.ok) {
        afterResponse(() =>
          analytics.autoTopUp({ phone, amountCents: plan.fromCardCents, outcome: "declined" }),
        );
        await undo();
        return {
          ok: false,
          reason: "declined",
          balanceCents: balance,
          owedCents,
          declineReason: topUp.reason,
        };
      }
      cardCents = topUp.chargedCents;
      last4 = topUp.last4;
      balance += cardCents;
      afterResponse(() =>
        analytics.autoTopUp({ phone, amountCents: cardCents, outcome: "charged" }),
      );
    }
    const spent = await spendCredits(phone, owedCents, `Ad #${adId} (${args.kind})`);
    if (!spent) {
      // The balance moved under us between the read and the debit. The card
      // money (if any) stays on the account — it is theirs — and the ad still
      // owes, so the next batch tries again against the new balance.
      await undo();
      return { ok: false, reason: "no-money", balanceCents: await getCreditBalance(phone), owedCents };
    }
    // Paid. Clear the debt and the claim together. If THIS fails the money is
    // gone and the ad still owes, so it is the one place worth shouting about:
    // an hour from now the staleness window opens and another pass could
    // charge again.
    try {
      await settleAdCharge(adId);
    } catch (e) {
      console.error(
        `[ad-billing] ⚠️ ad #${adId} WAS CHARGED ${owedCents} BUT ITS DEBT COULD NOT BE CLEARED — ` +
          `clear ads.owed_cents for it by hand before the claim goes stale:`,
        e,
      );
    }
    return {
      ok: true,
      chargedCents: owedCents,
      cardCents,
      ...(last4 && { last4 }),
      balanceAfter: Math.max(0, balance - owedCents),
    };
  } catch (e) {
    console.error(`[ad-billing] collecting for ad #${adId} failed:`, e);
    await undo();
    return { ok: false, reason: "no-money", balanceCents: 0, owedCents };
  }
}

/** How long a failed collection keeps an ad out of batch selection. Long
 * enough that a declined card isn't presented again every five minutes; short
 * enough that money added this afternoon runs the ad this afternoon — and any
 * payment clears the hold immediately anyway (releaseHeldAds). */
function backoffUntil(settings: EngineSettings, now: Date): string {
  const hours = Math.max(1, Math.round(settings.chargeRetryHours || 6));
  return new Date(now.getTime() + hours * 3600_000).toISOString();
}

export interface BatchCollection {
  /** Ads that are paid for and may go out. */
  payable: StoredAd[];
  /** Ads that could not be collected for, with what to tell the seller. */
  unpaid: { ad: StoredAd; result: CollectFailure }[];
  /**
   * Another pass is collecting for at least one of these ads right now.
   *
   * The caller should abandon the whole batch on a true. Two passes that see
   * the same queue would otherwise compose two different batches — the loser
   * carrying whatever the winner did not claim — and every ad with nothing
   * owing (an operator's re-run, an ad from before the quoted prices existed)
   * would be in both, so subscribers would get it twice.
   */
  contended: boolean;
}

/**
 * Collect for every ad about to ride a batch, and report which ones may go.
 *
 * Called from the composer BEFORE any message is built, so an ad we cannot
 * collect for never reaches a subscriber's phone. An ad that fails keeps its
 * place: `broadcast_at` stays null, the debt goes back on it, and it is held
 * out of selection for a few hours rather than being rejected or re-reviewed.
 *
 * Ads with nothing owing pass straight through. That covers everything that is
 * meant to run for free — an operator's re-run of an ad that already went out,
 * a catch-up to a new subscriber, and every ad posted before migration 9950.
 */
export async function collectForBatch(
  items: StoredAd[],
  now = new Date(),
): Promise<BatchCollection> {
  const payable: StoredAd[] = [];
  const unpaid: { ad: StoredAd; result: CollectFailure }[] = [];
  let contended = false;
  if (!items.length) return { payable, unpaid, contended };
  // ⚠️ NO QUOTE COLUMN, NO SENDING. Without ads.owed_cents nothing was quoted,
  // nothing is reserved and nothing can be collected — and since the code
  // stopped charging at posting time, sending anyway would run every ad on the
  // service for free, silently, until somebody noticed the money had stopped.
  // An ad that waits is recoverable by pasting one migration; an ad that has
  // already gone out for nothing is not. /api/health names this by name.
  if (!(await owedPricesSupported())) {
    console.error(
      "[ad-billing] ⚠️ ads.owed_cents is missing (migration 9950) — NOT SENDING. " +
        "Nothing can be collected for, so sending would run every ad free. Paste 9950.",
    );
    return { payable, unpaid, contended };
  }
  let owed: Map<number, number>;
  try {
    owed = await getAdsOwed(items.map((a) => a.id));
  } catch (e) {
    // A transient read failure, not a missing column (that is handled above).
    // Send the batch: a member's paid-for ad going out uncharged is a smaller
    // failure than the service going quiet, and the debt stays on the ad to be
    // collected the next time it is selected.
    console.error("[ad-billing] could not read what the batch owes; sending uncollected:", e);
    return { payable: items, unpaid, contended };
  }
  if (!owed.size) return { payable: items, unpaid, contended };
  let settings: EngineSettings;
  try {
    settings = await getEngineSettings();
  } catch (e) {
    console.error("[ad-billing] settings unreadable; sending the batch uncollected:", e);
    return { payable: items, unpaid, contended };
  }
  for (const ad of items) {
    const cents = owed.get(ad.id) ?? 0;
    if (cents <= 0) {
      payable.push(ad);
      continue;
    }
    const result = await collectForAd({
      phone: ad.ownerPhone,
      adId: ad.id,
      owedCents: cents,
      kind: ad.photo ? "picture" : "text",
    });
    if (result.ok) {
      payable.push(ad);
      if (settings.adRanReceipt) {
        await tellSellerItRan(ad, result, settings).catch((e) =>
          console.error(`[ad-billing] receipt for ad #${ad.id} failed:`, e),
        );
      }
      continue;
    }
    if (result.reason === "claimed") {
      // Another pass owns this ad's money and is composing a batch around it.
      // Say so: the caller abandons this batch rather than composing a second
      // one out of the leftovers. See BatchCollection.contended.
      contended = true;
      continue;
    }
    unpaid.push({ ad, result });
    await holdAdCharge(ad.id, backoffUntil(settings, now)).catch((e: unknown) =>
      console.error(`[ad-billing] could not back off ad #${ad.id}:`, e),
    );
    await tellSellerItCouldNotBePaid(ad, result).catch((e) =>
      console.error(`[ad-billing] notice for ad #${ad.id} failed:`, e),
    );
  }
  return { payable, unpaid, contended };
}

/** The receipt: sent as the ad goes out, which is the moment money moves. It
 * is what makes "nothing is charged until it runs" something a member can
 * check rather than something we say. */
async function tellSellerItRan(
  ad: StoredAd,
  result: { chargedCents: number; cardCents: number; last4?: string; balanceAfter: number },
  _settings: EngineSettings,
): Promise<void> {
  const book = await messageBook();
  const chargeNote =
    result.cardCents > 0
      ? `${formatPrice(result.chargedCents)} was charged to your card${result.last4 ? ` ending ${result.last4}` : ""}.`
      : `${formatPrice(result.chargedCents)} came off your ad credit — ${formatPrice(result.balanceAfter)} left.`;
  const body = book.render("ad.ran", {
    adId: ad.id,
    price: formatPrice(result.chargedCents),
    left: formatPrice(result.balanceAfter),
    siteUrl: site.webHost,
    title: ad.body.slice(0, 60),
    chargeNote,
  });
  await notify(ad.ownerPhone, body);
}

async function tellSellerItCouldNotBePaid(ad: StoredAd, result: CollectFailure): Promise<void> {
  if (result.reason === "claimed") return;
  const book = await messageBook();
  const body = book.render("ad.charge-failed", {
    adId: ad.id,
    price: formatPrice(result.owedCents),
    balance: formatPrice(result.balanceCents),
    supportPhone: site.supportPhone,
    siteUrl: site.webHost,
    cardNote: result.reason === "declined" ? ` (${result.declineReason})` : "",
  });
  await notify(ad.ownerPhone, body);
}

/** Seller notices ride the "reply" class: a full pause suppresses them, a
 * partial one lets them through, and only what actually went out is logged. */
async function notify(phone: string, body: string): Promise<void> {
  if (!body.trim()) return;
  const { sent } = await dispatchSms(phone, body, { cls: "reply" });
  if (sent) await logMessage({ direction: "outbound", channel: "sms", address: phone, body });
}

export interface ReleaseResult {
  /** Held ads admitted into the review queue. */
  admitted: number[];
  /** Approved ads whose failed-collection back-off was lifted. */
  unheld: number[];
}

/**
 * The "your money landed, your ads can move" text, worded from the catalogue.
 *
 * Composed here rather than at the two call sites (the card line and the
 * Stripe webhook) so both say the same thing — they were two hand-written
 * copies of one sentence, and they had already drifted apart on whether an ad
 * was "paid for" or merely covered. Returns "" when there is nothing to say.
 */
export async function releasedAdsMessage(
  freed: number[],
  /** Ads that went back into the REVIEW queue rather than back into the send
   * queue. They still need a yes from the operator, so promising the next
   * batch would be a promise the service cannot keep. */
  needReview: number[] = [],
): Promise<string> {
  if (!freed.length) return "";
  const book = await messageBook();
  const allNeedReview = freed.every((id) => needReview.includes(id));
  const someNeedReview = freed.some((id) => needReview.includes(id));
  return book.render("ad.funded", {
    adIds: freed.map((id) => `#${id}`).join(", "),
    plural: freed.length === 1 ? "" : "s",
    isAre: freed.length === 1 ? "is" : "are",
    next: allNeedReview
      ? "will go out as soon as we've read " + (freed.length === 1 ? "it" : "them")
      : someNeedReview
        ? "will go out once approved"
        : "will go out with the next batch",
  });
}

/**
 * Money arrived — a card saved on the phone line, a top-up on the website — so
 * let everything that was waiting on it move again.
 *
 * This replaces releaseUnpaidAds and no longer charges anything, because since
 * session 023 an ad is collected for when it runs. Two things happen:
 * held ads are admitted into the review queue keeping the price they were
 * quoted, and approved ads that a failed collection had backed off are
 * released to ride the next batch.
 *
 * Best-effort by contract, exactly as its predecessor was: it never throws at
 * its callers, because both of them are doing something that must not fail —
 * answering a live phone call, and completing a checkout.
 */
export async function releaseHeldAds(phone: string): Promise<ReleaseResult> {
  const admitted: number[] = [];
  const unheld: number[] = [];
  try {
    const owedAds = await listOwedAds(phone);
    for (const ad of owedAds) {
      if (ad.status === "unpaid") {
        if (await admitHeldAd(ad.id, ad.owedCents)) admitted.push(ad.id);
      } else if (ad.heldUntil && Date.parse(ad.heldUntil) > Date.now()) {
        unheld.push(ad.id);
      }
    }
    // Legacy held ads (posted before 9951, so carrying no owed price) still
    // have to be let in — listOwedAds cannot see them.
    for (const legacy of await legacyHeldAds(phone)) {
      if (admitted.includes(legacy.id)) continue;
      if (await admitHeldAd(legacy.id, legacy.costCents)) admitted.push(legacy.id);
    }
    if (unheld.length) await clearChargeHolds(unheld);
    // An admitted ad is fresh supply: it has cleared the money gate and is on
    // its way to review. Counting it at the hold would have inflated the one
    // number the roadmap gets argued from.
    for (const id of admitted) {
      afterResponse(() =>
        analytics.postSubmitted({ phone, channel: "sms", photoCount: 0, priceCents: 0 }),
      );
      void id;
    }
  } catch (e) {
    console.error(`[ad-billing] releasing waiting ads for ${phone} failed:`, e);
  }
  return { admitted, unheld };
}

/** Held ads from before migration 9950, which carry unpaid_cents rather than
 * owed_cents. One extra read, only on the paths where money just landed. */
async function legacyHeldAds(phone: string): Promise<{ id: number; costCents: number }[]> {
  const { listUnpaidAds } = await import("@/lib/engine-store");
  try {
    return await listUnpaidAds(phone);
  } catch (e) {
    console.error(`[ad-billing] legacy held-ad read failed for ${phone}:`, e);
    return [];
  }
}
