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
import { getEngineSettings, effectiveSmsCaps } from "@/lib/settings";
import {
  allocateDigestNumber,
  claimDigestOutbox,
  countRecentOutboundContaining,
  createDigestIfAbsent,
  createExtraDigest,
  digestSegmentsSentSince,
  digestsSentOnDay,
  enqueueDigestOutbox,
  finalizeDigest,
  finalizeExtraDigest,
  getAdCategories,
  getAdRecord,
  getNewDigestAds,
  getQueuedBumps,
  getRecentDigestAdIds,
  logMessage,
  markOutboxFailed,
  markOutboxSent,
  queuedOutboxCount,
  requeueOutbox,
  reserveSms,
  type OutboxInsert,
  type OutboxRow,
  type StoredAd,
} from "@/lib/engine-store";
import {
  getSubscriberCategories,
  listEmailRecipientsWithCategories,
  listSubscribersWithCategories,
} from "@/lib/store";
import { adMatchesCategories, partitionKey } from "@/lib/categories";
import { unsubscribeUrl } from "@/lib/email";
import { composeEmailHtml, composeEmailText } from "@/lib/email-digest";
import { sms } from "@/lib/sms";
import { email } from "@/lib/email";
import { site } from "@/lib/config";
import { notifyAdminDigestHalted } from "@/lib/notify";
import { pauseBlocks } from "@/lib/outbound";
import { listBlocked } from "@/lib/blocklist";
import { etParts } from "@/lib/et";
import { composeEmailSubject } from "@/lib/ad-display";
import { gsmSanitize, packMessages, segmentation } from "@/lib/sms-segments";
import { listDueSponsors, markSponsorRan } from "@/lib/business";
import { sponsorLine } from "@/lib/business-packages";

const SLOT_LABELS: Record<number, string> = {
  7: "morning",
  12: "noon",
  16: "afternoon",
  20: "evening",
};

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
export type DigestEdition = "early" | "extra";

export function composeDigestMessages(
  now: Date,
  slotHour: number,
  items: StoredAd[],
  firstOfDay: boolean,
  edition?: DigestEdition,
  digestNo?: number | null,
  sponsorLines?: string[],
): string[] {
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  // Label admin-triggered editions so subscribers aren't confused by an
  // off-schedule digest ("(sent early)") or one that repeats ads ("extra").
  const label =
    edition === "extra"
      ? "extra edition"
      : `${SLOT_LABELS[slotHour] ?? `${slotHour}:00`}${edition === "early" ? " (sent early)" : ""}`;
  // Every sent digest carries its edition number (FEATURES item 5); omitted
  // only while migration 9982 is pending.
  const header = gsmSanitize(
    `Plain Exchange${digestNo ? ` No. ${digestNo}` : ""} ${dateLabel} ${label}:`,
  );
  const adLines = items.map((ad) =>
    gsmSanitize(`#${ad.id} ${ad.body}${ad.photo ? ` Pic? Reply PIC ${ad.id}` : ""}`),
  );
  // Business sponsor lines (item 17) ride FIRST, right under the header —
  // clearly labeled ("Sponsor: …"), OUTSIDE the cap-10 member ads (they are
  // extra lines, never one of the FIFO slots), and GSM-sanitized through the
  // same packer so a sponsor's text can't flip the broadcast to UCS-2 pricing.
  const sponsors = (sponsorLines ?? []).map((line) => gsmSanitize(line));
  return packMessages({
    header,
    adLines: [...sponsors, ...adLines],
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

/**
 * Category-aware SMS composition (item 22): ONE combined digest per
 * subscriber per slot, carrying only their categories' ads (+ every
 * uncategorized ad + the sponsor lines, which ride regardless of categories).
 *
 * Subscribers are grouped by their EFFECTIVE category set and each distinct
 * set's edition is composed/packed exactly once, then its parts enqueued to
 * that whole group — composition cost is O(distinct sets), not O(subscribers),
 * and the ALL group's edition is byte-identical to the pre-category digest.
 * A subscriber whose filtered edition is empty (and no sponsors ride) gets
 * nothing this slot. Pre-9976 every ad reads uncategorized and every
 * subscriber reads ALL, so exactly one group forms: today's behavior.
 */
export function buildCategorizedSmsRows(params: {
  digestId: number;
  now: Date;
  slotHour: number;
  items: StoredAd[];
  /** Ad id → category (getAdCategories); missing ids read uncategorized. */
  categoriesByAd: Map<number, string | null>;
  firstOfDay: boolean;
  edition?: DigestEdition;
  digestNo: number | null;
  sponsorLines: string[];
  recipients: { phone: string; categories: string[] | null }[];
}): { rows: OutboxInsert[]; recipients: number } {
  const groups = new Map<string, { categories: string[] | null; phones: string[] }>();
  for (const r of params.recipients) {
    const key = partitionKey(r.categories);
    const group = groups.get(key);
    if (group) group.phones.push(r.phone);
    else groups.set(key, { categories: r.categories, phones: [r.phone] });
  }
  const rows: OutboxInsert[] = [];
  let recipients = 0;
  for (const group of groups.values()) {
    const filtered = params.items.filter((ad) =>
      adMatchesCategories(params.categoriesByAd.get(ad.id) ?? null, group.categories),
    );
    // Nothing in their categories and no sponsor lines riding — no digest for
    // this group this slot (an empty-set subscriber was already warned).
    if (!filtered.length && !params.sponsorLines.length) continue;
    const messages = composeDigestMessages(
      params.now,
      params.slotHour,
      filtered,
      params.firstOfDay,
      params.edition,
      params.digestNo,
      params.sponsorLines,
    );
    const partSegments = messages.map((m) => segmentation(m).segments);
    for (const phone of group.phones) {
      recipients++;
      for (let i = 0; i < messages.length; i++) {
        rows.push({
          digestId: params.digestId,
          channel: "sms",
          address: phone,
          part: i + 1,
          parts: messages.length,
          body: messages[i],
          segments: partSegments[i],
        });
      }
    }
  }
  return { rows, recipients };
}

/** Catch-up messages for a brand-new subscriber: the most recent digest's ads. */
export function composeCatchupMessages(items: StoredAd[]): string[] {
  const header = gsmSanitize(`${site.name} — most recent ads:`);
  const adLines = items.map((ad) =>
    gsmSanitize(`#${ad.id} ${ad.body}${ad.photo ? ` Pic? Reply PIC ${ad.id}` : ""}`),
  );
  return packMessages({ header, adLines, maxGsm: DIGEST_MSG_MAX_GSM });
}

/**
 * Send a just-subscribed number the ads from the most recent digest, so they
 * aren't waiting hours for the next slot. Best-effort and separate from the
 * broadcast outbox (it's one recipient); returns how many ads were sent.
 */
/** Header marker used to dedup catch-up sends (see composeCatchupMessages). */
const CATCHUP_MARKER = "most recent ads:";

export async function sendRecentDigestTo(phone: string): Promise<number> {
  // Catch-up is a bulk send: skip it under any pause, and while UNDER ATTACK
  // (so a spoofed-number subscribe flood can't each pull a burst of SMS).
  const settings = await getEngineSettings();
  if (pauseBlocks("bulk", settings.pauseMode) || settings.underAttack) return 0;
  // At most one catch-up per number per day: a STOP/START (or STOP/SUBSCRIBE)
  // loop must not re-trigger repeated catch-up bursts — this lane otherwise
  // bypasses both SMS cost breakers.
  if ((await countRecentOutboundContaining(phone, CATCHUP_MARKER, 24 * 60 * 60 * 1000)) > 0) {
    return 0;
  }
  const ids = await getRecentDigestAdIds();
  if (!ids.length) return 0;
  let ads: StoredAd[] = [];
  for (const id of ids) {
    const ad = await getAdRecord(id);
    if (ad && ad.status === "approved") ads.push(ad); // still-available only
  }
  // Respect the subscriber's category prefs (item 22) — a returning selective
  // member's catch-up carries only their categories (+ uncategorized ads).
  const prefs = await getSubscriberCategories(phone);
  if (prefs !== "unsupported" && prefs !== null) {
    const categoriesByAd = await getAdCategories(ads.map((a) => a.id));
    ads = ads.filter((ad) => adMatchesCategories(categoriesByAd.get(ad.id) ?? null, prefs));
  }
  if (!ads.length) return 0;
  // Count catch-up against the service-wide SMS breaker (it otherwise bypassed
  // both the reply cap and the digest segment budget).
  const caps = effectiveSmsCaps(settings);
  if (
    !(await reserveSms(phone, "reply", caps.repliesPerHour, caps.globalPerHour, caps.picsPerHour, 60 * 60 * 1000))
  ) {
    return 0;
  }
  ads.sort((a, b) => a.id - b.id);
  for (const body of composeCatchupMessages(ads)) {
    await sms.send(phone, body);
    await logMessage({ direction: "outbound", channel: "sms", address: phone, body });
  }
  return ads.length;
}

/**
 * The next slot occurrence after `now`: its ET day key, hour, and (approximate)
 * instant. Wall-clock arithmetic off etParts — exact enough for holds and
 * labels; digests never run near the 2 AM DST boundary.
 */
export function nextSlotOccurrence(
  slots: number[],
  now = new Date(),
): { day: string; slot: number; at: Date } | null {
  const sorted = [...slots].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const { day, hour } = etParts(now);
  const todaySlot = sorted.find((s) => s > hour);
  const hoursAhead = todaySlot !== undefined ? todaySlot - hour : 24 - hour + sorted[0];
  // Minutes/seconds are timezone-independent (ET offsets are whole hours).
  const at = new Date(
    now.getTime() + hoursAhead * 3600_000 - now.getMinutes() * 60_000 - now.getSeconds() * 1000,
  );
  if (todaySlot !== undefined) return { day, slot: todaySlot, at };
  return { day: etParts(at).day, slot: sorted[0], at };
}

/**
 * What the next digest slot would carry if it composed right now: new ads
 * first (FIFO by approval), queued bumps filling the remaining capacity.
 * Shared by runDueDigests (the authority) and the admin Digests tab preview,
 * so what the admin sees is exactly what the composer will pick.
 */
export async function selectDigestItems(cap: number): Promise<{
  newAds: StoredAd[];
  bumpAds: StoredAd[];
  bumpRecords: { id: number }[];
}> {
  const newAds = await getNewDigestAds(cap);
  const bumpRecords: { id: number }[] = [];
  const bumpAds: StoredAd[] = [];
  const remaining = cap - newAds.length;
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
  return { newAds, bumpAds, bumpRecords };
}

export type SendNowResult =
  | { ok: true; items: number; recipients: number; emailRecipients: number; drained: number }
  | { ok: false; reason: string };

/**
 * Admin "Send early" / "Send extra" (session 007).
 *
 * early — composes the UPCOMING slot's digest right now, under that slot's
 * identity, so the scheduled run becomes a no-op: the 3 PM digest simply goes
 * out at 1:30. Consumes the queue exactly like the scheduled run would
 * (broadcast_at set, bumps spent). Header says "(sent early)".
 *
 * extra — an additional edition outside the slot system: sends the current
 * queue right now but consumes NOTHING, so the same ads ride again at the
 * next regular slot. Header says "extra edition".
 *
 * Both also send the matching email edition immediately, then drain the
 * outbox so delivery starts within the click, not at the next cron tick.
 */
export async function sendDigestNow(edition: DigestEdition): Promise<SendNowResult> {
  const now = new Date();
  const settings = await getEngineSettings();
  if (pauseBlocks("bulk", settings.pauseMode)) {
    return { ok: false, reason: "Digest sending is paused (see Settings → System controls)." };
  }
  const { newAds, bumpAds, bumpRecords } = await selectDigestItems(settings.digestCap);
  const items = [...newAds, ...bumpAds];
  if (!items.length) return { ok: false, reason: "Nothing is queued for a digest right now." };

  // Identify the digest rows.
  let smsDigestId: number;
  let emailDigestId: number;
  let slotHour: number;
  if (edition === "early") {
    const next = nextSlotOccurrence(settings.slots, now);
    if (!next) return { ok: false, reason: "No digest slots are configured." };
    slotHour = next.slot;
    const sms = await createDigestIfAbsent(`${next.day}#${next.slot}`, next.slot);
    if (sms.finalized) {
      return { ok: false, reason: `The ${next.day} ${next.slot}:00 digest was already sent.` };
    }
    smsDigestId = sms.id;
    emailDigestId = (await createDigestIfAbsent(`${next.day}#email#${next.slot}`, next.slot, "email")).id;
  } else {
    slotHour = etParts(now).hour;
    smsDigestId = await createExtraDigest("sms", now);
    emailDigestId = await createExtraDigest("email", new Date(now.getTime() + 1000));
  }

  // Compose + enqueue the SMS edition.
  const { day } = etParts(now);
  const firstOfDay = (await digestsSentOnDay(day)) === 0;
  const digestNo = await allocateDigestNumber(smsDigestId);
  // Sponsor lines (item 17) ride the first digest of the day — an early/extra
  // edition counts (and a later scheduled slot then skips them for the day).
  // They ride EVERY recipient's edition regardless of category prefs.
  const sponsors = await listDueSponsors(day);
  const blocked = new Set((await listBlocked()).map((b) => b.phone));
  const subscribers = (await listSubscribersWithCategories()).filter(
    (s) => !blocked.has(s.phone),
  );
  // Per-category-set composition — same machinery as the scheduled run.
  const categoriesByAd = await getAdCategories(items.map((a) => a.id));
  const { rows, recipients: smsRecipients } = buildCategorizedSmsRows({
    digestId: smsDigestId,
    now,
    slotHour,
    items,
    categoriesByAd,
    firstOfDay,
    edition,
    digestNo,
    sponsorLines: sponsors.map((s) => sponsorLine(s)),
    recipients: subscribers,
  });
  await enqueueDigestOutbox(rows);

  // Compose + enqueue the matching email edition (mirrors the SMS digest),
  // filtered per recipient the same way as the SMS side.
  const recipients = await listEmailRecipientsWithCategories();
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const editionTag = edition === "early" ? " (sent early)" : " (extra edition)";
  const sorted = [...items].sort((a, b) => a.id - b.id);
  // The email edition mirrors the SMS digest's number (FEATURES item 5).
  const emailDateLabel = `${dateLabel}${editionTag}${digestNo ? ` · Digest No. ${digestNo}` : ""}`;
  const emailRows: OutboxInsert[] = [];
  for (const r of recipients) {
    const filtered = sorted.filter((ad) =>
      adMatchesCategories(categoriesByAd.get(ad.id) ?? null, r.categories),
    );
    if (!filtered.length && !sponsors.length) continue;
    const unsub = unsubscribeUrl(r.email);
    emailRows.push({
      digestId: emailDigestId,
      channel: "email" as const,
      address: r.email,
      part: 1,
      parts: 1,
      subject: composeEmailSubject(site.name, filtered, day, editionTag),
      body: composeEmailText(filtered, emailDateLabel, unsub, sponsors),
      html: composeEmailHtml(filtered, emailDateLabel, unsub, sponsors),
      segments: 0,
    });
  }
  await enqueueDigestOutbox(emailRows);

  // Bookkeeping: early consumes the queue exactly like the scheduled run;
  // extra records its contents and consumes nothing.
  if (edition === "early") {
    await finalizeDigest(
      smsDigestId,
      newAds.map((a) => a.id),
      bumpRecords.map((b) => b.id),
      items.length,
      items.map((a) => a.id),
    );
    await finalizeDigest(emailDigestId, [], [], items.length);
  } else {
    await finalizeExtraDigest(smsDigestId, items.map((a) => a.id), items.length);
    await finalizeExtraDigest(emailDigestId, [], items.length);
  }

  // Sponsor days consumed after the bookkeeping (crash-safe, same as the
  // scheduled run). The email mirror was composed above with the sponsors in
  // hand, so the recorded key just needs to be unique — the slot-key lookup in
  // runDueEmailDigests never applies here (its email digest is already final).
  for (const s of sponsors) {
    await markSponsorRan(s.id, day, `sent-now#${smsDigestId}`);
  }

  // Deliver now — don't make "send early" wait for the next cron tick.
  const drain = await drainDigestOutbox({ newlyEnqueued: true });
  return {
    ok: true,
    items: items.length,
    recipients: smsRecipients,
    emailRecipients: emailRows.length,
    drained: drain.sent,
  };
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

    const { newAds, bumpAds, bumpRecords } = await selectDigestItems(settings.digestCap);
    const items = [...newAds, ...bumpAds];

    if (!items.length) {
      // Spec: empty slots send nothing — but the slot is recorded so it never re-runs.
      await finalizeDigest(digestId, [], [], 0);
      results.push({ slotKey, items: 0, recipients: 0, skipped: true });
      continue;
    }

    const firstOfDay = (await digestsSentOnDay(day)) === 0;
    const digestNo = await allocateDigestNumber(digestId);
    // Business sponsor lines (item 17): every active package rides the first
    // digest that composes each ET day (listDueSponsors excludes ones that
    // already rode today), as labeled extra lines outside the cap-10 — and
    // they ride EVERY subscriber's edition regardless of category prefs.
    const sponsors = await listDueSponsors(day);
    // Blocked numbers get no broadcast (the drain sends via the raw transport,
    // so filtering here is the blocklist's enforcement point for digests).
    const blocked = new Set((await listBlocked()).map((b) => b.phone));
    const subscribers = (await listSubscribersWithCategories()).filter(
      (s) => !blocked.has(s.phone),
    );
    // Per-category-set composition (item 22): one combined digest per
    // subscriber, packed once per distinct category set. Pre-9976 this map is
    // empty (all ads uncategorized) and prefs read ALL — unfiltered as today.
    const categoriesByAd = await getAdCategories(items.map((a) => a.id));
    const { rows, recipients } = buildCategorizedSmsRows({
      digestId,
      now,
      slotHour: slot,
      items,
      categoriesByAd,
      firstOfDay,
      digestNo,
      sponsorLines: sponsors.map((s) => sponsorLine(s)),
      recipients: subscribers,
    });
    const queued = await enqueueDigestOutbox(rows);
    await finalizeDigest(
      digestId,
      newAds.map((a) => a.id),
      bumpRecords.map((b) => b.id),
      items.length,
      items.map((a) => a.id),
    );
    // Consume each sponsor's paid day only after the digest is enqueued and
    // finalized: a crash mid-compose leaves the day uncounted, the redo picks
    // the sponsors up again, and the outbox unique key dedups the rows. The
    // slot key is remembered so the email edition mirrors the same sponsors.
    for (const s of sponsors) {
      await markSponsorRan(s.id, day, slotKey);
    }
    results.push({
      slotKey,
      items: items.length,
      recipients,
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
  // Enforce the blocklist at SEND time too (not just at compose): a number
  // blocked after a slot composed must not receive its already-queued rows.
  // STOP/block also purge queued rows at the moment of the event; this set
  // catches anything in-flight. Loaded once per run — cheap.
  const blockedSet = new Set((await listBlocked()).map((b) => b.phone));
  const budget = settings.digestDailySegmentBudget;
  // Operator kill switch: a PARTIAL or FULL pause both stop bulk (digest)
  // sending. Rows stay queued and resume when the pause is lifted.
  const paused = pauseBlocks("bulk", settings.pauseMode);
  // UNDER ATTACK throttle: cap how many rows a single run may send, so the
  // broadcast trickles out (≈ cap per cron tick) instead of firing at once.
  const runCap =
    settings.underAttack && settings.outboundThrottlePerMin > 0
      ? settings.outboundThrottlePerMin
      : Infinity;
  const windowStart = new Date(startedAt - 24 * 60 * 60 * 1000).toISOString();
  let spent = await digestSegmentsSentSince(windowStart);

  let sent = 0;
  let failed = 0;
  let segmentsSent = 0;
  let halted = false;
  let budgetHalt = false; // only a budget halt alerts; pause/throttle are deliberate
  // SMS rows skipped because the segment budget is spent. They're left CLAIMED
  // (not requeued yet) so the next claim skips past them to the email rows
  // behind, then released back to the queue at the end of the run. The digest
  // segment budget caps SMS COST only; the email edition is 0-segment and
  // documented exempt, so it keeps flowing even while SMS is budget-halted.
  const deferredSms: number[] = [];

  outer: while (Date.now() - startedAt < timeBudgetMs) {
    if (paused) {
      halted = true;
      break;
    }
    if (sent >= runCap) {
      halted = true;
      break;
    }
    const batch = await claimDigestOutbox(DRAIN_BATCH);
    if (!batch.length) break;

    for (let i = 0; i < batch.length; i += SEND_CONCURRENCY) {
      if (sent >= runCap || Date.now() - startedAt >= timeBudgetMs) {
        halted = sent >= runCap;
        // Give untouched claimed rows straight back to the queue instead of
        // waiting out the stale-claim reclaim window.
        await requeueOutbox(batch.slice(i).map((r) => r.id));
        break outer;
      }
      const chunk = batch.slice(i, i + SEND_CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          // SMS over the segment budget: leave it claimed (skipped this run) so
          // the claim reaches the exempt email rows behind it; released at the
          // end. Email rows (segments 0) always pass.
          if (row.channel === "sms" && spent >= budget) {
            deferredSms.push(row.id);
            budgetHalt = true;
            return;
          }
          if (row.channel === "sms" && blockedSet.has(row.address)) {
            // Blocked after this digest composed — drop without sending.
            await markOutboxFailed(row.id, "skipped: recipient blocked", 1);
            failed++;
            return;
          }
          // ONLY a send failure may mark the row failed (→ retry). Once the
          // provider has accepted the message, a bookkeeping error (markSent /
          // logMessage) must NOT flip it to failed, or the retry re-sends the
          // SMS — a double broadcast at double cost, and the segment budget
          // undercounts. Count the spend the moment the send succeeds.
          try {
            await sendOutboxRow(row);
          } catch (e) {
            failed++;
            await markOutboxFailed(
              row.id,
              e instanceof Error ? e.message : String(e),
              MAX_SEND_ATTEMPTS,
            );
            return;
          }
          sent++;
          spent += row.segments;
          segmentsSent += row.segments;
          try {
            await markOutboxSent(row.id);
            await logMessage({
              direction: "outbound",
              channel: row.channel,
              address: row.address,
              body: row.subject ? `${row.subject}\n\n${row.body}` : row.body,
              ...(row.html && { html: row.html }),
              digestId: row.digestId,
            });
          } catch (e) {
            // Already delivered — never re-drive the provider from here. Worst
            // case the row re-claims after the stale window; that's the rare,
            // bounded exception, not an immediate double-send on every DB blip.
            console.error(
              "[digest] post-send bookkeeping failed for outbox row",
              row.id,
              e instanceof Error ? e.message : e,
            );
          }
        }),
      );
    }
  }

  // Release the budget-deferred SMS rows back to 'queued' for the next window
  // (they were held claimed only to let the drain reach the email rows behind).
  if (deferredSms.length) {
    await requeueOutbox(deferredSms);
    halted = true;
  }

  const remaining = await queuedOutboxCount();
  // Only a BUDGET halt emails the operator — a deliberate pause or the
  // under-attack throttle shouldn't page them about their own switch.
  if (budgetHalt && remaining > 0 && (segmentsSent > 0 || opts.newlyEnqueued)) {
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
