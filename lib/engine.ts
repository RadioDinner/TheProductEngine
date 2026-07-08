/**
 * The inbound SMS engine: every message from any phone flows through
 * handleInbound — from the Telnyx webhook in production, from the dev
 * simulator locally. Replies are sent through the transport and everything
 * (both directions) lands in the message audit log.
 */
import { parseCommand } from "@/lib/commands";
import { deriveTitle, adExpiresAt, type Ad } from "@/lib/ads";
import {
  countRecentOutboundContaining,
  createAd,
  getAdRecord,
  getPendingAds,
  listMessages,
  logMessage,
  queueBump,
  recordInboundOnce,
  rejectAdRecord,
  reserveSms,
  reviveAd,
  markAdSold,
} from "@/lib/engine-store";
import { listAdsByOwner } from "@/lib/ads";
import { sendRecentDigestTo } from "@/lib/digest-engine";
import {
  addLedgerEntry,
  consumeFreeAd,
  ensureAccount,
  getAccount,
  getCreditBalance,
  hasLedgerRef,
  setSubscribed,
  spendCredits,
} from "@/lib/store";
import { discountedCents, formatPrice, packs, site } from "@/lib/config";
import { getEngineSettings, getWordRules, matchWordRules, effectiveSmsCaps } from "@/lib/settings";
import type { EngineSettings } from "@/lib/settings";
import { stripEmoji, hasLink, mayPostLinks } from "@/lib/content-filter";
import { isAllowedPhotoSrc } from "@/lib/media";
import { chargeSavedCard, paymentsDevMode } from "@/lib/payments";
import { devToolsEnabled } from "@/lib/env";
import { dispatchSms } from "@/lib/outbound";
import { isBlockedNumber } from "@/lib/blocklist";
import { notifyAdminNewAd } from "@/lib/notify";

export interface InboundSms {
  from: string; // 10 digits
  text: string;
  media?: string[];
}

export interface Reply {
  body: string;
  media?: string[];
}

const REDIRECT_MARKER = "automated system";
const STOP_MARKER = "unsubscribed and won't get more";
const HOUR_MS = 60 * 60 * 1000;

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

async function handleAdSubmission(from: string, rawBody: string, media?: string[]): Promise<Reply> {
  const account = await ensureAccount(from);
  if (account.postingBannedAt) {
    return {
      body: `Your posting privileges are suspended. Contact us at ${site.supportPhone} or appeal at ThePlainExchange.com.`,
    };
  }
  // Strip emoji before anything else: they never appear in a stored or
  // broadcast ad (an emoji flips a whole SMS digest to costly UCS-2 and reads
  // badly on a flip phone). The raw text the sender typed still lives in the
  // message audit log. An ad that was ONLY emoji is now empty → same guidance.
  const body = stripEmoji(rawBody);
  if (!body) {
    return {
      body: `To post an ad, text AD NEW and your ad — for example: AD NEW Horse cart for sale, $1,000 OBO. Call 330-555-0142.`,
    };
  }
  const settings = await getEngineSettings();
  if (body.length > settings.maxChars) {
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
    return {
      body: `Your ad can't be accepted — it appears to offer something we can't run. Nothing was charged. Text HELP for help or see ThePlainExchange.com/how-it-works.`,
    };
  }

  // Accept a photo source only from an allowlisted host (site-relative path or
  // an https Supabase/Telnyx URL) — never a data:/http:/off-site/protocol-
  // relative URL from a crafted inbound MMS.
  const photoSrc = media?.[0];
  const hasPhoto = isAllowedPhotoSrc(photoSrc);
  const cost = hasPhoto ? settings.costPhoto : settings.costText;
  const canPass = account.freeAds > 0;
  const balance = await getCreditBalance(from);
  // Fast reject for the clearly-unfunded; the atomic charge below is the
  // authority under concurrency.
  if (!canPass && balance < cost) {
    return {
      body: `That ad needs ${cost} credit${cost === 1 ? "" : "s"} and you have ${balance}. Buy credits at ThePlainExchange.com, or call ${site.supportPhone}. Text CREDITS to check your balance.`,
    };
  }

  // Links are walled-garden-blocked for now: don't strip or auto-reject, just
  // FLAG so a human reviews (edits the link out, or rejects). A future
  // verified-advertiser tier flips mayPostLinks() without touching this path.
  const containsLink = !mayPostLinks() && hasLink(body);

  const kind = hasPhoto ? "picture" : "text";
  const id = await createAd({
    ownerPhone: from,
    body,
    flagged: rules.flagged || containsLink,
    ...(hasPhoto && {
      photo: { src: photoSrc!, alt: deriveTitle(body), width: 800, height: 600 },
    }),
  });

  // Charge atomically. Free pass first (its decrement is race-safe); else an
  // atomic credit debit. If both fail — the balance was spent by a concurrent
  // AD NEW between the check and here — undo the ad instead of posting unpaid.
  let chargeNote: string;
  if (canPass && (await consumeFreeAd(from))) {
    await addLedgerEntry(from, {
      delta: 0,
      kind: "spend",
      note: `Free ad used — ad #${id} (${kind})`,
    });
    chargeNote = `Used 1 free ad — ${Math.max(0, account.freeAds - 1)} left.`;
  } else if (await spendCredits(from, cost, `Ad #${id} (${kind})`)) {
    chargeNote = `${cost} credit${cost === 1 ? "" : "s"} — ${Math.max(0, balance - cost)} left.`;
  } else {
    await rejectAdRecord(id, "Not enough credits at submission.", "benign");
    return {
      body: `That ad needs ${cost} credit${cost === 1 ? "" : "s"} and you don't have enough right now. Buy credits at ThePlainExchange.com, or call ${site.supportPhone}.`,
    };
  }

  await notifyAdminNewAd({ id, from, hasPhoto, body });

  return {
    body: `Got it! Your ad is #${id} and is waiting for review. You'll get a text when it's approved for the next digest. (${chargeNote})`,
  };
}

async function handleOwnerCommand(
  from: string,
  id: number | null,
  verb: "sold" | "bump",
): Promise<Reply> {
  if (!id) {
    return { body: `Include the ad number — for example: ${verb.toUpperCase()} 1042.` };
  }
  const ad = await getAdRecord(id);
  if (!ad || ad.ownerPhone !== from) {
    return { body: `Ad #${id} doesn't belong to this number.` };
  }

  if (verb === "sold") {
    if (ad.status === "sold") return { body: `Ad #${id} is already marked sold.` };
    if (ad.status === "rejected") return { body: `Ad #${id} was not accepted, so there's nothing to mark sold.` };
    // Only a live listing can be sold. Blocking `pending` closes a moderation
    // bypass: SOLD on an unreviewed ad would publish it to the site as "sold".
    if (ad.status === "pending") {
      return { body: `Ad #${id} is still waiting for review — you can mark it sold once it's approved.` };
    }
    await markAdSold(id);
    return { body: `Ad #${id} marked SOLD. Congratulations!` };
  }

  // bump
  if (ad.status === "sold") return { body: `Ad #${id} is marked sold — nothing to bump.` };
  if (ad.status === "rejected") return { body: `Ad #${id} was not accepted and can't be bumped.` };
  if (ad.status === "pending") {
    return { body: `Ad #${id} is still waiting for review — it runs automatically once approved.` };
  }

  const settings = await getEngineSettings();
  // Charge the admin-set bump cost before re-broadcasting. At the default of 0
  // bumps stay free; above 0 this stops unlimited free re-runs to the whole list.
  if (settings.bumpCost > 0) {
    const paid = await spendCredits(from, settings.bumpCost, `Bump — ad #${id}`);
    if (!paid) {
      return {
        body: `A bump costs ${settings.bumpCost} credit${settings.bumpCost === 1 ? "" : "s"} and you don't have enough. Buy credits at ThePlainExchange.com.`,
      };
    }
  }
  const refundBump = async () => {
    if (settings.bumpCost > 0) {
      await addLedgerEntry(from, {
        delta: settings.bumpCost,
        kind: "refund",
        note: `Bump not applied — ad #${id}`,
      });
    }
  };

  if (ad.status === "expired") {
    await reviveAd(id, settings.expiryDays);
    // Refund if a bump was already queued (starved past the old TTL) so this
    // BUMP doesn't charge a second time for a broadcast that's already pending.
    const revivedQueued = await queueBump(id);
    if (!revivedQueued) await refundBump();
    return { body: `Ad #${id} is relisted and will run again in the next digest.` };
  }
  const queued = await queueBump(id);
  if (!queued) {
    await refundBump();
    return { body: `You already have a bump scheduled for ad #${id}.` };
  }
  return { body: `Ad #${id} will run again in the next digest.` };
}

/** The credit pack whose size matches a requested credit count, if any. */
function packByCredits(credits: number | null): (typeof packs)[number] | null {
  if (!credits) return null;
  return packs.find((p) => p.credits === credits) ?? null;
}

const BUYCREDIT_WINDOW_MS = 15 * 60 * 1000;

/** BUYCREDIT <n>: quote a saved-card purchase and ask for a YES to confirm. */
async function handleBuyCredit(from: string, amount: number | null): Promise<Reply> {
  const account = await ensureAccount(from);
  if (!account.stripeCustomerId) {
    return {
      body: `No card is saved for this number yet. Buy credits at ThePlainExchange.com, or call ${site.supportPhone} to set up payment by phone, check, or a saved card.`,
    };
  }
  const pack = packByCredits(amount);
  if (!pack) {
    const sizes = packs.map((p) => p.credits).join(", ");
    return {
      body: `Text BUYCREDIT and a pack size (${sizes}) — for example BUYCREDIT ${packs[0]?.credits ?? 10}.`,
    };
  }
  const settings = await getEngineSettings();
  const price = discountedCents(pack.priceCents, settings.savedCardDiscountPercent);
  const discount =
    settings.savedCardDiscountPercent > 0
      ? ` (${settings.savedCardDiscountPercent}% saved-card discount)`
      : "";
  return {
    body: `Buy ${pack.credits} credits for ${formatPrice(price)}${discount} on your saved card? Reply YES within 15 minutes to confirm. Reply anything else to cancel.`,
  };
}

/** YES: confirm the most recent BUYCREDIT quote and charge the saved card. */
async function handleConfirmPurchase(from: string): Promise<Reply> {
  const account = await getAccount(from);
  const cancel = {
    body: `Nothing to confirm. Text BUYCREDIT ${packs[0]?.credits ?? 10} to buy credits with your saved card.`,
  };
  if (!account?.stripeCustomerId) return cancel;

  // Find the newest still-valid BUYCREDIT quote in the audit log (no extra
  // state needed): the message this YES is confirming.
  const recent = await listMessages(from, 50);
  const cutoff = Date.now() - BUYCREDIT_WINDOW_MS;
  let buy: { pack: (typeof packs)[number]; msgId: number } | null = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m.direction !== "inbound") continue;
    if (Date.parse(m.createdAt) < cutoff) break;
    const cmd = parseCommand(m.body || "");
    if (cmd.kind === "buycredit") {
      const pack = packByCredits(cmd.amount);
      if (pack) buy = { pack, msgId: m.id };
      break; // the most recent BUYCREDIT wins, valid pack or not
    }
  }
  if (!buy) return cancel;

  const settings = await getEngineSettings();
  const price = discountedCents(buy.pack.priceCents, settings.savedCardDiscountPercent);
  // Deterministic ref (the quote message) → idempotent charge AND grant.
  const ref = `buycredit:${from}:${buy.msgId}`;
  if (await hasLedgerRef(ref)) {
    return {
      body: `Those ${buy.pack.credits} credits were already added — you have ${await getCreditBalance(from)}.`,
    };
  }

  let result: { ok: boolean; last4?: string; reason?: string };
  if (!paymentsDevMode) {
    result = await chargeSavedCard({
      customerId: account.stripeCustomerId,
      amountCents: price,
      ref,
      phone: from,
      packId: buy.pack.id,
      credits: buy.pack.credits,
    });
  } else if (devToolsEnabled) {
    result = { ok: true, last4: "0000" }; // dev simulation (never in a real prod deploy)
  } else {
    return {
      body: `Buying by text isn't available right now. Buy credits at ThePlainExchange.com or call ${site.supportPhone}.`,
    };
  }

  if (!result.ok) {
    return {
      body: `We couldn't charge your saved card${result.reason ? ` (${result.reason})` : ""}. Buy at ThePlainExchange.com or call ${site.supportPhone}.`,
    };
  }
  await addLedgerEntry(from, {
    delta: buy.pack.credits,
    kind: "purchase",
    note: `Purchased ${buy.pack.credits} credits (${formatPrice(price)}) — saved card`,
    ref,
  });
  const last4 = result.last4 ? ` to your card ending ${result.last4}` : "";
  return {
    body: `Charged ${formatPrice(price)}${last4}. ${buy.pack.credits} credits added — you have ${await getCreditBalance(from)}.`,
  };
}

async function route(
  msg: InboundSms,
  command: ReturnType<typeof parseCommand>,
  settings: EngineSettings,
): Promise<Reply | null> {
  const from = msg.from;

  // A bare photo with no usable text (spec Q13).
  if (msg.media?.length && command.kind === "unknown" && !msg.text.trim()) {
    return {
      body: `To post an ad with this picture, resend it with your ad text, like: AD NEW Horse cart for sale $1,000, call ${site.smsNumber}.`,
    };
  }

  switch (command.kind) {
    case "subscribe": {
      const account = await ensureAccount(from);
      if (account.subscribedAt) {
        return { body: `You're already subscribed. Ads come up to 4 times a day. Reply STOP to cancel, HELP for help.` };
      }
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
      return {
        body: `You're subscribed to ${site.name} — ${site.region} classifieds by text, up to 4 digests a day. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`,
      };
    }
    case "stop": {
      // No ensureAccount here: a STOP from an unknown number shouldn't mint an
      // account (+ starter free ads) — that was a cheap flood vector.
      await setSubscribed(from, false);
      return {
        body: `${site.name}: you're unsubscribed and won't get more digests. Reply START any time to come back.`,
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
      return {
        body: `You're subscribed to ${site.name} — up to 4 digests a day. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`,
      };
    }
    case "help":
      return {
        body:
          `${site.name} classifieds by text. Up to 4 digests/day. Msg&data rates may apply. ` +
          `Cmds: SUBSCRIBE for ads. AD NEW your ad to post. PIC 1234 for a picture. ` +
          `SOLD/BUMP/STATUS/MYADS/CREDITS. Reply STOP to cancel. ` +
          `Help: call ${site.supportPhone} or ThePlainExchange.com/sms`,
      };
    case "ad":
      return handleAdSubmission(from, command.body, msg.media);
    case "pic": {
      if (!command.id) return { body: `Include the ad number — for example: PIC 1042.` };
      const ad = await getAdRecord(command.id);
      if (!ad || ad.status === "pending" || ad.status === "rejected") {
        return { body: `No ad found with number ${command.id}.` };
      }
      if (!ad.photo) return { body: `Ad #${command.id} has no picture.` };
      // The per-number PIC/MMS cap is enforced atomically at send time
      // (reserveSms with kind "pic"), so no separate check is needed here.
      return { body: `Photo for ad #${command.id} — ${deriveTitle(ad.body)}:`, media: [ad.photo.src] };
    }
    case "credits": {
      const account = await ensureAccount(from);
      const balance = await getCreditBalance(from);
      return {
        body: `You have ${account.freeAds} free ad${account.freeAds === 1 ? "" : "s"} and ${balance} credit${balance === 1 ? "" : "s"} available.`,
      };
    }
    case "sold":
      return handleOwnerCommand(from, command.id, "sold");
    case "bump":
      return handleOwnerCommand(from, command.id, "bump");
    case "status": {
      if (!command.id) return { body: `Include the ad number — for example: STATUS 1042.` };
      const ad = await getAdRecord(command.id);
      if (!ad || ad.status === "rejected" || (ad.status === "pending" && ad.ownerPhone !== from)) {
        return { body: `No ad found with number ${command.id}.` };
      }
      if (ad.status === "pending") {
        return { body: `Ad #${command.id} is waiting for review.` };
      }
      const site_ad: Ad = {
        id: ad.id,
        body: ad.body,
        status: ad.status === "approved" ? "available" : (ad.status as Ad["status"]),
        approvedAt: new Date(ad.approvedAt ?? ad.createdAt),
        ownerPhone: ad.ownerPhone,
      };
      return { body: `Ad #${ad.id} (${deriveTitle(ad.body)}): ${statusWord(site_ad)}.` };
    }
    case "myads": {
      await ensureAccount(from);
      const ads = await listAdsByOwner(from);
      const pending = (await getPendingAds()).filter((a) => a.ownerPhone === from);
      const lines = [
        ...pending.map((a) => `#${a.id} waiting for review`),
        ...ads.map((a) =>
          a.status === "available"
            ? `#${a.id} Available (runs through ${fmtDate(adExpiresAt(a))})`
            : `#${a.id} ${statusWord(a)}`,
        ),
      ];
      if (!lines.length) {
        return { body: `No ads on this number yet. Text AD NEW and your ad to post one.` };
      }
      return { body: `Your ads: ${lines.join(" · ")}` };
    }
    case "buycredit":
      return handleBuyCredit(from, command.amount);
    case "confirm":
      return handleConfirmPurchase(from);
    case "unknown": {
      // No ensureAccount: gibberish from a spoofed number shouldn't mint an
      // account. While UNDER ATTACK we don't even send the one-per-day redirect
      // — no spend on unknown/gibberish traffic at all.
      if (settings.underAttack) return null;
      const recent = await countRecentOutboundContaining(from, REDIRECT_MARKER, 24 * 60 * 60 * 1000);
      if (recent > 0) return null; // logged, no reply — one redirect per day
      return {
        body: `This is ${site.name}'s automated system. To reach a seller, use the contact info in their ad. Text HELP for a list of commands.`,
      };
    }
  }
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
  if (!allowed) return null;

  const reply = await route(msg, command, settings);
  if (!reply) return null;
  return sendReply(msg.from, reply, settings);
}
