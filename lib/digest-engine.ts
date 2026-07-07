/**
 * The digest broadcaster. Called by /api/cron/digests every few minutes;
 * finds ET slots that are due today and haven't run, assembles the digest
 * (new ads first, FIFO, capped; queued bumps fill what's left), and sends
 * one concatenated message per subscriber. Idempotency comes from the
 * one-digest-per-slot rule (unique constraint in the schema; slotKey in the
 * file store).
 */
import { getEngineSettings } from "@/lib/settings";
import {
  createDigestIfAbsent,
  digestsSentOnDay,
  finalizeDigest,
  getAdRecord,
  getNewDigestAds,
  getQueuedBumps,
  logMessage,
  type StoredAd,
} from "@/lib/engine-store";
import { listSubscriberPhones } from "@/lib/store";
import { sms } from "@/lib/sms";
import { gsmSanitize, packMessages } from "@/lib/sms-segments";

const SLOT_LABELS: Record<number, string> = {
  7: "morning",
  12: "noon",
  16: "afternoon",
  20: "evening",
};

/** ET calendar date (YYYY-MM-DD) and hour for a moment in time. */
export function etParts(date: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
  };
}

export function composeDigest(
  now: Date,
  slotHour: number,
  items: StoredAd[],
  firstOfDay: boolean,
): string {
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const label = SLOT_LABELS[slotHour] ?? `${slotHour}:00`;
  const lines = [
    `Plain Exchange, ${dateLabel} ${label}:`,
    ...items.map(
      (ad) => `#${ad.id} ${ad.body}${ad.photo ? ` Pic? Reply PIC ${ad.id}` : ""}`,
    ),
  ];
  if (firstOfDay) lines.push("Reply STOP to end");
  return lines.join("\n");
}

/**
 * Max GSM-7 characters per digest message. Ads are packed whole into as few
 * messages as possible under this ceiling — big enough to keep segment count
 * near-minimal (packing waste is small), small enough that each message stays
 * a clean, reliably-delivered SMS (never an MMS) on a flip phone. ~4 segments.
 */
export const DIGEST_MSG_MAX_GSM = 612;

/**
 * Compose a digest as a list of SMS-ready messages: ad text GSM-sanitized so a
 * stray emoji can't flip the whole broadcast to costly UCS-2, ads kept whole,
 * packed into the fewest messages under the single-SMS ceiling. This is what
 * gets enqueued and delivered per subscriber.
 */
export function composeDigestMessages(
  now: Date,
  slotHour: number,
  items: StoredAd[],
  firstOfDay: boolean,
): string[] {
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const label = SLOT_LABELS[slotHour] ?? `${slotHour}:00`;
  const header = gsmSanitize(`Plain Exchange ${dateLabel} ${label}:`);
  const adLines = items.map((ad) =>
    gsmSanitize(`#${ad.id} ${ad.body}${ad.photo ? ` Pic? Reply PIC ${ad.id}` : ""}`),
  );
  return packMessages({
    header,
    adLines,
    footer: firstOfDay ? "Reply STOP to end" : undefined,
    maxGsm: DIGEST_MSG_MAX_GSM,
  });
}

export interface SlotResult {
  slotKey: string;
  items: number;
  recipients: number;
  skipped: boolean;
}

export async function runDueDigests(now = new Date()): Promise<SlotResult[]> {
  const { day, hour } = etParts(now);
  const settings = await getEngineSettings();
  const results: SlotResult[] = [];

  for (const slot of settings.slots) {
    if (hour < slot) continue;
    const slotKey = `${day}#${slot}`;
    const { id: digestId, created } = await createDigestIfAbsent(slotKey, slot);
    if (!created) continue; // slot already handled — idempotent

    // New ads first (FIFO by approval), bumps fill the remaining capacity.
    const newAds = await getNewDigestAds(settings.digestCap);
    const bumpRecords: { id: number }[] = [];
    const bumpAds: StoredAd[] = [];
    const remaining = settings.digestCap - newAds.length;
    if (remaining > 0) {
      for (const bump of await getQueuedBumps()) {
        if (bumpAds.length >= remaining) break;
        const ad = await getAdRecord(bump.adId);
        if (ad && ad.status === "approved" && !newAds.some((n) => n.id === ad.id)) {
          bumpRecords.push(bump);
          bumpAds.push(ad);
        }
      }
    }
    const items = [...newAds, ...bumpAds];

    if (!items.length) {
      // Spec: empty slots send nothing — but the slot is recorded so it never re-runs.
      await finalizeDigest(digestId, [], [], 0);
      results.push({ slotKey, items: 0, recipients: 0, skipped: true });
      continue;
    }

    const firstOfDay = (await digestsSentOnDay(day)) === 0;
    const body = composeDigest(now, slot, items, firstOfDay);
    const subscribers = await listSubscriberPhones();
    for (const phone of subscribers) {
      await sms.send(phone, body);
      await logMessage({
        direction: "outbound",
        channel: "sms",
        address: phone,
        body,
        digestId,
      });
    }
    await finalizeDigest(
      digestId,
      newAds.map((a) => a.id),
      bumpRecords.map((b) => b.id),
      items.length,
      items.map((a) => a.id),
    );
    results.push({ slotKey, items: items.length, recipients: subscribers.length, skipped: false });
  }

  return results;
}
