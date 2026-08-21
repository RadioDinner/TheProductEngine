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

import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import "@/analytics/src/register-after";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { ensureAccount, grantStarterCreditIfFirst } from "@/lib/store";
import { memberFunding } from "@/lib/ad-billing";
import { postDecision } from "@/lib/ad-funding";
import { adPriceCents, formatPrice } from "@/lib/config";
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
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { requireMemberPhone } from "@/lib/member-gate";
import { mayUse, policyFrom } from "@/lib/line-policy";


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

/**
 * The web posting action. Thin wrapper so an UNEXPECTED throw (a DB hiccup,
 * etc.) doesn't crash the page with a raw platform error — it's logged for
 * diagnosis and the member is sent back with a friendly "try again" note.
 * redirect()'s own NEXT_REDIRECT is re-thrown so normal outcomes flow through.
 */
export async function postAd(formData: FormData): Promise<void> {
  try {
    await postAdInner(formData);
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      typeof (e as { digest?: unknown }).digest === "string" &&
      (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw e; // a normal redirect() outcome — let it through
    }
    console.error("[post] web ad submission failed:", e);
    redirect("/account/post?error=server");
  }
}

async function postAdInner(formData: FormData): Promise<void> {
  const phone = await requireMemberPhone("/account/post");

  // Mirrors lib/engine.ts handleAdSubmission step for step from here on.
  // Every way a web post can be refused, with the same short reason codes the
  // SMS lane uses — so `reason` is one dimension across both channels rather
  // than two vocabularies that cannot be compared.
  const blocked = (reason: string) =>
    afterResponse(() => analytics.postBlocked({ phone, channel: "web", reason }));

  const account = await ensureAccount(phone);
  if (account.postingBannedAt) {
    blocked("posting_banned");
    redirect("/account/post?error=banned");
  }

  const body = stripEmoji(String(formData.get("body") ?? ""));
  if (!body) {
    blocked("empty");
    redirect("/account/post?error=empty");
  }
  const settings = await getEngineSettings();
  if (body.length > settings.maxChars) {
    blocked("too_long");
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
    blocked("word_filter");
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

  // Website-listing add-on (session 016): while web_addon_cents is 0 every ad
  // is listed free; when priced, the form's checkbox buys it as its own
  // ledger line (`Ad #<id> (website listing)` — the refund matchers' `Ad #<id> (`
  // token, so a benign rejection or never-ran delete returns it too).
  const wantsWebListing = settings.webAddonCents === 0 || formData.get("weblisting") === "on";
  const addonCost = settings.webAddonCents > 0 && wantsWebListing ? settings.webAddonCents : 0;

  // Web posts carry ONE listing picture (the extras are website-gallery only,
  // never texted), so they sit on the one-picture rung of the price ladder.
  // The multi-picture rungs are an SMS thing — a seller texting 2 or 3.
  const cost = adPriceCents(hasPhoto ? 1 : 0, settings) + addonCost;
  // One-time starter credit fires here — on the FIRST real post, past the
  // empty/too-long/auto-reject gates — exactly like the SMS lane.
  const starterLabel = formatPrice(settings.starterCreditCents);
  // Same line-type policy as the SMS lane: skipped entirely, never granted
  // zero, so a throwaway number can't consume one of the 200 launch slots.
  const starter = (await mayUse(phone, "starterCredit", policyFrom(settings)))
    ? await grantStarterCreditIfFirst(
        phone,
        settings.starterCreditCents,
        starterLabel,
        settings.starterCreditLimit,
      )
    : { account, granted: false };
  // NOTHING IS CHARGED HERE ANY MORE (session 023) — the ad is quoted a price,
  // the price is reserved against the member's balance, and the batch that
  // carries the ad collects. The SMS lane does exactly the same thing and for
  // the same reasons; see lib/ad-funding.ts.
  const funding = await memberFunding(phone, starter.account);
  const decision = postDecision({
    costCents: cost,
    balanceCents: funding.balanceCents,
    reservedCents: funding.reservedCents,
    hasCard: funding.hasCard,
    awaitingPayment: funding.awaitingPayment,
    maxAwaitingPayment: settings.maxAdsAwaitingPayment,
  });
  // The web form has no held-ad path (a member at a keyboard can add money in
  // the same session), so the guard here refuses rather than holds — the same
  // refusal this lane has always given, now reached only when several ads are
  // already waiting on money.
  if (!decision.accept) {
    blocked("awaiting_payment_cap");
    redirect(
      `/account/post?error=funds&cost=${cost}&balance=${funding.availableCents}&waiting=${funding.awaitingPayment}`,
    );
  }

  // Links FLAG for human review (walled garden), never auto-reject or strip.
  const containsLink = !mayPostLinks() && hasLink(body);

  const id = await createAd(
    {
      ownerPhone: phone,
      body,
      flagged: rules.flagged || containsLink,
      ...(hasPhoto && {
        photo: { src: photoSrc!, alt: deriveTitle(body), width: 800, height: 600 },
      }),
      // Only meaningful once the add-on is priced: an unchecked box keeps the
      // ad off the public site.
      webListing: wantsWebListing,
    },
    // ONE quote covering the ad and its website add-on. The add-on used to be
    // its own ledger line so the refund matchers would return it too; with
    // nothing charged before the run there is one collection at the end, and
    // the single `Ad #<id> (<kind>)` note it writes carries the whole price.
    { owedCents: cost },
  );
  const charge =
    `charge=owed&cost=${cost}&left=${Math.max(0, funding.availableCents - cost)}` +
    (decision.state === "card" ? `&card=1` : "") +
    (decision.state === "owing" ? `&short=${decision.shortfallCents}` : "") +
    (starter.granted ? `&welcome=${settings.starterCreditCents}` : "");

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

  // ACCEPTED — created, paid for, in the review queue. This is the WEB half of
  // post_submit; without it every ad in the property looked like it arrived by
  // text, which is not a gap but a confident wrong answer to the one question
  // that shapes the whole roadmap.
  afterResponse(() =>
    analytics.postSubmitted({
      phone,
      channel: "web",
      category: isCategoryKey(suggested) ? suggested : undefined,
      photoCount: hasPhoto ? 1 : 0,
      priceCents: cost,
    }),
  );

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
