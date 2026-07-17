/**
 * The email edition mirrors the SMS digests 1:1 (user decision, session 007):
 * it composes at the SAME slots, and each email carries exactly the ads of
 * that slot's SMS digest — minus ads no longer available — with pictures
 * inline. One outbox row per recipient; delivery rides the same drained
 * outbox as the SMS digests (bounded batches, resumable), with the same
 * idempotency guarantees.
 */
import { siteUrl, unsubscribeUrl } from "@/lib/email";
import { type SlotResult } from "@/lib/digest-engine";
import { etParts } from "@/lib/et";
import { deriveTitle, deriveRest } from "@/lib/ads";
import { composeEmailSubject } from "@/lib/ad-display";
import {
  createDigestIfAbsent,
  enqueueDigestOutbox,
  finalizeDigest,
  getAdCategories,
  getAdRecord,
  getSmsDigestAdIds,
  getSmsDigestNumber,
  type OutboxInsert,
  type StoredAd,
} from "@/lib/engine-store";
import { listEmailRecipientsWithCategories } from "@/lib/store";
import { adMatchesCategories } from "@/lib/categories";
import { getEngineSettings } from "@/lib/settings";
import { site } from "@/lib/config";
import { listSponsorsRanWithKey } from "@/lib/business";
import { formatPhone } from "@/lib/phone";

/** A business sponsor riding this edition (FEATURES item 17) — the fields the
 * email needs; lib/business's BusinessPackage satisfies it. */
export interface SponsorAd {
  businessName: string;
  adText: string;
  link: string | null;
  phone: string | null;
}

/** CAN-SPAM requires a physical mailing address in every message. */
const BUSINESS_ADDRESS = "The Plain Exchange · PO Box 000 · Millersburg, OH 44654";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function composeEmailHtml(
  ads: StoredAd[],
  dateLabel: string,
  unsubHref: string,
  sponsors: SponsorAd[] = [],
): string {
  // The email edition mirrors the SMS digest's sponsor line (item 17) —
  // clearly labeled, above the member ads, with the link clickable here.
  const sponsorRows = sponsors
    .map((s) => {
      const contact = [
        s.phone ? esc(formatPhone(s.phone)) : "",
        s.link
          ? `<a href="${esc(s.link.startsWith("http") ? s.link : `https://${s.link}`)}" style="color:#2d5570;">${esc(s.link)}</a>`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div style="padding:10px 12px;margin:10px 0 0;border:1px solid #c9b458;background:#fdf9ec;">
        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7a2e;">Sponsor</p>
        <p style="margin:2px 0 0;font-size:16px;color:#20262b;"><strong>${esc(s.businessName)}</strong> — ${esc(s.adText)}</p>
        ${contact ? `<p style="margin:4px 0 0;font-size:13px;color:#5b6670;">${contact}</p>` : ""}
      </div>`;
    })
    .join("");
  const rows = ads
    .map((ad) => {
      // Re-hosted photos carry an absolute URL (Supabase Storage); only
      // site-relative fixture paths still need the siteUrl prefix.
      const photoSrc = ad.photo
        ? ad.photo.src.startsWith("http")
          ? ad.photo.src
          : `${siteUrl}${ad.photo.src}`
        : "";
      const photo = ad.photo
        ? `<img src="${photoSrc}" alt="${esc(ad.photo.alt)}" width="280" style="max-width:100%;height:auto;border:1px solid #ddd;margin:8px 0 0;" />`
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
    ${sponsorRows}
    ${rows}
    <p style="margin:16px 0 4px;font-size:13px;color:#5b6670;">
      Get the ads by text too — text SUBSCRIBE to ${site.smsNumber}.
    </p>
    <p style="margin:8px 0 0;font-size:12px;color:#5b6670;">
      ${esc(BUSINESS_ADDRESS)} · <a href="${unsubHref}" style="color:#2d5570;">Unsubscribe</a>
    </p>
  </div>`;
}

export function composeEmailText(
  ads: StoredAd[],
  dateLabel: string,
  unsubHref: string,
  sponsors: SponsorAd[] = [],
): string {
  const lines = [
    `${site.name} — ${dateLabel}`,
    "",
    ...sponsors.map(
      (s) =>
        `Sponsor: ${s.businessName} - ${s.adText}` +
        `${s.phone ? ` ${formatPhone(s.phone)}` : ""}${s.link ? ` ${s.link}` : ""}`,
    ),
    ...(sponsors.length ? [""] : []),
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

  // Same slots as the SMS digests — the email edition is their mirror.
  for (const slot of settings.slots) {
    if (hour < slot) continue;
    const slotKey = `${day}#email#${slot}`;
    const { id: digestId, finalized } = await createDigestIfAbsent(slotKey, slot, "email");
    // Not finalized = a previous run died mid-enqueue; redo it (outbox dedups).
    if (finalized) continue;

    // Exactly this slot's SMS digest. null = it hasn't composed yet (the SMS
    // pass runs first in the same cron tick, but it can fail mid-run) — leave
    // this email slot un-finalized so the next tick retries, rather than
    // sending an empty or incomplete edition.
    const carriedIds = await getSmsDigestAdIds(`${day}#${slot}`);
    if (carriedIds === null) {
      results.push({ slotKey, items: 0, recipients: 0, skipped: true });
      continue;
    }
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

    // The email edition mirrors its SMS digest's number (FEATURES item 5)
    // and its sponsor lines (item 17): whatever sponsors rode THIS slot's SMS
    // digest (recorded by slot key at markSponsorRan) appear here too, with
    // the link clickable. [] pre-migration or on sponsor-free days.
    const sponsors = await listSponsorsRanWithKey(`${day}#${slot}`);
    const digestNo = await getSmsDigestNumber(`${day}#${slot}`);
    const dateLabel =
      now.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "America/New_York",
      }) + (digestNo ? ` · Digest No. ${digestNo}` : "");
    const recipients = await listEmailRecipientsWithCategories();
    // Per-recipient category filtering (item 22) — the email edition carries
    // only the recipient's categories' ads, plus every uncategorized ad; the
    // sponsor lines ride every edition regardless. Pre-9976 the category map
    // is empty and prefs read ALL, so every recipient gets the full mirror.
    const categoriesByAd = await getAdCategories(ads.map((a) => a.id));
    const rows: OutboxInsert[] = [];
    for (const r of recipients) {
      // The warned-dark empty set gets nothing — not even sponsor lines
      // ("You're not getting any ads now" must stay true on email too).
      if (r.categories && r.categories.length === 0) continue;
      const filtered = ads.filter((ad) =>
        adMatchesCategories(categoriesByAd.get(ad.id) ?? null, r.categories),
      );
      if (!filtered.length && !sponsors.length) continue;
      const unsub = unsubscribeUrl(r.email); // personalized (signed) per recipient
      rows.push({
        digestId,
        channel: "email" as const,
        address: r.email,
        part: 1,
        parts: 1,
        subject: composeEmailSubject(site.name, filtered, day),
        body: composeEmailText(filtered, dateLabel, unsub, sponsors),
        html: composeEmailHtml(filtered, dateLabel, unsub, sponsors),
        segments: 0, // email costs no SMS segments — exempt from the budget
      });
    }
    const queued = await enqueueDigestOutbox(rows);
    await finalizeDigest(digestId, [], [], ads.length);
    results.push({
      slotKey,
      items: ads.length,
      recipients: rows.length,
      queued,
      skipped: false,
    });
  }

  return results;
}
