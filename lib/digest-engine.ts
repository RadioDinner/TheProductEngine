/**
 * The digest broadcaster. Called by /api/cron/digests every few minutes;
 * finds ET slots that are due today and haven't run, assembles the digest
 * (new ads first, FIFO, capped; queued bumps fill what's left), and ENQUEUES
 * one outbox row per (subscriber, message part). Delivery happens in
 * drainDigestOutbox: bounded batches in columnar order (every subscriber
 * gets part 1 before anyone gets part 2), resumable across cron runs, under
 * a rolling-24h billed-segment budget. Idempotency comes from the
 * one-digest-per-slot rule plus the outbox unique key.
 */
import { getEngineSettings } from "@/lib/settings";
import {
  claimDigestOutbox,
  createDigestIfAbsent,
  digestSegmentsSentSince,
  digestsSentOnDay,
  enqueueDigestOutbox,
  finalizeDigest,
  getAdRecord,
  getNewDigestAds,
  getQueuedBumps,
  logMessage,
  markOutboxFailed,
  markOutboxSent,
  queuedOutboxCount,
  requeueOutbox,
  type OutboxInsert,
  type OutboxRow,
  type StoredAd,
} from "@/lib/engine-store";
import { listSubscriberPhones } from "@/lib/store";
import { sms } from "@/lib/sms";
import { email } from "@/lib/email";
import { notifyAdminDigestHalted } from "@/lib/notify";
import { gsmSanitize, packMessages, segmentation } from "@/lib/sms-segments";

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
  /** Outbox rows newly enqueued for this slot (recipients × parts). */
  queued?: number;
  skipped: boolean;
}

export async function runDueDigests(now = new Date()): Promise<SlotResult[]> {
  const { day, hour } = etParts(now);
  const settings = await getEngineSettings();
  const results: SlotResult[] = [];

  for (const slot of settings.slots) {
    if (hour < slot) continue;
    const slotKey = `${day}#${slot}`;
    const { id: digestId, finalized } = await createDigestIfAbsent(slotKey, slot);
    // finalized = slot fully composed+enqueued already. A digest row that
    // exists but never finalized means a previous run died mid-enqueue —
    // fall through and redo it (the outbox unique key dedups the rows).
    if (finalized) continue;

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
    const messages = composeDigestMessages(now, slot, items, firstOfDay);
    const parts = messages.length;
    const partSegments = messages.map((m) => segmentation(m).segments);
    const subscribers = await listSubscriberPhones();

    const rows: OutboxInsert[] = [];
    for (const phone of subscribers) {
      for (let i = 0; i < parts; i++) {
        rows.push({
          digestId,
          channel: "sms",
          address: phone,
          part: i + 1,
          parts,
          body: messages[i],
          segments: partSegments[i],
        });
      }
    }
    const queued = await enqueueDigestOutbox(rows);
    await finalizeDigest(
      digestId,
      newAds.map((a) => a.id),
      bumpRecords.map((b) => b.id),
      items.length,
      items.map((a) => a.id),
    );
    results.push({
      slotKey,
      items: items.length,
      recipients: subscribers.length,
      queued,
      skipped: false,
    });
  }

  return results;
}

// ---------- delivery: draining the outbox ----------

/** Rows claimed per round trip — small enough to keep progress granular. */
const DRAIN_BATCH = 50;
/** Concurrent provider sends inside a batch (bounded, not per-subscriber serial). */
const SEND_CONCURRENCY = 8;
/** A row that fails this many sends is parked as 'failed' (visible, not retried). */
const MAX_SEND_ATTEMPTS = 3;

export interface DrainResult {
  sent: number;
  failed: number;
  /** Billed SMS segments delivered by THIS run. */
  segmentsSent: number;
  /** Deliveries still queued when the run stopped (drained next cron tick). */
  remaining: number;
  /** True when the rolling-24h segment budget stopped the run. */
  halted: boolean;
}

/**
 * Send queued digest deliveries in columnar order until the outbox is empty,
 * the time budget runs out (the cron picks the rest up next tick), or the
 * rolling-24h billed-segment budget (`digestDailySegmentBudget`, admin-set)
 * is exhausted — the cost circuit breaker digests never had. A budget halt
 * with work still queued alerts the admin (only on the run that crossed the
 * line or enqueued into a tripped breaker, so the 5-minute cron doesn't
 * re-alert forever).
 */
export async function drainDigestOutbox(
  opts: { timeBudgetMs?: number; newlyEnqueued?: boolean } = {},
): Promise<DrainResult> {
  const timeBudgetMs = opts.timeBudgetMs ?? 40_000;
  const startedAt = Date.now();
  const settings = await getEngineSettings();
  const budget = settings.digestDailySegmentBudget;
  const windowStart = new Date(startedAt - 24 * 60 * 60 * 1000).toISOString();
  let spent = await digestSegmentsSentSince(windowStart);

  let sent = 0;
  let failed = 0;
  let segmentsSent = 0;
  let halted = false;

  outer: while (Date.now() - startedAt < timeBudgetMs) {
    if (spent >= budget) {
      halted = true;
      break;
    }
    const batch = await claimDigestOutbox(DRAIN_BATCH);
    if (!batch.length) break;

    for (let i = 0; i < batch.length; i += SEND_CONCURRENCY) {
      if (spent >= budget || Date.now() - startedAt >= timeBudgetMs) {
        halted = spent >= budget;
        // Give untouched claimed rows straight back to the queue instead of
        // waiting out the stale-claim reclaim window.
        await requeueOutbox(batch.slice(i).map((r) => r.id));
        break outer;
      }
      const chunk = batch.slice(i, i + SEND_CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          try {
            await sendOutboxRow(row);
            await markOutboxSent(row.id);
            await logMessage({
              direction: "outbound",
              channel: row.channel,
              address: row.address,
              body: row.subject ? `${row.subject}\n\n${row.body}` : row.body,
              ...(row.html && { html: row.html }),
              digestId: row.digestId,
            });
            sent++;
            spent += row.segments;
            segmentsSent += row.segments;
          } catch (e) {
            failed++;
            await markOutboxFailed(
              row.id,
              e instanceof Error ? e.message : String(e),
              MAX_SEND_ATTEMPTS,
            );
          }
        }),
      );
    }
  }

  const remaining = await queuedOutboxCount();
  if (halted && remaining > 0 && (segmentsSent > 0 || opts.newlyEnqueued)) {
    await notifyAdminDigestHalted({ spent, budget, remaining });
  }
  return { sent, failed, segmentsSent, remaining, halted };
}

async function sendOutboxRow(row: OutboxRow): Promise<void> {
  if (row.channel === "email") {
    await email.send({
      to: row.address,
      subject: row.subject ?? "The Plain Exchange",
      html: row.html ?? "",
      text: row.body,
    });
    return;
  }
  await sms.send(row.address, row.body);
}
