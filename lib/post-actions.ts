"use server";

/**
 * Web ad posting (FEATURES item 9). postAd mirrors the SMS lane's
 * handleAdSubmission (lib/engine.ts) EXACTLY — same gates in the same order,
 * same charge semantics, same ledger note strings — so a web ad costs and
 * behaves precisely like one texted in:
 *
 *   posting-ban refusal → stripEmoji → empty/too-long → word-rule auto-reject
 *   (rejected record, flagged, NOTHING charged) → listing-picture re-host →
 *   starter grant (first real post only) → fast funds check → create the ad
 *   (pending) → charge (free pass first, else atomic credit debit, else undo
 *   via benign rejectAdRecord) → notify admin → web-only extra pictures.
 *
 * Outcomes are signaled repo-style: redirect() with query params (redirect
 * throws — it never sits inside a try/catch here).
 */

import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import {
  addLedgerEntry,
  consumeFreeAd,
  ensureAccount,
  getCreditBalance,
  grantStarterAdsIfFirst,
  spendCredits,
} from "@/lib/store";
import {
  addPhotoSubmission,
  countAdPhotos,
  createAd,
  rejectAdRecord,
  setAdCategory,
} from "@/lib/engine-store";
import { isCategoryKey } from "@/lib/categories";
import { getEngineSettings, getWordRules, matchWordRules } from "@/lib/settings";
import { hasLink, mayPostLinks, stripEmoji } from "@/lib/content-filter";
import { deriveTitle } from "@/lib/ads";
import { isAllowedPhotoSrc } from "@/lib/media";
import { storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";
import { MAX_PHOTOS_PER_AD } from "@/lib/email-photos";
import { notifyAdminNewAd } from "@/lib/notify";
import { formatPhone } from "@/lib/phone";

/** Per-picture byte ceiling — the same 8 MB every other ingest path enforces. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Store one web-only extra picture's bytes. Prod re-hosts via storeImageBytes
 * (byte-sniffed, our bucket); dev has no bucket, so — exactly like the
 * emailed-in extras route — the sniff-verified image is inlined as a data URI
 * so the review/gallery flow still works in walks. Null = unusable bytes.
 */
async function storeExtraBytes(bytes: Buffer): Promise<string | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
  if (supabaseConfigured) {
    const stored = await storeImageBytes(bytes);
    return stored.ok ? stored.url : null;
  }
  const ext = sniffImage(bytes);
  return ext ? `data:${CONTENT_TYPE_BY_EXT[ext]};base64,${bytes.toString("base64")}` : null;
}

export async function postAd(formData: FormData): Promise<void> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fpost");
  const phone = session.phone;

  // Mirrors lib/engine.ts handleAdSubmission step for step from here on.
  const account = await ensureAccount(phone);
  if (account.postingBannedAt) redirect("/account/post?error=banned");

  const body = stripEmoji(String(formData.get("body") ?? ""));
  if (!body) redirect("/account/post?error=empty");
  const settings = await getEngineSettings();
  if (body.length > settings.maxChars) {
    redirect(`/account/post?error=toolong&length=${body.length}&max=${settings.maxChars}`);
  }

  // Word rules before any charge: auto-reject words bounce the ad outright
  // (recorded for audit, flagged, nothing charged) — same as the SMS lane.
  const rules = matchWordRules(body, await getWordRules());
  if (rules.autoReject) {
    await createAd(
      { ownerPhone: phone, body, flagged: true },
      { status: "rejected", rejectedReason: "Automatic — offers an item we can't run." },
    );
    redirect("/account/post?error=autoreject");
  }

  // The ONE listing picture (the paid picture that rides digest/PIC/email).
  // Stored only when its bytes re-host cleanly; if they don't, the ad still
  // posts — as TEXT, at text price — and the member is TOLD (never a silent
  // picture-price charge). In dev (no Supabase bucket) re-hosting always
  // fails, so a dev picture post degrades to text price by design.
  const listing = formData.get("photo");
  let photoSrc: string | undefined;
  if (listing instanceof File && listing.size > 0) {
    if (listing.size <= MAX_UPLOAD_BYTES) {
      const stored = await storeImageBytes(Buffer.from(await listing.arrayBuffer()));
      if (stored.ok) photoSrc = stored.url;
    }
    if (photoSrc === undefined) {
      console.warn("[post] listing picture not stored — posting at text price");
    }
  }
  const hasPhoto = isAllowedPhotoSrc(photoSrc);
  const photoDropped = listing instanceof File && listing.size > 0 && !hasPhoto;

  const cost = hasPhoto ? settings.costPhoto : settings.costText;
  // One-time starter grant fires here — on the FIRST real post, past the
  // empty/too-long/auto-reject gates — exactly like the SMS lane.
  const posting = await grantStarterAdsIfFirst(phone);
  const canPass = posting.freeAds > 0;
  const balance = await getCreditBalance(phone);
  // Fast reject for the clearly-unfunded; the atomic charge below is the
  // authority under concurrency.
  if (!canPass && balance < cost) {
    redirect(`/account/post?error=funds&cost=${cost}&balance=${balance}`);
  }

  // Links FLAG for human review (walled garden), never auto-reject or strip.
  const containsLink = !mayPostLinks() && hasLink(body);

  const kind = hasPhoto ? "picture" : "text";
  const id = await createAd({
    ownerPhone: phone,
    body,
    flagged: rules.flagged || containsLink,
    ...(hasPhoto && {
      photo: { src: photoSrc!, alt: deriveTitle(body), width: 800, height: 600 },
    }),
  });

  // Charge atomically — free pass first, else atomic credit debit. The ledger
  // note strings are an API (refunds and the admin delete view match on them):
  // they MUST stay byte-identical to the SMS lane's.
  let charge: string;
  if (canPass && (await consumeFreeAd(phone))) {
    await addLedgerEntry(phone, {
      delta: 0,
      kind: "spend",
      note: `Free ad used — ad #${id} (${kind})`,
    });
    charge = `charge=free&left=${Math.max(0, posting.freeAds - 1)}`;
  } else if (await spendCredits(phone, cost, `Ad #${id} (${kind})`)) {
    charge = `charge=credits&cost=${cost}&left=${Math.max(0, balance - cost)}`;
  } else {
    // The balance was spent between the check and here — undo the ad instead
    // of leaving an unpaid pending record in the review queue.
    await rejectAdRecord(id, "Not enough credits at submission.", "benign");
    redirect(`/account/post?error=funds&cost=${cost}&balance=${await getCreditBalance(phone)}`);
  }

  // Seller's category suggestion (item 22 — web posting only; SMS sellers
  // don't pick). Best-effort: it pre-fills the review dropdown and the
  // OPERATOR's choice at review is authoritative. Never blocks the post.
  const suggested = String(formData.get("category") ?? "");
  if (isCategoryKey(suggested)) {
    try {
      await setAdCategory(id, suggested);
    } catch (e) {
      console.error("[post] category suggestion not saved:", e);
    }
  }

  await notifyAdminNewAd({ id, from: phone, hasPhoto, body, ...(hasPhoto && { photoSrc: photoSrc! }) });

  // Web-only extra pictures (FEATURES item 1 gallery): each goes through
  // ad_photo_submissions PENDING admin review — never straight to the live
  // gallery — capped at 8 pictures total per ad. Best-effort by design: an
  // extras problem must never break the already-posted, already-charged ad.
  const extras = formData
    .getAll("extras")
    .filter((f): f is File => f instanceof File && f.size > 0);
  let extrasSaved = 0;
  let extrasSkipped = 0;
  let extrasUnsupported = false;
  if (extras.length) {
    try {
      const room = Math.max(0, MAX_PHOTOS_PER_AD - (await countAdPhotos(id)));
      extrasSkipped += Math.max(0, extras.length - room);
      for (const file of extras.slice(0, room)) {
        const url = await storeExtraBytes(Buffer.from(await file.arrayBuffer()));
        if (!url) {
          extrasSkipped++;
          continue;
        }
        const outcome = await addPhotoSubmission(id, url, `web upload — ${formatPhone(phone)}`);
        if (outcome === "unsupported") {
          extrasUnsupported = true;
          break;
        }
        extrasSaved++;
      }
    } catch (e) {
      console.error("[post] extra pictures failed:", e);
      extrasUnsupported = true;
    }
  }

  const extrasParams =
    (extrasSaved ? `&extras=${extrasSaved}` : "") +
    (extrasSkipped ? `&extraskip=${extrasSkipped}` : "") +
    (extrasUnsupported ? "&extrasoff=1" : "");
  redirect(`/account/post?posted=${id}&${charge}${photoDropped ? "&nopic=1" : ""}${extrasParams}`);
}
