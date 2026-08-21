/**
 * The inbound SMS engine: every message from any phone flows through
 * handleInbound — from the Telnyx webhook in production, from the dev
 * simulator locally. Replies are sent through the transport and everything
 * (both directions) lands in the message audit log.
 */
import { parseCommand } from "@/lib/commands";
import * as analytics from "@/analytics/src/server-events";
import { afterResponse } from "@/analytics/src/after";
import { deriveTitle, adExpiresAt, type Ad } from "@/lib/ads";
import {
  attachAdPhotos,
  bumpAdOwed,
  cancelQueuedOutboxFor,
  countRecentOutboundContaining,
  createAd,
  getAdRecord,
  getAdsOwed,
  getPendingAds,
  listOwedAds,
  latestPendingAdFor,
  logMessage,
  recordInboundOnce,
  reserveSms,
  markAdSold,
  type StoredAd,
} from "@/lib/engine-store";
import { listAdsByOwner } from "@/lib/ads";
import {
  closedEarly,
  hourLabel,
  nextSendLabel,
  sendRecentDigestTo,
  smsWindowOpen,
} from "@/lib/digest-engine";
import {
  addRating,
  clearSmsContext,
  ensureAccount,
  getAccount,
  getSmsContext,
  getSubscriberCategories,
  grantStarterCreditIfFirst,
  starterCreditAvailable,
  recordSale,
  reserveCategoryConfirm,
  reservePicQuota,
  setSmsContext,
  setSubscriberCategories,
  setSubscribed,
} from "@/lib/store";
import { memberFunding } from "@/lib/ad-billing";
import { postDecision } from "@/lib/ad-funding";
import { messageBook } from "@/lib/messages";
import {
  ALL_CATEGORIES_SMS,
  EMPTY_CATEGORIES_SMS,
  THROTTLE_NOTICE_SMS,
  categoryToggleSms,
  listSms,
  toggleCategory,
  welcomeMessages,
} from "@/lib/categories";
import { gsmSanitize } from "@/lib/sms-segments";
import { normalizePhone } from "@/lib/phone";
import { adPriceCents, formatPrice, site } from "@/lib/config";
import { getEngineSettings, getWordRules, matchWordRules, effectiveSmsCaps } from "@/lib/settings";
import type { EngineSettings } from "@/lib/settings";
import { stripEmoji, hasLink, mayPostLinks } from "@/lib/content-filter";
import { etParts } from "@/lib/et";
import { picLimitMessage, PIC_LIMIT_MARKER } from "@/lib/pic-quota";
import { isAllowedPhotoSrc } from "@/lib/media";
import {
  fetchImageBytes,
  ingestInboundPhotos,
  isCollageSrc,
  isCombinePartSrc,
  removeHostedPhotos,
  storeImageBytes,
} from "@/lib/photos";
import {
  MAX_AD_PHOTOS,
  MAX_COMBINED_PHOTOS,
  textedAdPhotos,
  websiteAdPhotos,
} from "@/lib/photo-collage";
import { sniffImage } from "@/lib/image-sniff";
import { siteUrl } from "@/lib/email";
import { supabaseConfigured } from "@/lib/db";
import { dispatchSms } from "@/lib/outbound";
import { isBlockedNumber } from "@/lib/blocklist";
import { notifyAdminNewAd } from "@/lib/notify";
import { mayUse, policyFrom } from "@/lib/line-policy";

export interface InboundSms {
  from: string; // 10 digits
  text: string;
  media?: string[];
}

export interface Reply {
  body: string;
  media?: string[];
  /** Follow-up texts sent, in order, right after `body` — the welcome is a
   * short sequence rather than one wall of text (session 016). Each goes
   * through the same outbound guard and is logged like any other reply. */
  extra?: string[];
}

const REDIRECT_MARKER = "automated system";
const STOP_MARKER = "unsubscribed and won't get more";
/** Substring of the generic-failure reply, so it can be deduped to 1/number/hour. */
const ERROR_REPLY_MARKER = "something went wrong on our end";
const HOUR_MS = 60 * 60 * 1000;

/** Whole days between an ISO timestamp and now — for days_to_sell. */
function daysBetween(iso: string, nowMs: number): number {
  const ms = nowMs - Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) : 0;
}

// Ratings-flow conversation windows (FEATURES item 2): the seller has two
// days to name the buyer; each side has a week to send their RATE 1–5.
const BUYER_PHONE_CONTEXT_MS = 48 * HOUR_MS;
const RATE_CONTEXT_MS = 7 * 24 * HOUR_MS;

/**
 * The COMPLIANCE opt-in confirmation (brand, marketing disclosure, frequency,
 * msg&data rates, STOP/HELP) is sent by TELNYX's campaign keyword
 * auto-responder — the "Opt-in message" registered on the 10DLC campaign.
 * The app follows it with this practical welcome (user decision, session
 * 007): when the digests come and how to place an ad. Kept GSM-7.
 */
function slotTimeShort(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

async function welcomeMessage(settings: EngineSettings): Promise<string> {
  // The fallback welcome, used only where the category menu can't be offered.
  // It describes the SEND WINDOW, not settings.slots: since session 016 slots
  // are the EMAIL edition times, and an SMS member's ads arrive in BATCHES
  // through the day (session 018). Telling them "digests at 7, 12, 4 and 8"
  // would name hours nothing texts them at.
  const book = await messageBook();
  return book.render("welcome.fallback", {
    siteName: site.name,
    windowLabel: `${hourLabel(settings.smsWindowStartHour)} to ${hourLabel(settings.smsWindowEndHour)} Mon-Sat`,
  });
}

/**
 * The SUBSCRIBE/START welcome: the approved category menu (item 22) once
 * migration 9976 is live; before it, the pre-category welcome stands — a menu
 * whose words don't work yet would strand people on unknown-word replies.
 */
async function welcomeFor(from: string, settings: EngineSettings): Promise<Reply> {
  const categories = await getSubscriberCategories(from);
  if (categories === "unsupported") return { body: await welcomeMessage(settings) };
  // Whether the launch offer is still open decides whether the welcome
  // advertises it — promising free credit past the 200th member would be a
  // lie the very next message corrects.
  const offerOpen = await starterCreditAvailable(settings.starterCreditLimit);
  const book = await messageBook();
  const messages = welcomeMessages(
    {
      siteName: site.name,
      siteUrl: site.webHost,
      cardPhone: site.smsNumber,
      starterCreditLabel: offerOpen ? formatPrice(settings.starterCreditCents) : null,
      windowLabel: `${hourLabel(settings.smsWindowStartHour)} to ${hourLabel(settings.smsWindowEndHour)} Mon - Sat`,
      priceLine: await priceSheetLine(settings),
    },
    book.render,
  ).map((m) => gsmSanitize(m));
  return { body: messages[0], ...(messages.length > 1 && { extra: messages.slice(1) }) };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function statusWord(ad: Ad): string {
  if (ad.status === "sold") return "Sold";
  if (ad.status === "expired") return "Expired";
  return "Available";
}

/** The price sheet in one line, straight from Settings — never hardcoded, so
 * a repricing is a settings edit and not a code change. The WORDING around the
 * numbers is editable at /admin/replies (money.price-sheet). */
async function priceSheetLine(settings: EngineSettings): Promise<string> {
  const pics = settings.photoPricesCents
    .map((cents, i) => `${i + 1} pic${i ? "s" : ""} ${formatPrice(cents)}`)
    .join(", ");
  const book = await messageBook();
  return book.render("money.price-sheet", {
    textPrice: formatPrice(settings.costTextCents),
    picturePrices: pics,
  });
}

/**
 * What to do about an empty balance. Every reply that has to ask a member for
 * money ends with this one sentence, so there is a single place to change the
 * answer — and since session 021 it is editable at /admin/replies too
 * (money.pay-instructions).
 *
 * Leads with the CALL (user decision, session 020, replacing a proposed $50
 * debt allowance: "if they don't have enough money to post an ad, reply to
 * them to call the number to add a card to charge"). The line it names is the
 * same one the card IVR answers, and pressing 1 is literally the first thing
 * that menu offers — so the instruction and what the caller hears agree word
 * for word.
 *
 * ⚠️ It now says "we'll charge it WHEN YOUR AD RUNS", not "we'll charge it and
 * your ad goes out". That is not a tidy-up: since session 021 the card really
 * is not touched until the batch carrying the ad goes out, and a sentence
 * promising an immediate charge would be the one place the service still said
 * otherwise.
 */
async function payInstructions(): Promise<string> {
  const book = await messageBook();
  return book.render("money.pay-instructions", {
    supportPhone: site.supportPhone,
    siteUrl: site.webHost,
  });
}

async function handleAdSubmission(from: string, rawBody: string, media?: string[]): Promise<Reply> {
  // Every way a post can be refused, counted with its reason. "Posting is
  // down" is not actionable; "posting is down because the word filter is
  // rejecting a third of ads" is. Reasons are short codes, never the member's
  // own words — an ad body is exactly the text that must not reach Google.
  const blocked = (reason: string) =>
    afterResponse(() => analytics.postBlocked({ phone: from, channel: "sms", reason }));
  const account = await ensureAccount(from);
  if (account.postingBannedAt) {
    blocked("posting_banned");
    return {
      body: `Your posting privileges are suspended. Contact us at ${site.supportPhone} or appeal at ThePlainExchange.com.`,
    };
  }
  // Optional strict stance: posting from an app/throwaway number. Off by
  // default — the money and the seller directory are what need protecting,
  // and turning a paying seller away costs more than a burner gains.
  if (!(await mayUse(from, "posting", policyFrom(await getEngineSettings())))) {
    blocked("line_type");
    return {
      body: `We can't post ads from this kind of number. Text or call us at ${site.supportPhone} and we'll help you get set up.`,
    };
  }
  // Strip emoji before anything else: they never appear in a stored or
  // broadcast ad (an emoji flips a whole SMS digest to costly UCS-2 and reads
  // badly on a flip phone). The raw text the sender typed still lives in the
  // message audit log. An ad that was ONLY emoji is now empty → same guidance.
  const body = stripEmoji(rawBody);
  if (!body) {
    blocked("empty");
    return {
      body: `To post an ad, text AD and your ad — for example: AD Horse cart for sale, $1,000 OBO. Call 330-555-0142.`,
    };
  }
  const settings = await getEngineSettings();
  if (body.length > settings.maxChars) {
    blocked("too_long");
    return {
      body: `Your ad is too long (${body.length}/${settings.maxChars} characters). Please shorten it and resend.`,
    };
  }

  // Word rules run before any charge: auto-reject words bounce the ad
  // outright (recorded for audit, nothing charged, no strike — spec Q4).
  const rules = matchWordRules(body, await getWordRules());
  if (rules.autoReject) {
    await createAd(
      {
        ownerPhone: from,
        body,
        flagged: true,
      },
      { status: "rejected", rejectedReason: "Automatic — offers an item we can't run." },
    );
    blocked("word_filter");
    return {
      body: `Your ad can't be accepted — it appears to offer something we can't run. Nothing was charged. Text HELP for help or see ThePlainExchange.com/how-it-works.`,
    };
  }

  // Attachment security (user policy, session 007): a photo is stored ONLY
  // after re-hosting validates its bytes as a real image (jpg/png/gif/webp)
  // and copies it into our own storage. In production there is NO fallback to
  // the sender-supplied URL — unvalidated bytes and expiring provider links
  // never reach the site. Dev (no Supabase) keeps the allowlist-checked
  // originals so fixtures and simulators still work.
  //
  // Multiple pictures (item 32): 2–4 attachments are combined into ONE collage
  // photo — the ad still carries a single picture (MMS/PIC/digest costs and
  // the picture-ad price are untouched) while every picture shows. The
  // individual originals join the website gallery at positions 1+.
  const sentPictures = media?.length ?? 0;
  let photoSrc: string | undefined;
  let galleryParts: string[] = [];
  let savedPictures = 0;
  let combined = false;
  let photoDims = { width: 800, height: 600 };
  if (sentPictures && supabaseConfigured) {
    const ingest = await ingestInboundPhotos(media!);
    if (ingest.ok) {
      photoSrc = ingest.photo;
      galleryParts = ingest.parts;
      savedPictures = ingest.saved;
      combined = ingest.combined;
      if (ingest.width && ingest.height) photoDims = { width: ingest.width, height: ingest.height };
    } else {
      console.error("[engine] photo ingest failed:", ingest.reason);
    }
  } else if (sentPictures) {
    const allowed = media!.slice(0, MAX_AD_PHOTOS).filter(isAllowedPhotoSrc);
    photoSrc = allowed[0];
    galleryParts = allowed.slice(1);
    savedPictures = allowed.length;
  }
  const hasPhoto = isAllowedPhotoSrc(photoSrc);
  if (!hasPhoto) {
    photoSrc = undefined;
    galleryParts = [];
    savedPictures = 0;
    combined = false;
  }
  // The sender attached pictures we could neither re-host nor trust: the ad
  // still posts (as text, at text price) but the seller must be TOLD — a
  // silent drop reads as "my picture ad is live" when it isn't.
  const photoDropped = sentPictures > 0 && !hasPhoto;
  // Price by picture COUNT (session 016 sheet: $20 text, $30/$40/$50 for
  // 1/2/3 pictures) — savedPictures is what the ad will actually carry, so a
  // seller is never charged for a picture that failed to save.
  const cost = adPriceCents(savedPictures, settings);
  // Apply the one-time starter credit now — on the seller's FIRST real AD NEW
  // (past the empty/too-long/auto-reject gates), not on account creation. A
  // number that only ever subscribes or checks its balance never mints money.
  // Idempotent: once granted it never re-fires, even after the money is spent.
  const starterLabel = formatPrice(settings.starterCreditCents);
  // Line-type policy (session 016): a throwaway number is skipped ENTIRELY
  // rather than granted zero — stamping starter_granted_at with no money
  // would silently consume one of the 200 launch slots, which is the exact
  // resource this policy exists to protect.
  const policy = policyFrom(settings);
  const starter = (await mayUse(from, "starterCredit", policy))
    ? await grantStarterCreditIfFirst(from, settings.starterCreditCents, starterLabel, settings.starterCreditLimit)
    : { account, granted: false };
  if (starter.granted) {
    // The launch offer being consumed. Watched against starterCreditLimit it
    // answers "how close are we to the 200th?" before it is discovered after.
    afterResponse(() =>
      analytics.starterCreditGranted({ phone: from, amountCents: settings.starterCreditCents }),
    );
  }
  // NOTHING IS CHARGED HERE ANY MORE (session 021, user decision: "when people
  // create an ad, and have a card on file, I want the confirmation message to
  // include that the card won't be charged until the ad is run. Make the system
  // honor the truth of this message.")
  //
  // The ad is QUOTED a price and that price is RESERVED against the member's
  // balance; the batch that carries the ad is what collects. See
  // lib/ad-funding.ts for why reserving still has to happen even though the
  // money doesn't move, and lib/ad-billing.ts for the collection itself.
  const funding = await memberFunding(from, starter.account);
  const decision = postDecision({
    costCents: cost,
    balanceCents: funding.balanceCents,
    reservedCents: funding.reservedCents,
    hasCard: funding.hasCard,
    awaitingPayment: funding.awaitingPayment,
    maxAwaitingPayment: settings.maxAdsAwaitingPayment,
  });
  const book = await messageBook();

  // Links are walled-garden-blocked for now: don't strip or auto-reject, just
  // FLAG so a human reviews (edits the link out, or rejects). A future
  // verified-advertiser tier flips mayPostLinks() without touching this path.
  const containsLink = !mayPostLinks() && hasLink(body);
  const adInput = {
    ownerPhone: from,
    body,
    flagged: rules.flagged || containsLink,
    ...(hasPhoto && {
      photo: { src: photoSrc!, alt: deriveTitle(body), ...photoDims },
      ...(galleryParts.length && {
        // Combined: parts are pictures 1..N (position 0 is the collage).
        // Fallback: the photo IS picture 1, parts start at 2.
        morePhotos: galleryParts.map((src, i) => ({
          src,
          alt: `${deriveTitle(body)} — picture ${combined ? i + 1 : i + 2}`,
          width: 800,
          height: 600,
        })),
      }),
    }),
  };

  // TOO MANY ALREADY WAITING ON MONEY — the ad is written down but stays out
  // of the review queue (the session-020 'unpaid' hold, unchanged). This is the
  // only thing that still refuses an ad for money, and it refuses volume rather
  // than poverty: one unfunded ad is reviewed like any other, the fourth is
  // held. The seller's text is never lost either way.
  if (!decision.accept) {
    blocked("awaiting_payment_cap");
    const heldId = await createAd(adInput, {
      status: "unpaid",
      unpaidCents: cost,
      owedCents: cost,
    });
    // Deliberately NOT postSubmitted. A held ad has not entered the supply —
    // counting ads before they reach the queue inflates the one number the
    // roadmap gets argued from. The event fires if and when it is admitted.
    return {
      body: book.render("ad.held", {
        adId: heldId,
        price: formatPrice(cost),
        balance: formatPrice(funding.balanceCents),
        supportPhone: site.supportPhone,
        siteUrl: site.webHost,
        waiting: funding.awaitingPayment,
      }),
    };
  }

  const id = await createAd(adInput, { owedCents: cost });

  // ACCEPTED — created, quoted, and in the review queue. Emitted here and
  // nowhere earlier: counting an ad when the text arrives would include every
  // one the word filter or the ban list then refused, and an inflated supply
  // number is the figure the whole roadmap gets argued from.
  // No category yet — the operator assigns that at review.
  afterResponse(() =>
    analytics.postSubmitted({
      phone: from,
      channel: "sms",
      photoCount: savedPictures,
      priceCents: cost,
    }),
  );

  // The payment sentence, in the seller's own circumstances. All three are
  // editable at /admin/replies; the middle one is the promise this session
  // exists to make true.
  const moneyNote =
    decision.state === "covered"
      ? book.render("ad.money.covered", {
          price: formatPrice(cost),
          balance: formatPrice(funding.balanceCents),
          left: formatPrice(Math.max(0, decision.availableCents - cost)),
        })
      : decision.state === "card"
        ? book.render("ad.money.card", {
            price: formatPrice(cost),
            balance: formatPrice(funding.balanceCents),
            short: formatPrice(decision.shortfallCents),
          })
        : book.render("ad.money.owing", {
            price: formatPrice(cost),
            // {spare} and {short} are on the SAME scale — credit not already
            // promised to another ad. Quoting the raw balance beside a
            // shortfall worked out from spare credit produced sentences that
            // contradicted themselves ("you have $40, we need the other $20"
            // on a $20 ad).
            spare: formatPrice(decision.availableCents),
            balance: formatPrice(funding.balanceCents),
            short: formatPrice(decision.shortfallCents),
            supportPhone: site.supportPhone,
            siteUrl: site.webHost,
          });

  await notifyAdminNewAd({ id, from, hasPhoto, body, ...(hasPhoto && { photoSrc: photoSrc! }) });

  // Picture-ad guidance (item 33): tell the seller how to add more pictures
  // (one message at a time — carriers split multi-photo MMS unreliably) and
  // when the set closes. The 10-minute line matches the combined-photo
  // confirmation cadence in lib/collage-confirm.ts; late pictures still
  // attach while the ad is pending (24 h window) and simply re-arm a fresh
  // combined-photo text.
  let photoNote = "";
  if (photoDropped) {
    photoNote = ` Note: we couldn't save your picture${sentPictures > 1 ? "s" : ""}, so this will run as a text-only ad. Reply with the photo${sentPictures > 1 ? "s" : ""} again, or call ${site.supportPhone}.`;
  } else if (combined) {
    const room = MAX_AD_PHOTOS - savedPictures;
    photoNote = ` Your ${savedPictures} pictures were combined into one photo.`;
    if (room > 0) photoNote += ` You can send ${room} more, one at a time.`;
    photoNote += ` We'll text you the combined photo once your pictures are in.`;
  } else if (hasPhoto && savedPictures === 1) {
    photoNote = ` If you have more pictures, please send them one at a time - up to ${MAX_AD_PHOTOS} total. The first ${MAX_COMBINED_PHOTOS} go out by text; the rest show on the website. If we don't hear from you within 10 minutes, we'll assume this is the only picture.`;
  }
  if (hasPhoto && savedPictures < sentPictures) {
    photoNote +=
      sentPictures > MAX_AD_PHOTOS && savedPictures === MAX_AD_PHOTOS
        ? ` (${MAX_AD_PHOTOS} pictures is the most one ad can hold.)`
        : ` (We could only save ${savedPictures} of your ${sentPictures} pictures.)`;
  }
  // Batched send (session 018): an approved ad rides the next batch, so the
  // honest promise is "when it's approved and it goes out" — with the window
  // spelled out only when it actually delays them (a 5am sender needs to know;
  // a 2pm sender does not, and every extra sentence is a billed segment).
  //
  // Inside Saturday's unpublished early close the hours are dropped and only
  // the timing is given: quoting "7am-6pm, Mon-Sat" at 5:30pm on a Saturday
  // would contradict the very sentence it sits in. See closedEarly.
  const nowForWindow = new Date();
  const windowNote = smsWindowOpen(nowForWindow, settings)
    ? ""
    : closedEarly(nowForWindow, settings)
      ? ` Yours will send ${nextSendLabel(nowForWindow, settings)} at the earliest.`
      : ` Ads go out ${hourLabel(settings.smsWindowStartHour)}-${hourLabel(settings.smsWindowEndHour)}, Mon-Sat, so yours will send ${nextSendLabel(nowForWindow, settings)} at the earliest.`;
  return {
    body: book.render(hasPhoto ? "ad.received.picture" : "ad.received.text", {
      adId: id,
      price: formatPrice(cost),
      balance: formatPrice(funding.balanceCents),
      moneyNote,
      photoNote,
      windowNote,
    }),
  };
}

/** How long after posting a pending ad still accepts follow-up pictures. */
const PHOTO_FOLLOWUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The pending ad was approved/rejected/deleted between lookup and attach —
 * attachAdPhotos only touches pending ads, so a reviewed ad never gains an
 * unreviewed picture. */
class AdLeftReviewError extends Error {}

/** How to post when a picture arrives with nothing to attach it to. Silent
 * while UNDER ATTACK — an MMS flood must not each earn a reply. */
function photoGuidance(count: number, settings: EngineSettings): Reply | null {
  if (settings.underAttack) return null;
  const many = count > 1;
  return {
    body: `To post an ad with ${many ? "these pictures" : "this picture"}, resend ${many ? "them" : "it"} with your ad text, like: AD Horse cart for sale $1,000, call ${site.smsNumber}.`,
  };
}

/**
 * A photo-only message while the sender has a fresh pending ad = more
 * pictures for that ad (item 32). Phones routinely send "AD NEW …" and the
 * pictures as separate MMS messages, or trickle one picture per message —
 * before this, every one of those pictures bounced with "resend it with your
 * ad text". New pictures are combined with the ad's existing ones into a
 * single collage photo (cap MAX_COMBINED_PHOTOS). Pending ads only, so a
 * reviewed picture never changes after approval.
 *
 * Returns null when there's nothing to attach to — the caller falls back to
 * the how-to-post guidance.
 */
async function handlePhotoFollowup(
  from: string,
  media: string[],
  settings: EngineSettings,
): Promise<Reply | null> {
  const since = new Date(Date.now() - PHOTO_FOLLOWUP_WINDOW_MS).toISOString();
  const ad = await latestPendingAdFor(from, since);
  if (!ad) return null;
  const title = deriveTitle(ad.body);

  // The ad's current collage inputs, display order: a non-collage position-0
  // picture (single-picture ad) first, then the `parts/` originals. Emailed-in
  // extras (bare paths at positions 1+) never join the collage. Dev mode has
  // no storage markers — everything the ad shows counts.
  const primarySrc = ad.photo?.src;
  const primaryIsCollage = Boolean(primarySrc && isCollageSrc(primarySrc));
  const primaryIsPart = Boolean(primarySrc && isCombinePartSrc(primarySrc));
  const gallerySrcs = (ad.morePhotos ?? []).map((p) => p.src);
  const existingOriginals = (
    supabaseConfigured
      ? [
          ...(primarySrc && !primaryIsCollage ? [primarySrc] : []),
          ...gallerySrcs.filter(isCombinePartSrc),
        ]
      : [...(primarySrc ? [primarySrc] : []), ...gallerySrcs]
  ).filter((src, i, arr) => arr.indexOf(src) === i);
  const room = MAX_AD_PHOTOS - existingOriginals.length;
  if (room <= 0) {
    return {
      body: `Ad #${ad.id} already has ${MAX_AD_PHOTOS} pictures — that's the most one ad can hold. It's waiting for review.`,
    };
  }
  const overCap = Math.max(0, media.length - room);

  // Validate the new pictures BEFORE any charge, like AD NEW does.
  const newBuffers: Buffer[] = [];
  let droppedBad = 0;
  if (supabaseConfigured) {
    for (const src of media.slice(0, room)) {
      const fetched = await fetchImageBytes(src);
      if (fetched.ok && sniffImage(fetched.bytes)) newBuffers.push(fetched.bytes);
      else {
        droppedBad += 1;
        console.error(
          "[engine] follow-up picture dropped:",
          fetched.ok ? `bytes are not an accepted image (labeled ${fetched.contentType})` : fetched.reason,
        );
      }
    }
  }
  const devAllowed = supabaseConfigured ? [] : media.slice(0, room).filter(isAllowedPhotoSrc);
  const newCount = supabaseConfigured ? newBuffers.length : devAllowed.length;
  if (!newCount) {
    return {
      body: `We couldn't save ${media.length > 1 ? "those pictures" : "that picture"} for ad #${ad.id}. Please try sending ${media.length > 1 ? "them" : "it"} again, or call ${site.supportPhone}.`,
    };
  }

  // Adding the FIRST picture upgrades a text ad to a picture ad, so the ad's
  // price goes UP. Ads that already have a picture were quoted the picture
  // price; more pictures for the one collage photo cost nothing extra.
  //
  // NOTHING IS CHARGED HERE EITHER (session 021). The upgrade raises what the
  // ad OWES — one quote, collected once, by the batch that carries it. That
  // replaces a ref-guarded ledger debit whose whole complexity existed to make
  // a mid-flight charge safe against retries and refunds: with no charge until
  // the run there is no debit to guard, no `(picture upgrade)` ledger token to
  // match, and no upgrade to hand back when the attach fails — the price simply
  // goes back down. Legacy `(picture upgrade)` rows on existing ads still match
  // the refund matchers in lib/myads.ts, which look for `Ad #<id> (`.
  //
  // A seller who cannot cover the higher price is REFUSED the upgrade rather
  // than having their ad quietly stalled at a price they can't pay: the ad is
  // in review at the text price and should stay runnable. With a card on file
  // there is nothing to refuse.
  let chargeNote = "";
  let upgradeAdded = 0;
  if (!ad.photo) {
    const delta = Math.max(0, adPriceCents(newCount, settings) - settings.costTextCents);
    if (delta > 0) {
      const funding = await memberFunding(from, await ensureAccount(from));
      if (!funding.hasCard && funding.availableCents < delta) {
        return {
          body:
            `Adding a picture to ad #${ad.id} takes it to ${formatPrice(adPriceCents(newCount, settings))} ` +
            `and you have ${formatPrice(funding.availableCents)} to spend. ${await payInstructions()}, ` +
            `then send the picture again.`,
        };
      }
      // Raise the quote. Idempotent by amount is impossible here (a second
      // picture message legitimately adds nothing), so bumpAdOwed is guarded on
      // the ad still being unrun and unattached — see the store.
      if (await bumpAdOwed(ad.id, delta)) {
        upgradeAdded = delta;
        chargeNote = ` Your ad is now ${formatPrice(adPriceCents(newCount, settings))}, charged when it goes out.`;
      }
    }
  }

  try {
    let primary: StoredAd["photo"] | null = null;
    let newParts: NonNullable<StoredAd["morePhotos"]> = [];
    const removeSrcs: string[] = [];
    let shownCount = existingOriginals.length + newCount;

    if (!supabaseConfigured) {
      // Dev keeps allowlisted URLs — no storage, no collage.
      primary = ad.photo
        ? null
        : { src: devAllowed[0], alt: title, width: 800, height: 600 };
      newParts = (primary ? devAllowed.slice(1) : devAllowed).map((src, i) => ({
        src,
        alt: `${title} — picture ${existingOriginals.length + (primary ? i + 2 : i + 1)}`,
        width: 800,
        height: 600,
      }));
      if (!(await attachAdPhotos(ad.id, primary, newParts))) throw new AdLeftReviewError();
    } else if (shownCount === 1) {
      // A text ad gaining its one picture: same shape as a single-picture AD NEW.
      const stored = await storeImageBytes(newBuffers[0]);
      if (!stored.ok) throw new Error(stored.reason);
      primary = { src: stored.url, alt: title, width: 800, height: 600 };
      if (!(await attachAdPhotos(ad.id, primary, []))) throw new AdLeftReviewError();
    } else {
      // Collage rebuild. Gather the existing originals' bytes; the legacy
      // single-picture primary also needs a `parts/` gallery copy since the
      // collage is about to take its position-0 spot.
      const legacyPrimary = Boolean(primarySrc) && !primaryIsCollage && !primaryIsPart;
      const inputs: Buffer[] = [];
      let legacyCopy: { src: string } | null = null;
      for (const [i, src] of existingOriginals.entries()) {
        const fetched = await fetchImageBytes(src);
        if (fetched.ok) {
          inputs.push(fetched.bytes);
          if (legacyPrimary && i === 0) {
            const copy = await storeImageBytes(fetched.bytes, "parts");
            if (copy.ok) legacyCopy = { src: copy.url };
          }
        } else if (legacyPrimary && i === 0) {
          // Can't preserve the current paid picture — don't half-destroy the ad.
          throw new Error(`current picture unreadable: ${fetched.reason}`);
        } else {
          console.error(`[engine] collage input unreadable (stays in gallery): ${fetched.reason}`);
        }
      }
      const newStored: { bytes: Buffer; url: string }[] = [];
      for (const bytes of newBuffers) {
        const stored = await storeImageBytes(bytes, "parts");
        if (stored.ok) newStored.push({ bytes, url: stored.url });
        else {
          droppedBad += 1;
          console.error("[engine] follow-up picture store failed:", stored.reason);
        }
      }
      if (!newStored.length) throw new Error("storage failed for every picture");
      shownCount = inputs.length + newStored.length;
      const galleryStart = gallerySrcs.length + 1;
      newParts = [
        ...(legacyCopy ? [{ src: legacyCopy.src, alt: `${title} — picture 1`, width: 800, height: 600 }] : []),
        ...newStored.map((s, i) => ({
          src: s.url,
          alt: `${title} — picture ${galleryStart + (legacyCopy ? 1 : 0) + i}`,
          width: 800,
          height: 600,
        })),
      ];
      // No compositing (user decision, session 016): pictures are stored
      // exactly as they arrive. Position 0 is simply the FIRST picture, and
      // every other one joins the gallery — which is what "the first 3 go out
      // by text, see the rest on the website" describes. This was already the
      // fallback path when a collage failed to build; now it is the only path.
      if (!ad.photo) {
        const first = newParts.find((p) => !legacyCopy || p.src !== legacyCopy.src);
        if (first) {
          primary = { src: first.src, alt: title, width: 800, height: 600 };
          newParts = newParts.filter((p) => p.src !== first.src);
        }
      }
      const attached = await attachAdPhotos(ad.id, primary, newParts);
      if (!attached) throw new AdLeftReviewError();
      if (removeSrcs.length && attached.oldPrimarySrc === primarySrc) {
        await removeHostedPhotos(removeSrcs);
      }
    }

    let note = "";
    if (overCap > 0 && newCount + existingOriginals.length >= MAX_AD_PHOTOS) {
      note = ` (${MAX_AD_PHOTOS} pictures is the most one ad can hold.)`;
    } else if (droppedBad > 0) {
      note = ` (We could only save ${newCount} of the ${media.length} pictures.)`;
    }
    // Room note: a trickling seller always knows how many pictures are left.
    const room = Math.max(0, MAX_AD_PHOTOS - shownCount);
    const roomNote = room > 0 ? ` You can send ${room} more, one at a time.` : "";
    const body = `Got it! ${newCount === 1 ? "Your picture was" : `${newCount} pictures were`} added to ad #${ad.id} (${title}) - it now has ${shownCount}. It's waiting for review.${chargeNote}${note}${roomNote}`;
    return { body };
  } catch (e) {
    // Put the price back — the pictures didn't make it onto the ad, so it is a
    // text ad again and must not be collected for at the picture price. There
    // is no money to return because none was ever taken.
    if (upgradeAdded > 0) {
      // anyStatus, and it is load-bearing: the commonest way this path is
      // reached is the operator approving the ad DURING the picture upload,
      // which is exactly what made attachAdPhotos refuse. A pending-only undo
      // would quietly do nothing and leave a text ad owing the picture price.
      await bumpAdOwed(ad.id, -upgradeAdded, { anyStatus: true }).catch(() => {});
    }
    if (e instanceof AdLeftReviewError) {
      return {
        body: `Ad #${ad.id} already went through review, so this picture wasn't added.${upgradeAdded ? " Its price is unchanged." : ""} Text AD with your pictures to post a new ad, or call ${site.supportPhone}.`,
      };
    }
    console.error(`[engine] photo follow-up failed for ad #${ad.id}:`, e);
    return {
      body: `We couldn't save ${media.length > 1 ? "those pictures" : "that picture"} for ad #${ad.id}. Nothing extra was charged. Please try again, or call ${site.supportPhone}.`,
    };
  }
}

async function handleSold(from: string, id: number | null): Promise<Reply> {
  if (!id) {
    return { body: `Include the ad number — for example: SOLD 1042.` };
  }
  const ad = await getAdRecord(id);
  if (!ad || ad.ownerPhone !== from) {
    return { body: `Ad #${id} doesn't belong to this number.` };
  }

  // An admin-deleted ad is gone: never mark it sold.
  if (ad.status === "deleted") {
    return { body: `Ad #${id} was removed and is no longer listed.` };
  }

  if (ad.status === "sold") return { body: `Ad #${id} is already marked sold.` };
  if (ad.status === "rejected") return { body: `Ad #${id} was not accepted, so there's nothing to mark sold.` };
  // Only a live listing can be sold. Blocking `pending` closes a moderation
  // bypass: SOLD on an unreviewed ad would publish it to the site as "sold".
  if (ad.status === "pending") {
    return { body: `Ad #${id} is still waiting for review — you can mark it sold once it's approved.` };
  }
  await markAdSold(id);
  const book = await messageBook();
  // The outcome the whole service exists to produce. days_to_sell is the
  // number that proves it works — and the one to put in front of a business
  // advertiser. Measured from approval (when buyers could first see it), not
  // from submission, so review latency does not inflate it.
  afterResponse(() =>
    analytics.listingSold({
      phone: from,
      channel: "sms",
      daysToSell: daysBetween(ad.approvedAt ?? ad.createdAt, Date.now()),
    }),
  );
  // Ratings flow (FEATURES item 2): ask who bought it, so buyer and seller
  // become CONFIRMED parties who may rate each other. If contexts aren't
  // available yet (migration 9984), the plain confirmation stands alone.
  const opened = await setSmsContext(from, {
    kind: "buyer_phone",
    adId: id,
    expiresAt: new Date(Date.now() + BUYER_PHONE_CONTEXT_MS).toISOString(),
  });
  if (opened === "set") {
    return {
      body: book.render("sold.confirmed", { adId: id, title: deriveTitle(ad.body) }),
    };
  }
  return { body: book.render("sold.confirmed.plain", { adId: id, title: deriveTitle(ad.body) }) };
}

/**
 * The seller answered the "what was the buyer's phone number?" question
 * (FEATURES item 2): confirm the sale, open a RATE prompt for the seller, and
 * invite the buyer to rate back. Returns null when the text isn't an answer —
 * the message then routes like any other.
 */
async function answerBuyerPhone(from: string, text: string): Promise<Reply | null> {
  const context = await getSmsContext(from);
  if (!context || context.kind !== "buyer_phone") return null;
  const buyer = normalizePhone(text);
  if (!buyer) return null; // not a phone number — not an answer to the question
  if (buyer === from) {
    return { body: `That's your own number — reply with the BUYER's phone number, or SKIP.` };
  }
  const ad = await getAdRecord(context.adId);
  if (!ad || ad.ownerPhone !== from) {
    await clearSmsContext(from);
    return null;
  }
  // Both parties need accounts for the sale/ratings records (a fixture-mode
  // ad owner may not have one yet; a real seller always does via AD NEW).
  await ensureAccount(from);
  await ensureAccount(buyer);
  const recorded = await recordSale(context.adId, from, buyer);
  await clearSmsContext(from);
  if (recorded === "unsupported") return { body: "Thanks!" };
  const rateExpiry = new Date(Date.now() + RATE_CONTEXT_MS).toISOString();
  await setSmsContext(from, {
    kind: "rate",
    adId: context.adId,
    otherPhone: buyer,
    ratedRole: "buyer",
    expiresAt: rateExpiry,
  });
  // Invite the buyer to rate back. The prompt opens even if the invite SMS is
  // suppressed (pause/caps) — a buyer who heard about it can still RATE.
  await setSmsContext(buyer, {
    kind: "rate",
    adId: context.adId,
    otherPhone: from,
    ratedRole: "seller",
    expiresAt: rateExpiry,
  });
  const invite = `The seller of ad #${context.adId} (${deriveTitle(ad.body)}) marked it sold to you. Want to rate the seller? Reply RATE 1-5 (5 = best), or SKIP.`;
  const { sent } = await dispatchSms(buyer, invite, { cls: "reply" });
  if (sent) {
    await logMessage({ direction: "outbound", channel: "sms", address: buyer, body: invite });
  }
  return {
    body: `Thanks! Would you like to rate the buyer? If so, please reply with RATE 5 for 5 stars (RATE 1-5), or SKIP.`,
  };
}

async function route(
  msg: InboundSms,
  command: ReturnType<typeof parseCommand>,
  settings: EngineSettings,
): Promise<Reply | null> {
  const from = msg.from;

  // A bare photo with no usable text: more pictures for the sender's fresh
  // pending ad when one exists (item 32), else the how-to-post guidance
  // (spec Q13).
  if (msg.media?.length && command.kind === "unknown" && !msg.text.trim()) {
    const attached = await handlePhotoFollowup(from, msg.media, settings);
    return attached ?? photoGuidance(msg.media.length, settings);
  }

  // An open conversational prompt may consume a non-command message — the
  // buyer's phone number after SOLD. Real commands still work mid-conversation.
  if (command.kind === "unknown") {
    const answered = await answerBuyerPhone(from, command.text);
    if (answered) return answered;
    // A picture WITH a caption ("here's another photo of the buggy") gets the
    // same treatment as a bare picture — attach to the fresh pending ad, else
    // guide. Silently losing a texted picture is worse than misreading a
    // caption (item 32 audit fix).
    if (msg.media?.length) {
      const attached = await handlePhotoFollowup(from, msg.media, settings);
      return attached ?? photoGuidance(msg.media.length, settings);
    }
  }

  switch (command.kind) {
    case "subscribe": {
      const account = await ensureAccount(from);
      if (account.subscribedAt) {
        return {
          body: (await messageBook()).render("subscribe.already", {
            windowLabel: `${hourLabel(settings.smsWindowStartHour)} to ${hourLabel(settings.smsWindowEndHour)} Mon-Sat`,
          }),
        };
      }
      // A NEW member — the already-subscribed branch above returned, so this
      // cannot double-count somebody re-texting SUBSCRIBE. That distinction is
      // the whole value of the number: "how many people joined" is a growth
      // figure, "how many SUBSCRIBE texts arrived" is not.
      afterResponse(() => analytics.signedUp({ phone: from, method: "sms" }));
      await setSubscribed(from, true);
      // Send the most recent digest right away so a new subscriber isn't
      // waiting hours for the next slot. Best-effort — must never break signup.
      // Skipped while UNDER ATTACK (a spoofed-number flood shouldn't each pull a
      // burst of catch-up SMS).
      if (!settings.underAttack) {
        try {
          await sendRecentDigestTo(from);
        } catch (e) {
          console.error("[engine] catch-up digest failed:", e);
        }
      }
      return welcomeFor(from, settings);
    }
    case "stop": {
      // No ensureAccount here: a STOP from an unknown number shouldn't mint an
      // account (+ starter free ads) — that was a cheap flood vector.
      afterResponse(() => analytics.unsubscribed({ phone: from, channel: "sms" }));
      await setSubscribed(from, false);
      // Honor the opt-out immediately: drop any digest rows already queued for
      // this number so a broadcast composed before the STOP can't still send.
      await cancelQueuedOutboxFor(from);
      return {
        body: (await messageBook()).render("stop.confirmation", { siteName: site.name }),
      };
    }
    case "start": {
      const account = await ensureAccount(from);
      const wasSubscribed = Boolean(account.subscribedAt);
      await setSubscribed(from, true);
      // Catch them up on the latest digest only if this actually re-subscribed
      // them (not a repeat START from an already-subscribed number), and not
      // while UNDER ATTACK.
      if (!wasSubscribed && !settings.underAttack) {
        try {
          await sendRecentDigestTo(from);
        } catch (e) {
          console.error("[engine] catch-up digest failed:", e);
        }
      }
      return welcomeFor(from, settings);
    }
    case "help":
      // ⚠️ HELP IS ANSWERED BY THE CARRIER, NOT BY US (user decision,
      // session 017). The Telnyx messaging profile's keyword auto-response
      // replies to HELP; this app used to reply as well, so every member who
      // texted HELP got TWO messages and paid for two.
      //
      // The operational consequence, and it is not small: **that Telnyx
      // auto-response is now the only HELP answer this service gives, and
      // carriers require one.** If it is ever cleared — profile rebuilt,
      // number moved, settings reset — HELP goes unanswered and the 10DLC
      // posture breaks, with nothing in this codebase to notice. It is not
      // visible from here, it is not in version control, and no test can
      // reach it. Check it whenever the messaging profile is touched.
      //
      // The text it must carry, per CTIA: the program name, that message and
      // data rates may apply, how to stop, and how to reach a human. The
      // reply that used to live here is in this file's history if the wording
      // is ever wanted back.
      return null;
    case "ad":
      return handleAdSubmission(from, command.body, msg.media);
    case "pic": {
      if (!command.id) return { body: `Include the ad number — for example: PIC 1042.` };
      const ad = await getAdRecord(command.id);
      // A pending ad is visible only to its OWNER (same rule as STATUS): the
      // seller who just posted deserves "wait for approval," but a stranger
      // probing ad numbers must not learn unreviewed ads exist. A deleted ad
      // is simply gone.
      if (
        !ad ||
        ad.status === "rejected" ||
        ad.status === "deleted" ||
        (ad.status === "pending" && ad.ownerPhone !== from)
      ) {
        return { body: `No ad found with number ${command.id}.` };
      }
      if (ad.status === "pending") {
        return {
          body: `Ad #${command.id} is not yet approved. Its picture will be available when the ad is approved.`,
        };
      }
      if (!ad.photo) return { body: `Ad #${command.id} has no picture.` };
      // What PIC sends depends on what the broadcast already sent (session
      // 018). With picture messages riding the batch, picture 1 is already on
      // every subscriber's phone — badged with this ad number — so PIC is the
      // "show me MORE" command and sends up to two extras. With them off, no
      // picture has gone anywhere and PIC sends the first three, as it always
      // did. The texted set stops at three either way; the rest are on the
      // website, which is what the welcome promises.
      const texted = textedAdPhotos(ad.photo, ad.morePhotos);
      const wanted = settings.photosInBroadcast ? texted.slice(1) : texted;
      const onWebsite = websiteAdPhotos([ad.photo, ...(ad.morePhotos ?? [])]).length;
      if (!wanted.length) {
        // No pull spent: there is nothing to send, and charging for that would
        // be the meanest possible reading of the quota.
        return {
          body:
            `Ad #${command.id} has just the one picture and it went out with the ad.` +
            (onWebsite > texted.length ? ` More at ${site.webHost}.` : ``),
        };
      }
      // Daily allowance + rolling bank — the real MMS cost control. Charged only
      // here, once we're actually about to send a photo (past the not-found /
      // no-photo gates), so a mistyped id never burns a pull. ensureAccount so an
      // accountless puller still gets a quota row; the atomic accrue+spend is
      // race-safe in prod. The hourly smsPicsPerHour cap (reserveSms, above)
      // stays on top as a burst limiter.
      await ensureAccount(from);
      const today = etParts(new Date()).day;
      const quota = await reservePicQuota(
        from,
        settings.picDailyAllowance,
        settings.picBankCap,
        today,
      );
      if (!quota.allowed) {
        // Deduped: a number hammering PIC after running dry hears "you're out" at
        // most once every few hours, not on every pull (still bounded by the
        // hourly PIC cap, which already reserved this slot).
        afterResponse(() =>
          analytics.picPull({ phone: from, outcome: "out_of_pulls", pullsLeft: 0 }),
        );
        const told = await countRecentOutboundContaining(from, PIC_LIMIT_MARKER, 3 * HOUR_MS);
        if (told > 0) return null;
        return { body: picLimitMessage(settings.picDailyAllowance, settings.picBankCap) };
      }
      // Telnyx needs ABSOLUTE media URLs: re-hosted photos already carry one,
      // but a site-relative src (fixtures, pre-re-hosting ads) must be
      // prefixed or the MMS send 400s and the requester hears nothing.
      const absolute = (src: string) => (src.startsWith("http") ? src : `${siteUrl}${src}`);
      const media = wanted.map((p) => absolute(p.src));
      const count = media.length;
      const more = onWebsite > texted.length ? ` See them all at ${site.webHost}.` : ``;
      // Granted, and only here: past the not-found and no-photo gates, with a
      // pull actually spent. Pair the count with the per-MMS cost and this is
      // what pictures cost the service per month.
      afterResponse(() =>
        analytics.picPull({ phone: from, outcome: "granted", pullsLeft: quota.remaining }),
      );
      // "more" only when picture 1 already went out with the batch — otherwise
      // these ARE the ad's pictures, not extras.
      const label = settings.photosInBroadcast ? "more photos" : "photos";
      return {
        body:
          count > 1
            ? `${count} ${label} for ad #${command.id} - ${deriveTitle(ad.body)}.${more}`
            : `Photo for ad #${command.id} - ${deriveTitle(ad.body)}.${more}`,
        media,
      };
    }
    case "credits": {
      const account = await ensureAccount(from);
      // Since session 021 an ad is collected for when it RUNS, so a balance on
      // its own can mislead: $40 with two $20 ads waiting is not $40 to spend.
      // The reply says what is committed, when anything is.
      const funding = await memberFunding(from, account);
      const book = await messageBook();
      return {
        body: book.render("money.balance", {
          balance: formatPrice(funding.balanceCents),
          owedNote: funding.reservedCents
            ? ` Your ads waiting to go out will use ${formatPrice(funding.reservedCents)} of it.`
            : "",
          priceSheet: await priceSheetLine(settings),
          payInstructions: await payInstructions(),
        }),
      };
    }
    case "sold":
      return handleSold(from, command.id);
    case "status": {
      if (!command.id) return { body: `Include the ad number — for example: STATUS 1042.` };
      const ad = await getAdRecord(command.id);
      if (
        !ad ||
        ad.status === "rejected" ||
        ad.status === "deleted" ||
        (ad.status === "pending" && ad.ownerPhone !== from)
      ) {
        return { body: `No ad found with number ${command.id}.` };
      }
      // What the ad still owes (session 021). An ad is collected for when it
      // RUNS, so an approved ad can be sitting there because the money isn't
      // in yet — and "Available" would be the least useful thing to tell the
      // one person who can fix that.
      const stillOwed = (await getAdsOwed([ad.id]).catch(() => new Map<number, number>())).get(
        ad.id,
      );
      const owedNote =
        stillOwed && ad.ownerPhone === from
          ? ` ${formatPrice(stillOwed)} is due when it goes out.`
          : "";
      if (ad.status === "pending" || ad.status === "unpaid") {
        return {
          body: `Ad #${command.id} is waiting for review.${owedNote}`,
        };
      }
      const site_ad: Ad = {
        id: ad.id,
        body: ad.body,
        status: ad.status === "approved" ? "available" : (ad.status as Ad["status"]),
        approvedAt: new Date(ad.approvedAt ?? ad.createdAt),
        ownerPhone: ad.ownerPhone,
      };
      // An approved ad that hasn't run yet isn't on the website either, so
      // "Available" overstates it — say what is actually true.
      if (ad.status === "approved" && stillOwed) {
        return {
          body: `Ad #${ad.id} (${deriveTitle(ad.body)}): approved, waiting to go out.${owedNote}`,
        };
      }
      return { body: `Ad #${ad.id} (${deriveTitle(ad.body)}): ${statusWord(site_ad)}.` };
    }
    case "myads": {
      await ensureAccount(from);
      const ads = await listAdsByOwner(from);
      const pending = (await getPendingAds()).filter((a) => a.ownerPhone === from);
      // Every ad of theirs still waiting on money, including the held ones
      // MY ADS never used to show at all (they are neither approved nor in
      // the review queue) — the whole point is that the seller can see what
      // is stuck and why.
      const waiting = await listOwedAds(from).catch(() => []);
      const owedById = new Map(waiting.map((a) => [a.id, a.owedCents]));
      const held = waiting.filter((a) => a.status === "unpaid");
      const lines = [
        ...pending.map(
          (a) =>
            `#${a.id} waiting for review${owedById.get(a.id) ? ` (${formatPrice(owedById.get(a.id)!)} due)` : ""}`,
        ),
        ...held.map((a) => `#${a.id} on hold - ${formatPrice(a.owedCents)} to pay`),
        ...ads.map((a) =>
          a.status === "available"
            ? owedById.get(a.id)
              ? `#${a.id} approved, ${formatPrice(owedById.get(a.id)!)} due before it goes out`
              : `#${a.id} Available (runs through ${fmtDate(adExpiresAt(a))})`
            : `#${a.id} ${statusWord(a)}`,
        ),
      ];
      if (!lines.length) {
        return { body: `No ads on this number yet. Text AD and your ad to post one.` };
      }
      return { body: `Your ads: ${lines.join(" · ")}` };
    }
    case "rate": {
      const context = await getSmsContext(from);
      if (!context || context.kind !== "rate" || !context.otherPhone || !context.ratedRole) {
        return {
          body: `There's no rating waiting from this number. Ratings open after a sale is confirmed (the seller marks the ad SOLD and names the buyer).`,
        };
      }
      if (!command.stars) {
        return { body: `Rate 1 to 5 stars — for example: RATE 5.` };
      }
      const outcome = await addRating(
        context.adId,
        from,
        context.otherPhone,
        context.ratedRole,
        command.stars,
      );
      await clearSmsContext(from);
      if (outcome === "duplicate") {
        return { body: `You already rated the ${context.ratedRole} of ad #${context.adId}.` };
      }
      if (outcome === "notconfirmed") {
        return {
          body: `That sale isn't on record, so the rating can't be saved. Ratings open after the seller marks the ad SOLD and names the buyer.`,
        };
      }
      if (outcome === "unsupported") return { body: `Thanks!` };
      return {
        body: `Thanks! Your ${command.stars}-star rating of the ${context.ratedRole} of ad #${context.adId} is saved.`,
      };
    }
    case "skip": {
      const context = await getSmsContext(from);
      if (!context) {
        return {
          body: `This is ${site.name}'s automated system. Text HELP for a list of commands.`,
        };
      }
      await clearSmsContext(from);
      return { body: `No problem.` };
    }
    case "category": {
      // Category words behave like any unknown word until migration 9976 is
      // pasted — the graceful pre-paste degrade (never a 500, never a promise
      // the store can't keep).
      const current = await getSubscriberCategories(from);
      if (current === "unsupported") return unknownReply(from, settings);
      // Non-subscribers (strangers, STOPped numbers) get the unknown-word
      // treatment: they have no digest for these words to steer, the toggle
      // copy ("You will now receive…") would be a false promise (digests
      // filter on subscribed_at), and minting an account here was the cheap
      // flood vector the STOP/unknown paths deliberately avoid. getAccount
      // never mints; every subscriber already has a row (SUBSCRIBE/START).
      const account = await getAccount(from);
      if (!account?.subscribedAt) return unknownReply(from, settings);
      let body: string;
      let emptied = false;
      if (command.category === "all") {
        await setSubscriberCategories(from, null);
        body = ALL_CATEGORIES_SMS;
      } else {
        const toggled = toggleCategory(current, command.category);
        await setSubscriberCategories(from, toggled.next);
        // Removing the LAST category is allowed but warned — never silently
        // dark (user decision, item 24).
        emptied = toggled.emptied;
        body = toggled.emptied
          ? EMPTY_CATEGORIES_SMS
          : categoryToggleSms(command.category, toggled.on);
      }
      // Spam guard: the state change above ALWAYS stands; only the outbound
      // confirmation is throttled (one notice past the limit, then silence for
      // the hour). Rides on top of the reserveSms reservation handleInbound
      // already took for this inbound.
      const throttle = await reserveCategoryConfirm(from, settings.categoryConfirmsPerHour);
      // The emptied-last-category warning is EXEMPT from the silencing —
      // "allowed but never silent" is unconditional (user decision, item 24).
      // It still counted toward the window above, and the reserveSms hourly
      // cap remains the backstop on total outbound.
      if (emptied) return { body };
      if (throttle === "silent") return null;
      if (throttle === "notice") return { body: THROTTLE_NOTICE_SMS };
      return { body };
    }
    case "list": {
      const current = await getSubscriberCategories(from);
      if (current === "unsupported") return unknownReply(from, settings);
      // Same non-subscriber gate as the toggles: a stranger has no categories
      // to list and "every category (ALL)" would be false for them — and the
      // accountless path had no throttle row, making LIST a cheaper reply-
      // extraction vector than gibberish.
      const account = await getAccount(from);
      if (!account?.subscribedAt) return unknownReply(from, settings);
      // LIST is a free-form status check in the same throttle class as the
      // toggle confirmations (item 24) — hammering LIST goes quiet too.
      const throttle = await reserveCategoryConfirm(from, settings.categoryConfirmsPerHour);
      if (throttle === "silent") return null;
      if (throttle === "notice") return { body: THROTTLE_NOTICE_SMS };
      return { body: listSms(current) };
    }
    case "unknown":
      return unknownReply(from, settings);
  }
}

/**
 * The unknown-keyword reply: no ensureAccount (gibberish from a spoofed
 * number shouldn't mint an account), one redirect per number per day, and
 * nothing at all while UNDER ATTACK. Shared with the pre-migration category
 * degrade so an unpasted 9976 changes nothing about unknown-word behavior.
 */
async function unknownReply(from: string, settings: EngineSettings): Promise<Reply | null> {
  if (settings.underAttack) return null;
  const recent = await countRecentOutboundContaining(from, REDIRECT_MARKER, 24 * 60 * 60 * 1000);
  if (recent > 0) return null; // logged, no reply — one redirect per day
  return {
    body: (await messageBook()).render("unknown.redirect", {
      siteName: site.name,
      supportPhone: site.supportPhone,
    }),
  };
}

async function sendReply(to: string, reply: Reply, settings?: EngineSettings): Promise<Reply> {
  // Through the outbound guard: a FULL pause suppresses all replies, a PARTIAL
  // pause lets them through, the blocklist drops blocked numbers, and the
  // under-attack throttle can defer. Only log what actually went out.
  const cls = reply.media?.length ? "pic" : "reply";
  const { sent } = await dispatchSms(to, reply.body, { cls, media: reply.media, settings });
  if (sent) {
    await logMessage({
      direction: "outbound",
      channel: reply.media?.length ? "mms" : "sms",
      address: to,
      body: reply.body,
      ...(reply.media?.length && { media: reply.media }),
    });
  }
  // Follow-ups go one at a time, in order, so the sequence lands the way it
  // reads. A suppressed first message (pause, blocklist) suppresses these too
  // — dispatchSms is the single gate.
  for (const body of reply.extra ?? []) {
    const followUp = await dispatchSms(to, body, { cls: "reply", settings });
    if (followUp.sent) {
      await logMessage({ direction: "outbound", channel: "sms", address: to, body });
    }
  }
  return reply;
}

/** Entry point for the Telnyx webhook and the dev simulator. */
export async function handleInbound(msg: InboundSms, providerId?: string): Promise<Reply | null> {
  // Inbound idempotency, race-safe: record the message and bail if this
  // provider id was already handled (a concurrent Telnyx retry loses the
  // unique-index insert), so an AD NEW can't be double-posted or double-charged.
  const fresh = await recordInboundOnce({
    direction: "inbound",
    channel: msg.media?.length ? "mms" : "sms",
    address: msg.from,
    body: msg.text,
    ...(msg.media?.length && { media: msg.media }),
    ...(providerId && { providerId }),
  });
  if (!fresh) return null;

  // UNDER ATTACK blocklist: the inbound was logged above (forensics), but a
  // blocked number gets no account, no reply, and no charge — dropped here
  // before anything else runs.
  if (await isBlockedNumber(msg.from)) return null;

  // Everything past the dedup is wrapped so a throw can't be SILENTLY EATEN:
  // recordInboundOnce already logged this provider id, so a Telnyx retry would
  // find it handled and reply nothing (the "retry-swallow" trap that has eaten
  // texts before). On an unexpected failure we LOG the real error (for
  // diagnosis) and send the sender a friendly, deduped heads-up instead of
  // going dark. The happy path is unchanged.
  try {
    const command = parseCommand(msg.text || "");
    const settings = await getEngineSettings();

    // STOP always takes effect (unsubscribe — honored even under attack); only
    // the carrier confirmation is deduped to once per number per day, so a STOP
    // loop isn't unbounded outbound.
    if (command.kind === "stop") {
      const reply = await route(msg, command, settings);
      if (!reply) return null;
      const recentStop = await countRecentOutboundContaining(msg.from, STOP_MARKER, 24 * HOUR_MS);
      if (recentStop > 0) return null;
      return sendReply(msg.from, reply, settings);
    }

    // HELP is answered by the carrier's keyword auto-response now, not by us
    // (see the "help" case in route()). Returning here rather than routing
    // means it does not spend the member's hourly reply allowance either — a
    // command we send nothing for must not be able to use up the budget that a
    // real command needs.
    if (command.kind === "help") return null;

    // Reserve a send slot atomically BEFORE routing, so an over-cap command is
    // dropped whole — never charged with its confirmation silently suppressed.
    // Kind is known from the command (PIC replies are the costly MMS lane).
    // Caps auto-tighten while UNDER ATTACK.
    const kind = command.kind === "pic" ? "pic" : "reply";
    const caps = effectiveSmsCaps(settings);
    const allowed = await reserveSms(
      msg.from,
      kind,
      caps.repliesPerHour,
      caps.globalPerHour,
      caps.picsPerHour,
      HOUR_MS,
    );
    if (!allowed) {
      // A real member just got silence. Counting it is how we find out whether
      // the abuse guards are biting the people they are meant to protect.
      afterResponse(() =>
        analytics.smsReplySuppressed({
          phone: msg.from,
          reason: settings.underAttack ? "under_attack" : "rate_limit",
          messageClass: kind,
        }),
      );
      return null;
    }

    const reply = await route(msg, command, settings);
    if (!reply) return null;
    return sendReply(msg.from, reply, settings);
  } catch (e) {
    console.error(`[inbound] processing failed for ${msg.from}:`, e);
    // Don't leave the sender in silence (and don't let the message be eaten by
    // the retry dedup). One friendly reply per number per hour, best-effort.
    try {
      const recentErr = await countRecentOutboundContaining(msg.from, ERROR_REPLY_MARKER, HOUR_MS);
      if (recentErr > 0) return null;
      return await sendReply(msg.from, {
        body:
          `Sorry — ${ERROR_REPLY_MARKER} and your text didn't go through. ` +
          `Please try again in a few minutes, or call ${site.supportPhone} for help.`,
      });
    } catch (inner) {
      console.error(`[inbound] failure-notice also failed for ${msg.from}:`, inner);
      return null;
    }
  }
}
