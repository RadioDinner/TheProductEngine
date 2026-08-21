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
import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import { getEngineSettings, effectiveSmsCaps, type EngineSettings } from "@/lib/settings";
import { safeGapRange } from "@/lib/paced-release";
import {
  adminMessageDue,
  adminMessageSlotKey,
} from "@/lib/admin-messages";
import {
  allocateDigestNumber,
  claimAdminMessage,
  claimDigestOutbox,
  countRecentOutboundContaining,
  createDigestIfAbsent,
  createExtraDigest,
  digestSegmentsSentSince,
  stampReleaseSchedule,
  enqueueDigestOutbox,
  finalizeDigest,
  finalizeExtraDigest,
  getAdCategories,
  getAdRecord,
  getNewDigestAds,
  getQueuedBumps,
  getRecentDigestAdIds,
  listDueAdminMessages,
  logMessage,
  markOutboxFailed,
  markOutboxSent,
  queuedOutboxCount,
  recordAdminMessageSend,
  releaseAdminMessage,
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
import { collectForBatch } from "@/lib/ad-billing";
import { adMatchesCategories, partitionKey } from "@/lib/categories";
import { unsubscribeUrl, siteUrl } from "@/lib/email";
import { composeEmailHtml, composeEmailText } from "@/lib/email-digest";
import { sms } from "@/lib/sms";
import { email } from "@/lib/email";
import { site } from "@/lib/config";
import { notifyAdminDigestHalted } from "@/lib/notify";
import { pauseBlocks } from "@/lib/outbound";
import { listBlocked } from "@/lib/blocklist";
import { etParts } from "@/lib/et";
import { composeEmailSubject, deriveTitle } from "@/lib/ad-display";
import { gsmSanitize, packMessages, segmentation } from "@/lib/sms-segments";
import { listDueSponsors, markSponsorRan } from "@/lib/business";
import { sponsorLine } from "@/lib/business-packages";
import { textedAdPhotos } from "@/lib/photo-collage";
import { badgeLabel } from "@/lib/ad-badge";
import { storeBadgedPhoto } from "@/lib/photos";

/**
 * Max GSM-7 characters in ONE batch text — exactly six concatenated segments.
 *
 * This is the answer to "how is a competitor fitting all that in a text
 * without it becoming an MMS": they aren't fitting it in one. A long SMS is
 * split by the sender into 153-character segments carrying a reassembly
 * header, and the handset glues them back together — the reader sees one
 * message, the carrier bills six. Nothing about length turns an SMS into an
 * MMS; only attaching media does. So the ceiling here is a COST decision, not
 * a technical limit: ads are packed whole into as few messages as possible
 * under it, and 6 segments comfortably holds a 4-ad batch with its header and
 * footer, which is what the user's competitor sends.
 */
export const BATCH_MSG_MAX_GSM = 918;

/**
 * One ad's line in a batch text.
 *
 * Numbered by AD NUMBER, not by position in the batch (user decision, session
 * 018): the competitor numbers 1-4 and the numbers mean nothing an hour
 * later, while "1024" is the same number the badge on the picture shows, the
 * one PIC takes, the one SOLD takes, and the one on the website.
 *
 * `picturesRide` = each picture ad's photo is following as its own message,
 * so the line only advertises PIC when there are MORE pictures to pull. With
 * pictures off (a text-only batch) every picture ad advertises PIC, because
 * that is then the only way to see anything.
 */
export function batchAdLine(ad: StoredAd, picturesRide: boolean): string {
  const pictures = textedAdPhotos(ad.photo, ad.morePhotos).length;
  let suffix = "";
  if (pictures > 0 && !picturesRide) suffix = ` Pic? Reply PIC ${ad.id}`;
  else if (pictures > 1) suffix = ` More pics: PIC ${ad.id}`;
  return `${ad.id}) ${ad.body}${suffix}`;
}

/**
 * Compose a batch as a list of SMS-ready messages: ad text GSM-sanitized so a
 * stray emoji can't flip the whole broadcast to costly UCS-2, ads kept whole,
 * blank lines between them (a newline is one septet and a flip-phone screen
 * needs the air), packed into the fewest messages under the ceiling above.
 * This is what gets enqueued and delivered per subscriber.
 */
export type DigestEdition = "early" | "extra";

export function composeBatchMessages(
  now: Date,
  items: StoredAd[],
  opts: {
    edition?: DigestEdition;
    digestNo?: number | null;
    sponsorLines?: string[];
    /** Each picture ad's photo follows as its own message. */
    picturesRide?: boolean;
  } = {},
): string[] {
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  // Label admin-triggered editions so subscribers aren't confused by one that
  // repeats ads they already had ("extra edition").
  const label = opts.edition === "extra" ? " extra edition" : "";
  // Every batch carries its edition number (FEATURES item 5); omitted only
  // while migration 9982 is pending.
  const header = gsmSanitize(
    `${site.name}${opts.digestNo ? ` No. ${opts.digestNo}` : ""} - ${dateLabel}${label}:`,
  );
  const picturesRide = opts.picturesRide ?? false;
  // A blank line between ads: `packMessages` joins lines with "\n", so an
  // empty leading line is what puts air between them. Cheap (one septet) and
  // it is the difference between a readable list and a wall of text.
  const adLines = items.flatMap((ad) => ["", gsmSanitize(batchAdLine(ad, picturesRide))]);
  // Business sponsor lines (item 17) ride FIRST, right under the header —
  // clearly labeled ("Sponsor: …"), OUTSIDE the member ads (they are extra
  // lines, never one of the FIFO slots), and GSM-sanitized through the same
  // packer so a sponsor's text can't flip the broadcast to UCS-2 pricing.
  const sponsors = (opts.sponsorLines ?? []).flatMap((line) => ["", gsmSanitize(line)]);
  return packMessages({
    header,
    adLines: [...sponsors, ...adLines],
    footer: batchFooter(items, picturesRide),
    maxGsm: BATCH_MSG_MAX_GSM,
  });
}

/**
 * The standing footer, on EVERY batch (session 018).
 *
 * It used to ride only the first text of the day, back when a text was one ad
 * and the footer was a per-ad tax. A batch is a handful a day, so the ~60
 * septets buy the two things a subscriber needs in front of them — how to
 * place an ad, and how to stop — on every message rather than once at dawn.
 * That is also the posture carriers expect of a bulk program.
 *
 * The PIC line names a REAL ad from this batch, and only when one of them
 * actually has more pictures to pull: an example that answers "that's the
 * only picture" teaches the wrong thing.
 */
export function batchFooter(items: StoredAd[], picturesRide: boolean): string {
  const pullable = items.find(
    (ad) => textedAdPhotos(ad.photo, ad.morePhotos).length > (picturesRide ? 1 : 0),
  );
  return [
    "",
    "Reply AD to place an ad.",
    ...(pullable ? [`For pictures, reply PIC and the ad number, like PIC ${pullable.id}.`] : []),
    "Reply STOP to end.",
  ].join("\n");
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
 * What one picture ad contributes to a batch: its own message, carrying the
 * ad's FIRST picture with the ad number burned into the corner.
 *
 * One picture per ad, never the set (user decision, session 018): the
 * remaining two are a PIC pull away and the rest are on the website, so a
 * three-picture ad costs one MMS per subscriber to broadcast instead of
 * three. `url` is already badged and absolute by the time it gets here —
 * resolveBroadcastPictures does that work once per batch, not once per
 * subscriber.
 */
export interface BatchPicture {
  adId: number;
  url: string;
  caption: string;
}

/**
 * An MMS is not billed in segments, but the digest budget counts in them, so
 * a picture message has to be worth SOMETHING or the cost breaker would watch
 * pictures ride out for free. Telnyx bills an MMS at roughly three times a
 * GSM segment, so that is what one costs against `digestDailySegmentBudget`.
 * The text riding inside an MMS is free, which is why a caption doesn't add.
 */
export const MMS_SEGMENT_COST = 3;

/** The caption on a picture message — the ad number and enough of the ad to
 * recognise it. Short on purpose: the picture is the message, and a handset
 * that shows text before images should show something useful first. */
export function pictureCaption(ad: StoredAd): string {
  return gsmSanitize(`${ad.id}) ${deriveTitle(ad.body)}`);
}

/**
 * Category-aware SMS composition (item 22): ONE batch per subscriber, carrying
 * only their categories' ads (+ every uncategorized ad + the sponsor lines,
 * which ride regardless of categories).
 *
 * Subscribers are grouped by their EFFECTIVE category set and each distinct
 * set's batch is composed/packed exactly once, then its parts enqueued to that
 * whole group — composition cost is O(distinct sets), not O(subscribers), and
 * the ALL group's batch is byte-identical to the uncategorized one. A
 * subscriber whose filtered batch is empty (and no sponsors ride) gets nothing,
 * and an EMPTY-SET subscriber gets nothing at all — not even sponsor lines
 * ("You're not getting any ads now" must stay true).
 *
 * Parts are ordered text-first, then one part per picture: the drain sends in
 * columnar order (everyone gets part 1 before anyone gets part 2), so every
 * subscriber reads the list before the pictures land under it, and a run that
 * dies halfway leaves people with the ads rather than orphan photos.
 *
 * Returns the ad ids that landed in ≥1 group's batch (`deliveredAdIds`) so the
 * caller can finalize/consume ONLY what was actually delivered.
 */
export function buildCategorizedSmsRows(params: {
  digestId: number;
  now: Date;
  items: StoredAd[];
  /** Ad id → category (getAdCategories); missing ids read uncategorized. */
  categoriesByAd: Map<number, string | null>;
  edition?: DigestEdition;
  digestNo: number | null;
  sponsorLines: string[];
  /** Ad id → the badged, absolute picture URL to broadcast for it. Empty =
   * a text-only batch (photosInBroadcast off, or nothing could be prepared). */
  pictures?: Map<number, string>;
  recipients: { phone: string; categories: string[] | null }[];
}): { rows: OutboxInsert[]; recipients: number; deliveredAdIds: Set<number> } {
  const groups = new Map<string, { categories: string[] | null; phones: string[] }>();
  for (const r of params.recipients) {
    const key = partitionKey(r.categories);
    const group = groups.get(key);
    if (group) group.phones.push(r.phone);
    else groups.set(key, { categories: r.categories, phones: [r.phone] });
  }
  const pictures = params.pictures ?? new Map<number, string>();
  const rows: OutboxInsert[] = [];
  const deliveredAdIds = new Set<number>();
  let recipients = 0;
  for (const group of groups.values()) {
    // The warned-dark empty set gets NOTHING — including sponsors.
    if (group.categories && group.categories.length === 0) continue;
    const filtered = params.items.filter((ad) =>
      adMatchesCategories(params.categoriesByAd.get(ad.id) ?? null, group.categories),
    );
    // Nothing in their categories and no sponsor lines riding — no batch for
    // this group.
    if (!filtered.length && !params.sponsorLines.length) continue;
    for (const ad of filtered) deliveredAdIds.add(ad.id);
    const messages = composeBatchMessages(params.now, filtered, {
      edition: params.edition,
      digestNo: params.digestNo,
      sponsorLines: params.sponsorLines,
      picturesRide: pictures.size > 0,
    });
    const partSegments = messages.map((m) => segmentation(m).segments);
    // One picture message per picture ad IN THIS GROUP's batch — a subscriber
    // never receives a photo for an ad their list didn't carry.
    const groupPictures: BatchPicture[] = filtered
      .filter((ad) => pictures.has(ad.id))
      .map((ad) => ({ adId: ad.id, url: pictures.get(ad.id)!, caption: pictureCaption(ad) }));
    for (const phone of group.phones) {
      recipients++;
      const parts = messages.length + groupPictures.length;
      for (let i = 0; i < messages.length; i++) {
        rows.push({
          digestId: params.digestId,
          channel: "sms",
          address: phone,
          part: i + 1,
          parts,
          body: messages[i],
          segments: partSegments[i],
        });
      }
      groupPictures.forEach((picture, i) => {
        rows.push({
          digestId: params.digestId,
          channel: "sms",
          address: phone,
          part: messages.length + i + 1,
          parts,
          body: picture.caption,
          segments: MMS_SEGMENT_COST,
          media: [picture.url],
        });
      });
    }
  }
  return { rows, recipients, deliveredAdIds };
}

/**
 * Prepare the pictures a batch will broadcast: for each picture ad, its FIRST
 * picture with the ad number stamped into the corner, as an absolute URL
 * Telnyx can fetch.
 *
 * Done ONCE per batch, before any row is built, because the work is a fetch,
 * a sharp render and an upload per ad — per subscriber it would be thousands.
 * Every failure degrades one step at a time: no badge → the clean original;
 * no absolute URL → skip that ad's picture and let its line advertise PIC.
 * A picture problem must never stop the ads going out.
 */
export async function resolveBroadcastPictures(items: StoredAd[]): Promise<Map<number, string>> {
  const pictures = new Map<number, string>();
  for (const ad of items) {
    const first = textedAdPhotos(ad.photo, ad.morePhotos)[0];
    if (!first) continue;
    // Telnyx needs an ABSOLUTE media URL: re-hosted photos already carry one,
    // but a site-relative src (fixtures, pre-re-hosting ads) must be prefixed
    // or the MMS send 400s and nobody gets the picture.
    const absolute = first.src.startsWith("http") ? first.src : `${siteUrl}${first.src}`;
    const badged = await storeBadgedPhoto(absolute, badgeLabel(ad.id));
    pictures.set(ad.id, badged ?? absolute);
  }
  return pictures;
}

/**
 * Catch-up messages for a brand-new subscriber: the most recent batch's ads.
 *
 * Text only, always — a signup burst must never fan out MMS, and someone who
 * just joined has no history to make sense of loose photos anyway. Picture
 * ads advertise PIC, which is exactly what PIC is for here.
 */
export function composeCatchupMessages(items: StoredAd[]): string[] {
  const header = gsmSanitize(`${site.name} - most recent ads:`);
  const adLines = items.flatMap((ad) => ["", gsmSanitize(batchAdLine(ad, false))]);
  return packMessages({ header, adLines, maxGsm: BATCH_MSG_MAX_GSM });
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
  if (pauseBlocks("bulk", settings) || settings.underAttack) return 0;
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
  bumpRecords: { id: number; adId: number }[];
}> {
  const newAds = await getNewDigestAds(cap);
  const bumpRecords: { id: number; adId: number }[] = [];
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
  if (pauseBlocks("bulk", settings)) {
    return { ok: false, reason: "Digest sending is paused (see Settings → System controls)." };
  }
  const selected = await selectDigestItems(settings.digestCap);
  const queuedItems = [...selected.newAds, ...selected.bumpAds];
  if (!queuedItems.length) {
    return { ok: false, reason: "Nothing is queued for a digest right now." };
  }
  // Identify the digest rows FIRST — before any money moves. Both of the
  // early returns below are reachable, and collecting ahead of them would take
  // the money (and text every seller "your ad just went out") for an edition
  // that never gets composed.
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
  // Sponsor lines (item 17) ride the first digest of the day — an early/extra
  // edition counts (and a later scheduled slot then skips them for the day).
  // They ride EVERY recipient's edition regardless of category prefs.
  const sponsors = await listDueSponsors(day);
  const blocked = new Set((await listBlocked()).map((b) => b.phone));
  const subscribers = (await listSubscribersWithCategories()).filter(
    (s) => !blocked.has(s.phone),
  );
  const categoriesByAd = await getAdCategories(queuedItems.map((a) => a.id));
  const emailForReach = await listEmailRecipientsWithCategories();

  // WHO WOULD ACTUALLY GET EACH AD, then COLLECT for exactly those — the same
  // two steps the scheduled batch takes, and for the same reason: an ad every
  // subscriber's categories exclude has not run, so it must not be charged for
  // and its seller must not be texted "your ad just went out to subscribers".
  const wouldReach = new Set(
    buildCategorizedSmsRows({
      digestId: 0,
      now,
      items: queuedItems,
      categoriesByAd,
      edition,
      digestNo: 0,
      sponsorLines: sponsors.map((s) => sponsorLine(s)),
      pictures: new Map<number, string>(),
      recipients: subscribers,
    }).deliveredAdIds,
  );
  for (const ad of queuedItems) {
    if (wouldReach.has(ad.id)) continue;
    const adCategory = categoriesByAd.get(ad.id) ?? null;
    if (emailForReach.some((r) => adMatchesCategories(adCategory, r.categories))) {
      wouldReach.add(ad.id);
    }
  }
  const { payable, unpaid, contended } = await collectForBatch(
    queuedItems.filter((a) => wouldReach.has(a.id)),
    now,
  );
  if (contended) {
    return {
      ok: false,
      reason: "A batch is going out right now — give it a moment and try again.",
    };
  }
  if (!payable.length) {
    return {
      ok: false,
      reason:
        unpaid.length === 1
          ? `The one ad waiting couldn't be paid for (#${unpaid[0].ad.id}). Its seller has been told; it will go out once they pay.`
          : unpaid.length
            ? `None of the ${unpaid.length} ads waiting could be paid for. Their sellers have been told; they go out once they pay.`
            : "Nothing here would reach any subscriber — check the categories on the waiting ads.",
    };
  }
  const carried = new Set(payable.map((a) => a.id));
  const newAds = selected.newAds.filter((a) => carried.has(a.id));
  const bumpAds = selected.bumpAds.filter((a) => carried.has(a.id));
  const bumpRecords = selected.bumpRecords.filter((b) => carried.has(b.adId));
  const items = [...newAds, ...bumpAds];
  const digestNo = await allocateDigestNumber(smsDigestId);
  const pictures = settings.photosInBroadcast
    ? await resolveBroadcastPictures(items)
    : new Map<number, string>();
  const { rows, recipients: smsRecipients, deliveredAdIds } = buildCategorizedSmsRows({
    digestId: smsDigestId,
    now,
    items,
    categoriesByAd,
    edition,
    digestNo,
    sponsorLines: sponsors.map((s) => sponsorLine(s)),
    pictures,
    recipients: subscribers,
  });
  await enqueueDigestOutbox(rows);

  // Reach per ad, and what it cost to deliver. `recipients` is the edition's
  // SMS recipient count and `segments` the total billed segments across the
  // whole edition — deliberately per-EDITION rather than apportioned per ad,
  // because the rows are packed together and splitting the cost between ads
  // would be an invented number. Pair recipients with the per-segment rate and
  // this is what reaching the list actually costs.
  const editionSegments = rows.reduce((sum, r) => sum + (r.segments ?? 0), 0);
  for (const ad of items) {
    if (!deliveredAdIds.has(ad.id)) continue;
    const owner = ad.ownerPhone;
    afterResponse(() =>
      analytics.listingBroadcast({
        phone: owner,
        category: categoriesByAd.get(ad.id) ?? undefined,
        recipients: smsRecipients,
        segments: editionSegments,
        isMms: settings.photosInBroadcast,
      }),
    );
  }

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
    // The warned-dark empty set gets nothing — not even a sponsor-only edition.
    if (r.categories && r.categories.length === 0) continue;
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

  // Bookkeeping: early consumes the queue exactly like the scheduled run —
  // but ONLY what was actually delivered: ads that landed in ≥1 SMS group's
  // edition, plus ads the email edition (composed above) carries. Anything
  // undelivered keeps broadcast_at null / bumps queued and rides the next
  // slot. extra records its contents and consumes nothing.
  if (edition === "early") {
    const consumed = new Set(deliveredAdIds);
    for (const ad of items) {
      if (consumed.has(ad.id)) continue;
      const adCategory = categoriesByAd.get(ad.id) ?? null;
      if (recipients.some((r) => adMatchesCategories(adCategory, r.categories))) {
        consumed.add(ad.id);
      }
    }
    await finalizeDigest(
      smsDigestId,
      newAds.filter((a) => consumed.has(a.id)).map((a) => a.id),
      bumpRecords.filter((b) => consumed.has(b.adId)).map((b) => b.id),
      consumed.size,
      items.filter((a) => consumed.has(a.id)).map((a) => a.id),
    );
    await finalizeDigest(emailDigestId, [], [], consumed.size);
  } else {
    await finalizeExtraDigest(smsDigestId, items.map((a) => a.id), items.length);
    await finalizeExtraDigest(emailDigestId, [], items.length);
  }

  // Sponsor days consumed after the bookkeeping (crash-safe, same as the
  // scheduled run) — and only when SOME edition actually went out, so a paid
  // sponsor day is never burned on a slot nobody received. The email mirror
  // was composed above with the sponsors in hand, so the recorded key just
  // needs to be unique — the slot-key lookup in runDueEmailDigests never
  // applies here (its email digest is already final).
  if (rows.length || emailRows.length) {
    for (const s of sponsors) {
      await markSponsorRan(s.id, day, `sent-now#${smsDigestId}`);
    }
  }

  // One event per EDITION, under the operator's identity — not one per
  // recipient. Per recipient this would be four hundred events for one send
  // and would drown every other number in the property.
  if (emailRows.length) {
    const sentCount = emailRows.length;
    afterResponse(() =>
      analytics.emailEditionSent({
        operatorPhone: site.smsNumberPlain,
        recipients: sentCount,
        listingCount: items.length,
        slotHour,
      }),
    );
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

/**
 * Everything the window rules need. `smsSaturdayEndHour` is OPTIONAL on
 * purpose: a caller holding settings saved before session 020 (or a test
 * pinning the plain window) simply gets the published end hour on Saturday
 * too, rather than a Saturday that never opens.
 */
export type WindowSettings = Pick<
  EngineSettings,
  "smsWindowStartHour" | "smsWindowEndHour" | "smsQuietDays"
> &
  Partial<Pick<EngineSettings, "smsSaturdayEndHour">>;

/** ET weekday index for Saturday — the day that closes early. */
export const SATURDAY = 6;

/**
 * The hour sending really stops on a given ET weekday, end EXCLUSIVE.
 *
 * Every day but Saturday closes at the published `smsWindowEndHour`. Saturday
 * closes at `smsSaturdayEndHour` — the unpublished shortening (session 020,
 * user decision: "publish 7am to 6pm Monday to Saturday but secretly stop
 * sending ads by 5pm on Saturdays"), because a Plain audience's Saturday
 * evening runs into the rest day.
 *
 * `Math.min` is the safety rail, not a nicety: the Saturday hour may only ever
 * pull the close EARLIER. A fat-fingered 20 on /admin/settings would otherwise
 * text people past the hours the compliance copy promises every subscriber —
 * a shortening is a courtesy, an extension is a broken promise.
 */
export function windowEndHourFor(weekday: number, settings: WindowSettings): number {
  const published = settings.smsWindowEndHour;
  if (weekday !== SATURDAY) return published;
  const saturday = settings.smsSaturdayEndHour;
  if (typeof saturday !== "number" || !Number.isFinite(saturday)) return published;
  return Math.min(saturday, published);
}

/** Whether Saturday's real close is earlier than the published one at all. */
export function saturdayClosesEarly(settings: WindowSettings): boolean {
  return windowEndHourFor(SATURDAY, settings) < settings.smsWindowEndHour;
}

/**
 * The SMS send window. Session 016 set the shape, in the user's words: "any
 * ads will send any time after they're approved, and they'll send anytime
 * after 7am until [the close], Monday through Saturday." Start hour
 * inclusive, end hour EXCLUSIVE, and quiet days (Sunday by default) never
 * send. All hours America/New_York. Pure so the boundaries are unit-testable
 * without a clock.
 *
 * Session 020 moved the published close from 9pm to 6pm and gave Saturday its
 * own, earlier one — so the end hour is per-weekday now (windowEndHourFor).
 */
export function smsWindowOpen(now: Date, settings: WindowSettings): boolean {
  const { day, hour } = etParts(now);
  const weekday = etWeekday(day);
  if (settings.smsQuietDays.includes(weekday)) return false;
  return hour >= settings.smsWindowStartHour && hour < windowEndHourFor(weekday, settings);
}

/**
 * True in the hour(s) when the engine has ALREADY shut for the day but the
 * published window still says it is open — i.e. Saturday between the real
 * close and `smsWindowEndHour`.
 *
 * Member-facing copy uses this to stay quiet about the hours. "It goes out
 * Monday at 7am — texts only go out between 7am and 6pm, Monday through
 * Saturday" is a sentence that argues with itself at 5:30pm on a Saturday,
 * and a seller who notices has been handed the very thing the shortening is
 * meant to keep to ourselves. When this is true, say WHEN the ad goes and
 * skip the hours; the promise is still kept, it just isn't recited.
 */
export function closedEarly(now: Date, settings: WindowSettings): boolean {
  const { day, hour } = etParts(now);
  const weekday = etWeekday(day);
  if (settings.smsQuietDays.includes(weekday)) return false;
  if (hour < settings.smsWindowStartHour) return false;
  return hour >= windowEndHourFor(weekday, settings) && hour < settings.smsWindowEndHour;
}

/**
 * The window as the OPERATOR needs to read it — the truth, Saturday included.
 * Admin surfaces only: this is the one place the shortening is spelled out,
 * because an operator who doesn't know Saturday closes at five will file the
 * quiet hour as a bug and go looking for it.
 */
export function operatorWindowLabel(settings: WindowSettings): string {
  const open = hourLabel(settings.smsWindowStartHour);
  const published = hourLabel(settings.smsWindowEndHour);
  if (!saturdayClosesEarly(settings)) return `${open}–${published}, Mon–Sat`;
  const end = windowEndHourFor(SATURDAY, settings);
  // A close at or before the open hour means Saturday never sends at all —
  // say THAT. Rendering the hour would print "7am–12am Sat" for a stored 0,
  // which reads like a close at midnight: the exact opposite of a Saturday
  // that is switched off, and the operator would never go looking.
  if (end <= settings.smsWindowStartHour) {
    return `${open}–${published} Mon–Fri · no Saturday sending`;
  }
  return `${open}–${published} Mon–Fri · ${open}–${hourLabel(end)} Sat`;
}

/**
 * When the next text can go out, in words a seller can act on: "in a few
 * minutes" while the window is open, otherwise the next opening ("at 7am",
 * "tomorrow at 7am", "Monday at 7am"). Answers the question every seller who
 * texts an ad at 5am will have. Pure — the caller supplies the clock.
 */
export function nextSendLabel(now: Date, settings: WindowSettings): string {
  if (smsWindowOpen(now, settings)) return "in a few minutes";
  const { day, hour } = etParts(now);
  const openLabel = hourLabel(settings.smsWindowStartHour);
  const today = etWeekday(day);
  // Before opening on a day that sends: later this morning.
  if (hour < settings.smsWindowStartHour && !settings.smsQuietDays.includes(today)) {
    return `at ${openLabel}`;
  }
  // Otherwise walk forward to the next day that sends.
  for (let ahead = 1; ahead <= 7; ahead++) {
    const weekday = (today + ahead) % 7;
    if (settings.smsQuietDays.includes(weekday)) continue;
    return ahead === 1
      ? `tomorrow at ${openLabel}`
      : `${DAY_NAMES[weekday]} at ${openLabel}`;
  }
  return `at ${openLabel}`; // every day is quiet — nonsense config, say something sane
}

/**
 * How long a seller should expect to wait for the batch their approved ad
 * will ride, in words. "Right away" is no longer true (session 018) and a
 * seller who was told "going out now" and then waited forty minutes has been
 * lied to; this is the honest version, built from the same settings the
 * trigger uses.
 */
export function batchWaitLabel(
  settings: Pick<EngineSettings, "batchMinAds" | "batchMaxWaitMinutes">,
): string {
  const minutes = Math.max(0, Math.floor(settings.batchMaxWaitMinutes || 0));
  if (!minutes) return "with the next batch of ads";
  if (minutes < 60) return `with the next batch of ads, within ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1
    ? "with the next batch of ads, usually within the hour"
    : `with the next batch of ads, within about ${hours} hours`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 7 -> "7am", 13 -> "1pm", 0 -> "12am". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/** Day-of-week (0 = Sunday) for an ET calendar day "YYYY-MM-DD". Noon UTC
 * keeps the date from sliding either way across a timezone. */
export function etWeekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/**
 * Compose ONE SMS batch — a set of ads packed per category group, enqueued to
 * the outbox for delivery, with a picture message per picture ad behind it.
 * The machinery (category packing, sponsor lines, the blocklist, outbox
 * dedup) is the digest's, unchanged, because all of it was always
 * per-edition rather than per-schedule. `slotKey` is what makes a batch
 * idempotent: composing the same key twice is a no-op.
 */
async function composeSmsEdition(args: {
  items: StoredAd[];
  bumpRecords?: { id: number; adId: number }[];
  /** The batch's idempotency key, computed from what is ACTUALLY going out —
   * see the comment at the call site inside this function. */
  slotKeyFor: (carried: StoredAd[], bumps: { id: number; adId: number }[]) => string;
  slotHour: number;
  now: Date;
  settings: EngineSettings;
}): Promise<SlotResult> {
  const { items, slotHour, now } = args;
  const { day } = etParts(now);
  if (!items.length) return { slotKey: args.slotKeyFor([], []), items: 0, recipients: 0, skipped: true };

  // Business sponsor lines (item 17, reworked session 016): each scheduled
  // sponsor rides ONE ad text a day — "a ride once a day, throughout the
  // day" — so a batch carries at most ONE sponsor and the day's sponsors
  // spread across the day's batches instead of stacking on the 7am text.
  // listDueSponsors already excludes packages that rode today and those
  // whose reserved week isn't running.
  const sponsors = (await listDueSponsors(day)).slice(0, 1);
  // Blocked numbers get no broadcast (the drain sends via the raw transport,
  // so filtering here is the blocklist's enforcement point).
  const blocked = new Set((await listBlocked()).map((b) => b.phone));
  const subscribers = (await listSubscribersWithCategories()).filter(
    (s) => !blocked.has(s.phone),
  );
  const categoriesByAd = await getAdCategories(items.map((a) => a.id));
  const emailRecipients = await listEmailRecipientsWithCategories();

  // WHO WOULD ACTUALLY GET EACH AD — worked out BEFORE any money moves and
  // before a single picture is badged (session 021).
  //
  // buildCategorizedSmsRows is pure, so running it twice costs nothing but a
  // little string packing, and it is the only honest answer to "will this ad
  // reach anybody in this batch?". Category filtering means some ads reach
  // nobody, and an ad that reaches nobody has not RUN — charging for it would
  // be taking money for a service that did not happen, which is the exact
  // thing this session exists to stop. The digest id and number are 0 here and
  // the pictures are left out: both change what a message CARRIES, never which
  // ads are in it.
  const wouldReach = new Set(
    buildCategorizedSmsRows({
      digestId: 0,
      now,
      items,
      categoriesByAd,
      digestNo: 0,
      sponsorLines: sponsors.map((s) => sponsorLine(s)),
      pictures: new Map<number, string>(),
      recipients: subscribers,
    }).deliveredAdIds,
  );
  for (const ad of items) {
    if (wouldReach.has(ad.id)) continue;
    // An ad no SMS group carries but an email recipient matches still runs —
    // the email edition carries texted-but-unemailed ads.
    const adCategory = categoriesByAd.get(ad.id) ?? null;
    if (emailRecipients.some((r) => adMatchesCategories(adCategory, r.categories))) {
      wouldReach.add(ad.id);
    }
  }

  // THE MONEY MOVES HERE, for exactly the ads about to go out. An ad we cannot
  // collect for is dropped from the batch: it keeps broadcast_at null, holds
  // its place, and rides a later batch once the seller pays.
  const { payable, contended } = await collectForBatch(
    items.filter((a) => wouldReach.has(a.id)),
    now,
  );
  if (contended) {
    // Another pass is already collecting for one of these ads and composing a
    // batch around it. Bow out entirely rather than composing a second batch
    // from the leftovers — every ad with nothing owing would be in both, and
    // subscribers would get it twice.
    return { slotKey: "contended", items: 0, recipients: 0, skipped: true };
  }
  const carried = payable;
  const carriedBumps = (args.bumpRecords ?? []).filter((b) =>
    carried.some((a) => a.id === b.adId),
  );
  if (!carried.length) return { slotKey: "unpayable", items: 0, recipients: 0, skipped: true };

  // ⚠️ THE KEY NAMES THE HEAD OF WHAT IS GOING OUT, not of what was selected,
  // and that distinction is a bug fix rather than a detail.
  //
  // Keyed on the selected head, an ad that could never be paid for poisoned
  // the queue permanently: the first batch composed the ads BEHIND it under
  // key `batch#<unpayable>#0` and finalized, and from then on every pass whose
  // head was that same stuck ad computed the same finalized key and skipped —
  // so nothing ever sent again. Keying on what actually goes out means a
  // different batch always gets a different key.
  const slotKey = args.slotKeyFor(carried, carriedBumps);
  const { id: digestId, finalized } = await createDigestIfAbsent(slotKey, slotHour);
  // finalized = this batch was fully composed+enqueued already. A row that
  // exists but never finalized means a previous run died mid-enqueue — fall
  // through and redo it (the outbox unique key dedups the rows).
  if (finalized) return { slotKey, items: 0, recipients: 0, skipped: true };
  const digestNo = await allocateDigestNumber(digestId);

  // Badge and stage the pictures ONCE for the whole batch, before any row is
  // built — see resolveBroadcastPictures. Only for the ads actually going out,
  // so an unpaid ad never costs an image render either.
  const pictures = args.settings.photosInBroadcast
    ? await resolveBroadcastPictures(carried)
    : new Map<number, string>();
  const { rows, recipients, deliveredAdIds } = buildCategorizedSmsRows({
    digestId,
    now,
    items: carried,
    categoriesByAd,
    digestNo,
    sponsorLines: sponsors.map((s) => sponsorLine(s)),
    pictures,
    recipients: subscribers,
  });
  const queued = await enqueueDigestOutbox(rows);
  // Consume ONLY delivered ads: an ad every SMS group filtered out keeps
  // broadcast_at null and is retried, rather than being silently marked sent.
  const consumed = new Set(deliveredAdIds);
  for (const ad of carried) {
    if (consumed.has(ad.id)) continue;
    const adCategory = categoriesByAd.get(ad.id) ?? null;
    if (emailRecipients.some((r) => adMatchesCategories(adCategory, r.categories))) {
      consumed.add(ad.id);
    }
  }
  await finalizeDigest(
    digestId,
    carried.filter((a) => consumed.has(a.id)).map((a) => a.id),
    carriedBumps.filter((b) => consumed.has(b.adId)).map((b) => b.id),
    consumed.size,
    carried.filter((a) => consumed.has(a.id)).map((a) => a.id),
  );
  // Consume each sponsor's paid day only after the batch is enqueued and
  // finalized: a crash mid-compose leaves the day uncounted and the redo
  // picks the sponsors up again (the outbox unique key dedups). Skipped when
  // nothing was delivered — a paid sponsor day must not burn on an
  // undelivered batch.
  if (rows.length || consumed.size) {
    for (const s of sponsors) {
      await markSponsorRan(s.id, day, slotKey);
    }
  }
  return { slotKey, items: consumed.size, recipients, queued, skipped: false };
}

/**
 * The batch's idempotency key: the head of the queue it was built from.
 *
 * It has to be STABLE for a given queue (two overlapping cron ticks must
 * compose the same key, or both would enqueue the same ads and every
 * subscriber would get the batch twice) and UNIQUE across batches (a key that
 * repeats would be skipped as already-sent). The head new ad is stable —
 * it stays the head until it is consumed, and once consumed it can never head
 * another batch. The head BUMP id joins it because an admin re-run of an ad
 * that already broadcast would otherwise reuse its old key and be swallowed;
 * bump ids are fresh per re-run.
 */
export function batchSlotKey(newAdId: number | null, bumpId: number | null): string {
  return `batch#${newAdId ?? 0}#${bumpId ?? 0}`;
}

/**
 * Is there a batch to send right now? (User decision, session 018: "I'll run
 * the batch every hour, or as soon as I have 3 or 4 ads.")
 *
 * Two triggers, whichever comes first:
 *  - COUNT: `batchMinAds` are waiting. What makes a busy morning feel live.
 *  - AGE: the oldest has waited `batchMaxWaitMinutes`. What stops a lone ad
 *    sitting all day because nothing else came in — and, at the top of the
 *    morning, what empties the overnight queue.
 *
 * Setting either to 0 turns that trigger off; with both off nothing would ever
 * send, so a zero pair falls back to sending whatever is waiting (the least
 * surprising reading of an obvious misconfiguration — an ad the seller paid
 * for must never be stranded by a typo in Settings).
 *
 * Pure: the caller supplies the clock, so every boundary is unit-testable.
 */
export function batchReady(
  queued: { approvedAt?: string; createdAt: string }[],
  now: Date,
  settings: Pick<EngineSettings, "batchMinAds" | "batchMaxWaitMinutes">,
): boolean {
  if (!queued.length) return false;
  const minAds = Math.max(0, Math.floor(settings.batchMinAds || 0));
  const maxWait = Math.max(0, Math.floor(settings.batchMaxWaitMinutes || 0));
  if (!minAds && !maxWait) return true;
  if (minAds && queued.length >= minAds) return true;
  if (!maxWait) return false;
  // The queue is ordered oldest-first, but don't trust the caller's ordering
  // for a decision this cheap to make correctly.
  const oldest = Math.min(
    ...queued.map((ad) => Date.parse(ad.approvedAt ?? ad.createdAt)).filter(Number.isFinite),
  );
  if (!Number.isFinite(oldest)) return true; // unparseable timestamps: send, don't strand
  return now.getTime() - oldest >= maxWait * 60_000;
}

/**
 * Send the waiting ads as ONE BATCH (user decision, session 018 — restoring
 * batching, which instant send replaced in session 016): one text listing
 * every ad in the batch by ad number, then one picture message per picture
 * ad. Called on approval — so a batch can go the moment the count is met —
 * and on every cron tick, which is what applies the hourly trigger and drains
 * the overnight and Sunday queue when the window opens.
 *
 * ONE batch per pass, deliberately: a backlog of thirty ads goes out as
 * successive batches over successive ticks, never as one thirty-ad wall.
 *
 * `force` skips the window and readiness checks: the operator's "send now" on
 * /admin/digests.
 */
export async function runQueuedBroadcasts(
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<SlotResult[]> {
  const settings = await getEngineSettings();
  if (!opts.force && !smsWindowOpen(now, settings)) return [];
  const { hour } = etParts(now);
  // digestCap bounds ONE batch, not the day: whatever is left rides the next
  // tick, so a flood can never blow the function's time budget — or a
  // subscriber's screen.
  const { newAds, bumpAds, bumpRecords } = await selectDigestItems(settings.digestCap);
  const items = [...newAds, ...bumpAds];
  if (!items.length) return [];
  if (!opts.force && !batchReady(newAds.length ? newAds : items, now, settings)) return [];
  // Collecting for the ads happens inside composeSmsEdition, at the point
  // where it is known which ads actually reach somebody (session 021). It is
  // NOT done here: an ad that every subscriber's category filter excludes has
  // not run, and must not be charged for.
  const results: SlotResult[] = [
    await composeSmsEdition({
      items,
      bumpRecords,
      slotKeyFor: (carried, bumps) =>
        batchSlotKey(
          newAds.find((a) => carried.some((c) => c.id === a.id))?.id ?? null,
          bumps[0]?.id ?? null,
        ),
      slotHour: hour,
      now,
      settings,
    }),
  ];
  return results;
}

/**
 * Send every ADMIN BROADCAST that is due (session 020, user request; migration
 * 9952) — the operator's own text, one individual message to every SMS
 * subscriber, inside the send window only.
 *
 * The window check is the user's "only during active hours" and it is enforced
 * HERE, at compose, as well as at drain. Building the rows early would stamp a
 * paced-release schedule across hours nothing could send in, and the whole
 * broadcast would then trickle out from the moment the window opened rather
 * than going together.
 *
 * `claimAdminMessage` is the concurrency guard: it flips 'scheduled' to 'sent'
 * and reports whether THIS caller won, so two overlapping cron ticks cannot
 * both text four hundred people. Compose only on a true, and hand the claim
 * back if composing fails — a broadcast marked sent that nobody received is
 * the one outcome with no way to notice.
 *
 * Categories are deliberately NOT applied. A category preference is about
 * which ADS a member wants; a note from the operator about the service itself
 * goes to everyone who is still subscribed. The blocklist IS applied, at
 * compose and again at drain.
 */
export async function runDueAdminMessages(now = new Date()): Promise<SlotResult[]> {
  const settings = await getEngineSettings();
  // Pauses stop bulk sending, and a broadcast is as bulk as it gets.
  if (pauseBlocks("bulk", settings)) return [];
  const windowOpen = smsWindowOpen(now, settings);
  const due = await listDueAdminMessages(now.toISOString());
  const results: SlotResult[] = [];

  for (const message of due) {
    if (!adminMessageDue(message, now, windowOpen)) continue;
    const slotKey = adminMessageSlotKey(message.id);
    if (!(await claimAdminMessage(message.id))) continue; // another tick has it
    try {
      const { hour } = etParts(now);
      const { id: digestId, finalized } = await createDigestIfAbsent(slotKey, hour);
      if (finalized) {
        results.push({ slotKey, items: 0, recipients: 0, skipped: true });
        continue;
      }
      const body = gsmSanitize(message.body);
      const blocked = new Set((await listBlocked()).map((b) => b.phone));
      const subscribers = (await listSubscribersWithCategories()).filter(
        (s) => !blocked.has(s.phone),
      );
      const segments = segmentation(body).segments;
      const rows: OutboxInsert[] = subscribers.map((s) => ({
        digestId,
        channel: "sms" as const,
        address: s.phone,
        part: 1,
        parts: 1,
        body,
        segments,
      }));
      const queued = await enqueueDigestOutbox(rows);
      await finalizeDigest(digestId, [], [], 0);
      await recordAdminMessageSend(
        message.id,
        digestId,
        rows.length,
        segments * rows.length,
      );
      console.log(
        `[digest] admin broadcast #${message.id}: ${rows.length} recipients, ` +
          `${segments * rows.length} segments`,
      );
      results.push({ slotKey, items: 1, recipients: rows.length, queued, skipped: false });
    } catch (e) {
      // Give the claim back so the next tick retries. Without this a transient
      // database blip would mark the broadcast sent forever.
      console.error(`[digest] admin broadcast #${message.id} failed to compose:`, e);
      await releaseAdminMessage(message.id).catch(() => {});
    }
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
  //
  // The SEND WINDOW is enforced here as well as at compose. It used to be
  // checked only when composing, which is fine while rows are created and
  // drained minutes apart — but a queue that has been HELD (an ads pause, a
  // tripped budget, an outage) empties the instant the hold lifts, whatever
  // the hour. Resume a pause at 6am and every stored-up ad would have gone
  // out at 6am, breaking the published send window the compliance copy makes
  // to every subscriber. SMS rows wait for the window (Saturday's earlier
  // close included); EMAIL rows are exempt,
  // since the window is an SMS courtesy and an inbox has no bedtime.
  const paused = pauseBlocks("bulk", settings);
  // Taken at the START of the run, and used ONLY for the pacing decision
  // below. The per-row send gate re-reads the clock (windowShutNow) — see
  // there for why a single snapshot is not good enough.
  const windowShutAtStart = !smsWindowOpen(new Date(startedAt), settings);

  // Paced release (session 016, user decision): before claiming anything,
  // give a BACKLOG its release times. Stamping here rather than at the moment
  // a pause lifts means every way a queue can back up is covered — a pause, an
  // outage, the overnight window, a tripped budget — not just the one we
  // thought of. It is idempotent (only ever stamps rows with no release time),
  // so overlapping cron ticks can't re-roll a schedule that is part-sent.
  //
  // Skipped while paused or outside the window: scheduling a spread that
  // starts before sending is even allowed would waste most of the gaps on
  // time nothing could have sent in anyway.
  if (!paused && !windowShutAtStart) {
    const { min, max } = safeGapRange(settings);
    try {
      const paced = await stampReleaseSchedule(settings.pacedReleaseOver, min, max);
      if (paced > 0) {
        console.log(
          `[digest] pacing a backlog of ${paced} ads at ${min}-${max} minute gaps`,
        );
      }
    } catch (e) {
      // Never let scheduling stop sending: the un-paced behaviour is the old
      // behaviour, which is worse but not broken.
      console.error("[digest] could not stamp a release schedule:", e);
    }
  }
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
      // Re-read the clock per chunk rather than once per run. A drain gets up
      // to 45 seconds, so a run that starts at 4:59:55pm on a Saturday would
      // otherwise keep texting straight through the 5pm close on a snapshot
      // taken before it — the close is the whole point, and "within a minute"
      // is not closed. Checking per chunk bounds the overrun to the handful of
      // sends already in flight. smsWindowOpen is pure and cheap.
      const windowShutNow = !smsWindowOpen(new Date(), settings);
      await Promise.all(
        chunk.map(async (row) => {
          // Outside the send window an SMS row is left claimed and released
          // at the end of the run, exactly like a budget-deferred row — so
          // the claim still reaches the email rows behind it, and the text
          // goes out on the next tick after the window opens.
          if (row.channel === "sms" && windowShutNow) {
            deferredSms.push(row.id);
            return;
          }
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
  // media = a picture ad riding out with its photo (MMS).
  await sms.send(row.address, row.body, row.media?.length ? row.media : undefined);
}
