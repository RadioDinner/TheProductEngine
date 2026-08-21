/**
 * Review-queue actions (spec Q4/Q8/Q10): approve with optional edit; reject
 * as benign (full refund) or violation (charge kept, strike recorded, ban at
 * three). The admin portal is UI over these functions; the dev simulator
 * calls them directly.
 */
import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import {
  approveAdRecord,
  getAdRecord,
  getAdsOwed,
  logMessage,
  rejectAdRecord,
  setAdCategory,
} from "@/lib/engine-store";
import {
  OFFENSE_BAN_THRESHOLD,
  addLedgerEntry,
  ensureAccount,
  getLedger,
  recordOffense,
} from "@/lib/store";
import { memberFunding } from "@/lib/ad-billing";
import { purseForAd, shortfallCents } from "@/lib/ad-funding";
import { messageBook } from "@/lib/messages";
import { site } from "@/lib/config";
import { getEngineSettings } from "@/lib/settings";
import {
  batchWaitLabel,
  closedEarly,
  drainDigestOutbox,
  hourLabel,
  nextSendLabel,
  runQueuedBroadcasts,
  smsWindowOpen,
} from "@/lib/digest-engine";
import { dispatchSms } from "@/lib/outbound";
import { adRefundableTotal, findAdCharge, legacyPassRefundCents } from "@/lib/myads";
import { formatPrice } from "@/lib/config";

async function notify(phone: string, body: string): Promise<void> {
  // "reply" class: a FULL pause suppresses these seller notices, a PARTIAL
  // pause lets them through; blocklist/throttle apply. Only log what went out.
  const { sent } = await dispatchSms(phone, body, { cls: "reply" });
  if (sent) await logMessage({ direction: "outbound", channel: "sms", address: phone, body });
}

/** Minutes an ad waited in the review queue. The operator controls this
 * number directly, and it shapes the seller's whole experience of the
 * service — a figure worth watching as a median, never a mean: one ad
 * approved after a weekend away drags an average badly. */
function waitMinutes(createdAt: string, now: number): number {
  const ms = now - Date.parse(createdAt);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
}

export async function approveAd(
  id: number,
  editedBody?: string,
  category?: string | null,
): Promise<void> {
  const ad = await getAdRecord(id);
  if (!ad || ad.status !== "pending") return;
  const settings = await getEngineSettings();
  await approveAdRecord(id, editedBody, settings.expiryDays);
  // Category assignment (item 22) is best-effort and SEPARATE from approval:
  // a category problem must never wedge a paid ad in pending. undefined =
  // the caller had no dropdown (SMS simulator, pre-9976 admin) — leave as-is;
  // null = the operator explicitly chose Uncategorized (rides every digest).
  if (category !== undefined) {
    try {
      await setAdCategory(id, category);
    } catch (e) {
      console.error(`[moderation] category not saved for ad #${id}:`, e);
    }
  }
  // Batched send (session 018, user decision — replacing session 016's
  // one-text-per-ad): approving adds the ad to the waiting queue and then
  // asks whether a batch is due. It usually is not, and that is the point:
  // the batch goes when enough ads are ready or the oldest has waited long
  // enough. The same pass is what empties the overnight and Sunday queue on
  // the first tick of the morning.
  const now = new Date();
  afterResponse(() =>
    analytics.listingApproved({
      phone: ad.ownerPhone,
      category: category ?? undefined,
      channel: "sms",
      waitMinutes: waitMinutes(ad.createdAt, now.getTime()),
      photoCount: ad.photo ? 1 : 0,
    }),
  );
  const open = smsWindowOpen(now, settings);
  const book = await messageBook();

  // APPROVED BUT NOT PAID FOR (user request, session 023: "I approved the ad,
  // but it wasn't paid, I want the status to go to 'approved, pending payment'
  // but I want the message that the seller gets, to remind them to pay up").
  //
  // Since session 023 an ad is collected for when it runs, so an unfunded ad
  // is reviewed like any other and keeps its place in the queue once approved
  // — it simply doesn't ride a batch until the money is there. Telling the
  // seller "it goes out within the hour" when it cannot is the specific thing
  // the user hit, so the money is checked here and the approval text says which
  // of the two situations they are in.
  const owed = (await getAdsOwed([id]).catch(() => new Map<number, number>())).get(id) ?? 0;
  if (owed > 0) {
    const funding = await memberFunding(ad.ownerPhone, await ensureAccount(ad.ownerPhone));
    // Measured against what is left for THIS ad once the ads ahead of it in
    // the queue have taken their share — not against the raw balance. A member
    // with $20 and two $20 ads must not be told both of them are on their way;
    // the second one is waiting for money and this is where they find out.
    const purse = purseForAd(funding.owedAds, id, funding.balanceCents);
    const short = shortfallCents(owed, purse);
    if (short > 0 && !funding.hasCard) {
      await notify(
        ad.ownerPhone,
        book.render("ad.approved.awaiting-payment", {
          adId: id,
          price: formatPrice(owed),
          // Same scale as {short}: what is left for THIS ad, not the raw
          // balance their other waiting ads have already spoken for.
          spare: formatPrice(purse),
          balance: formatPrice(funding.balanceCents),
          short: formatPrice(short),
          supportPhone: site.supportPhone,
          siteUrl: site.webHost,
        }),
      );
      // No broadcast attempt: the batch would only decline it and text them a
      // second time about the same money.
      return;
    }
  }

  // The hours are recited only when they EXPLAIN the wait. Inside Saturday's
  // unpublished early close they would contradict it ("goes out Monday — we
  // text until 6pm, Mon-Sat", sent at half five on a Saturday), so that hour
  // gets the same message minus the clause: still true, still useful, and it
  // doesn't announce the shortening. See closedEarly in lib/digest-engine.ts.
  const hoursClause = closedEarly(now, settings)
    ? ""
    : ` — texts only go out between ${hourLabel(settings.smsWindowStartHour)} and ${hourLabel(settings.smsWindowEndHour)}, Monday through Saturday`;
  await notify(
    ad.ownerPhone,
    open
      ? book.render("ad.approved", { adId: id, batchWait: batchWaitLabel(settings) })
      : book.render("ad.approved.closed", {
          adId: id,
          nextSend: nextSendLabel(now, settings),
          hoursClause,
        }),
  );
  if (!open) return;
  try {
    await runQueuedBroadcasts(now);
    // Enqueueing is not sending: spend a bounded slice here so "approved"
    // really does mean "on its way", then let the cron drain the rest.
    await drainDigestOutbox({ timeBudgetMs: 10_000, newlyEnqueued: true });
  } catch (e) {
    // A broadcast problem must never leave the ad stuck unapproved — it is
    // already approved and queued, and the next cron tick will send it.
    console.error(`[moderation] instant broadcast for ad #${id} failed:`, e);
  }
}

export async function rejectAd(
  id: number,
  reason: string,
  kind: "benign" | "violation",
): Promise<void> {
  const ad = await getAdRecord(id);
  if (!ad || ad.status !== "pending") return;
  // Only proceed (refund/strike/notify) if THIS call actually transitioned the
  // ad — otherwise a concurrent double-submit would refund or strike twice.
  const transitioned = await rejectAdRecord(id, reason, kind);
  if (!transitioned) return;
  // Only past the transition guard: a concurrent double-submit must not
  // report two rejections for one ad. `kind` is the code, never the
  // operator's typed reason — that is free text about a member's ad.
  afterResponse(() =>
    analytics.listingRejected({ phone: ad.ownerPhone, channel: "sms", reason: kind }),
  );
  const book = await messageBook();

  if (kind === "benign") {
    // Full refund of whatever the submission charged (spec Q4/Q8) — the base
    // charge PLUS any picture-upgrade or website-add-on charge, netted against
    // an upgrade already returned by a failed attach. adRefundableTotal
    // matches ad ids as delimited tokens, so #12 never resolves to #125's.
    const ledger = await getLedger(ad.ownerPhone);
    let owed = adRefundableTotal(ledger, id);
    if (owed === 0) {
      // A delta-0 spend = a legacy free-ad-pass ad (pre-session-016). Passes
      // are gone — refund the current dollar price of that ad kind instead.
      const charge = findAdCharge(ledger, id);
      if (charge) {
        const settings = await getEngineSettings();
        owed = legacyPassRefundCents(charge.note, settings.costTextCents, settings.costPhotoCents);
      }
    }
    // Since session 023 an ad is collected for when it RUNS, so an ad turned
    // down before it ran was never charged and there is nothing to give back —
    // owed comes out at 0 and the reply says so. The refund path below stays
    // for ads posted BEFORE 9951, which really were charged at submission and
    // really are owed their money.
    let refundNote = "Nothing was charged.";
    if (owed > 0) {
      await addLedgerEntry(ad.ownerPhone, {
        delta: owed,
        kind: "refund",
        note: `Refund — ad #${id} not accepted`,
      });
      refundNote = `Your ${formatPrice(owed)} was returned.`;
      afterResponse(() =>
        analytics.refunded({
          phone: ad.ownerPhone,
          transactionId: `ad_${id}_reject`,
          amountCents: owed,
          reason: "rejected",
        }),
      );
    }
    await notify(
      ad.ownerPhone,
      book.render("ad.rejected.benign", { adId: id, reason, refundNote }),
    );
    return;
  }

  // Violation: charge is kept, strike recorded, ban at the threshold (Q8/Q10).
  const count = await recordOffense(ad.ownerPhone);
  const warning =
    count >= OFFENSE_BAN_THRESHOLD
      ? "Your ability to post is now suspended. You can appeal at ThePlainExchange.com."
      : `Warning ${count} of ${OFFENSE_BAN_THRESHOLD} — a third violation will suspend your ability to post.`;
  await notify(
    ad.ownerPhone,
    book.render("ad.rejected.violation", { adId: id, reason, warning }),
  );
}
