/**
 * The email edition: at each email slot, compose everything the SMS digests
 * carried since the last email — minus ads no longer available — with
 * pictures inline, and enqueue one outbox row per recipient. Delivery rides
 * the same drained outbox as the SMS digests (bounded batches, resumable),
 * with the same idempotency guarantees.
 */
import { siteUrl, unsubscribeUrl } from "@/lib/email";
import { type SlotResult } from "@/lib/digest-engine";
import { etParts } from "@/lib/et";
import { deriveTitle, deriveRest } from "@/lib/ads";
import {
  createDigestIfAbsent,
  enqueueDigestOutbox,
  finalizeDigest,
  getAdRecord,
  getLastEmailDigestAt,
  getSmsAdIdsSince,
  type OutboxInsert,
  type StoredAd,
} from "@/lib/engine-store";
import { listEmailRecipients } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { site } from "@/lib/config";

/** CAN-SPAM requires a physical mailing address in every message. */
const BUSINESS_ADDRESS = "The Plain Exchange · PO Box 000 · Millersburg, OH 44654";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function composeEmailHtml(ads: StoredAd[], dateLabel: string, unsubHref: string): string {
  const rows = ads
    .map((ad) => {
      const photo = ad.photo
        ? `<img src="${siteUrl}${ad.photo.src}" alt="${esc(ad.photo.alt)}" width="280" style="max-width:100%;height:auto;border:1px solid #ddd;margin:8px 0 0;" />`
        : "";
      // The title already shows the lead clause (the whole body for a
      // single-clause ad); only render the excerpt when there's a real
      // remainder, else "|| ad.body" reprinted the full body twice.
      const rest = deriveRest(ad.body);
      return `<div style="padding:14px 0;border-bottom:1px solid #ddd;">
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:#20262b;">
          <a href="${siteUrl}/ad/${ad.id}" style="color:#20262b;text-decoration:none;">${esc(deriveTitle(ad.body))}</a>
        </p>
        ${rest ? `<p style="margin:4px 0 0;font-size:16px;color:#20262b;line-height:1.5;">${esc(rest)}</p>` : ""}
        ${photo}
        <p style="margin:6px 0 0;font-size:13px;color:#5b6670;">Ad #${ad.id} · <a href="${siteUrl}/ad/${ad.id}" style="color:#2d5570;">view on the website</a></p>
      </div>`;
    })
    .join("");

  return `<div style="margin:0 auto;max-width:600px;padding:16px;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;">
    <p style="margin:0;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:600;color:#20262b;">${site.name}</p>
    <p style="margin:2px 0 12px;text-align:center;font-size:13px;color:#5b6670;">${esc(dateLabel)} · ${site.region}</p>
    <div style="border-top:3px solid #3a4550;border-bottom:1px solid #3a4550;height:2px;margin-bottom:4px;"></div>
    ${rows}
    <p style="margin:16px 0 4px;font-size:13px;color:#5b6670;">
      Get the ads by text too — text SUBSCRIBE to ${site.smsNumber}.
    </p>
    <p style="margin:8px 0 0;font-size:12px;color:#5b6670;">
      ${esc(BUSINESS_ADDRESS)} · <a href="${unsubHref}" style="color:#2d5570;">Unsubscribe</a>
    </p>
  </div>`;
}

export function composeEmailText(ads: StoredAd[], dateLabel: string, unsubHref: string): string {
  const lines = [
    `${site.name} — ${dateLabel}`,
    "",
    ...ads.map((ad) => `#${ad.id} ${ad.body}\n${siteUrl}/ad/${ad.id}`),
    "",
    `Get the ads by text too — text SUBSCRIBE to ${site.smsNumber}.`,
    BUSINESS_ADDRESS,
    `Unsubscribe: ${unsubHref}`,
  ];
  return lines.join("\n");
}

export async function runDueEmailDigests(now = new Date()): Promise<SlotResult[]> {
  const { day, hour } = etParts(now);
  const settings = await getEngineSettings();
  const results: SlotResult[] = [];

  for (const slot of settings.emailSlots) {
    if (hour < slot) continue;
    const slotKey = `${day}#email#${slot}`;
    const { id: digestId, finalized } = await createDigestIfAbsent(slotKey, slot, "email");
    // Not finalized = a previous run died mid-enqueue; redo it (outbox dedups).
    if (finalized) continue;

    const watermark = await getLastEmailDigestAt(digestId);
    const carriedIds = await getSmsAdIdsSince(watermark);
    const ads: StoredAd[] = [];
    for (const id of carriedIds) {
      const ad = await getAdRecord(id);
      if (ad && ad.status === "approved") ads.push(ad); // still-available only
    }
    ads.sort((a, b) => a.id - b.id);

    if (!ads.length) {
      await finalizeDigest(digestId, [], [], 0);
      results.push({ slotKey, items: 0, recipients: 0, skipped: true });
      continue;
    }

    const dateLabel = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    const subject = `${site.name} — ${ads.length} new ad${ads.length === 1 ? "" : "s"}, ${dateLabel}`;
    const recipients = await listEmailRecipients();
    const rows: OutboxInsert[] = recipients.map((to) => {
      const unsub = unsubscribeUrl(to); // personalized (signed) per recipient
      return {
        digestId,
        channel: "email" as const,
        address: to,
        part: 1,
        parts: 1,
        subject,
        body: composeEmailText(ads, dateLabel, unsub),
        html: composeEmailHtml(ads, dateLabel, unsub),
        segments: 0, // email costs no SMS segments — exempt from the budget
      };
    });
    const queued = await enqueueDigestOutbox(rows);
    await finalizeDigest(digestId, [], [], ads.length);
    results.push({
      slotKey,
      items: ads.length,
      recipients: recipients.length,
      queued,
      skipped: false,
    });
  }

  return results;
}
