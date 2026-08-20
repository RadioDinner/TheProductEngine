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
  logMessage,
  rejectAdRecord,
  setAdCategory,
} from "@/lib/engine-store";
import {
  OFFENSE_BAN_THRESHOLD,
  addLedgerEntry,
  getLedger,
  recordOffense,
} from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import {
  batchWaitLabel,
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
  await notify(
    ad.ownerPhone,
    open
      ? `Your ad #${id} is approved. It goes out to subscribers ${batchWaitLabel(settings)}. Text STATUS ${id} any time to check it.`
      : `Your ad #${id} is approved. It goes out ${nextSendLabel(now, settings)} — texts only go out between ${hourLabel(settings.smsWindowStartHour)} and ${hourLabel(settings.smsWindowEndHour)}, Monday through Saturday. Text STATUS ${id} any time to check it.`,
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
    let refundNote = "charge";
    if (owed > 0) {
      await addLedgerEntry(ad.ownerPhone, {
        delta: owed,
        kind: "refund",
        note: `Refund — ad #${id} not accepted`,
      });
      refundNote = formatPrice(owed);
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
      `Your ad #${id} was not accepted: ${reason} Your ${refundNote} was returned — you can fix it and send it again.`,
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
    `Your ad #${id} violated our posting guidelines and was not accepted: ${reason} ${warning}`,
  );
}
