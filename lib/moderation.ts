/**
 * Review-queue actions (spec Q4/Q8/Q10): approve with optional edit; reject
 * as benign (full refund) or violation (charge kept, strike recorded, ban at
 * three). The admin portal is UI over these functions; the dev simulator
 * calls them directly.
 */
import {
  approveAdRecord,
  getAdRecord,
  logMessage,
  rejectAdRecord,
} from "@/lib/engine-store";
import {
  OFFENSE_BAN_THRESHOLD,
  addLedgerEntry,
  getLedger,
  grantFreeAd,
  recordOffense,
} from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { dispatchSms } from "@/lib/outbound";

async function notify(phone: string, body: string): Promise<void> {
  // "reply" class: a FULL pause suppresses these seller notices, a PARTIAL
  // pause lets them through; blocklist/throttle apply. Only log what went out.
  const { sent } = await dispatchSms(phone, body, { cls: "reply" });
  if (sent) await logMessage({ direction: "outbound", channel: "sms", address: phone, body });
}

export async function approveAd(id: number, editedBody?: string): Promise<void> {
  const ad = await getAdRecord(id);
  if (!ad || ad.status !== "pending") return;
  const settings = await getEngineSettings();
  await approveAdRecord(id, editedBody, settings.expiryDays);
  await notify(
    ad.ownerPhone,
    `Your ad #${id} is approved and will run in the next digest. Text STATUS ${id} any time to check it.`,
  );
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

  if (kind === "benign") {
    // Full refund of whatever the submission charged (spec Q4/Q8). Match the
    // ad id as a delimited token — a bare `includes("Ad #12")` also matches
    // "Ad #125", so refund could resolve to the wrong (larger) charge.
    const ledger = await getLedger(ad.ownerPhone);
    const charge = ledger.find(
      (entry) =>
        entry.kind === "spend" &&
        (entry.note.includes(`Ad #${id} (`) || entry.note.includes(`ad #${id} (`)),
    );
    let refundNote = "charge";
    if (charge && charge.delta < 0) {
      await addLedgerEntry(ad.ownerPhone, {
        delta: -charge.delta,
        kind: "refund",
        note: `Refund — ad #${id} not accepted`,
      });
      refundNote = `${-charge.delta} credit${-charge.delta === 1 ? "" : "s"}`;
    } else {
      await grantFreeAd(ad.ownerPhone);
      await addLedgerEntry(ad.ownerPhone, {
        delta: 0,
        kind: "refund",
        note: `Free ad returned — ad #${id} not accepted`,
      });
      refundNote = "free ad";
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
