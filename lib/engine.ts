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
  logMessage,
  queueBump,
  recordInboundOnce,
  rejectAdRecord,
  reserveSms,
  reviveAd,
  markAdSold,
} from "@/lib/engine-store";
import { listAdsByOwner } from "@/lib/ads";
import {
  addLedgerEntry,
  consumeFreeAd,
  ensureAccount,
  getCreditBalance,
  setSubscribed,
  spendCredits,
} from "@/lib/store";
import { site } from "@/lib/config";
import { getEngineSettings, getWordRules, matchWordRules } from "@/lib/settings";
import { isAllowedPhotoSrc } from "@/lib/media";
import { sms } from "@/lib/sms";
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

async function handleAdSubmission(from: string, body: string, media?: string[]): Promise<Reply> {
  const account = await ensureAccount(from);
  if (account.postingBannedAt) {
    return {
      body: `Your posting privileges are suspended. Contact us at ${site.smsNumber} or appeal at ThePlainExchange.com.`,
    };
  }
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
      body: `That ad needs ${cost} credit${cost === 1 ? "" : "s"} and you have ${balance}. Buy credits at ThePlainExchange.com, or call ${site.smsNumber}. Text CREDITS to check your balance.`,
    };
  }

  const kind = hasPhoto ? "picture" : "text";
  const id = await createAd({
    ownerPhone: from,
    body,
    flagged: rules.flagged,
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
      body: `That ad needs ${cost} credit${cost === 1 ? "" : "s"} and you don't have enough right now. Buy credits at ThePlainExchange.com, or call ${site.smsNumber}.`,
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

async function route(msg: InboundSms, command: ReturnType<typeof parseCommand>): Promise<Reply | null> {
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
      await ensureAccount(from);
      await setSubscribed(from, true);
      return {
        body: `You're subscribed to ${site.name} — up to 4 digests a day. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`,
      };
    }
    case "help":
      return {
        body:
          `${site.name} commands: SUBSCRIBE for the ads. AD NEW your ad (photo welcome) to post. ` +
          `PIC 1234 for a picture. STATUS 1234 to check an ad. SOLD 1234 / BUMP 1234 / MYADS for your ads. ` +
          `CREDITS for your balance. STOP to quit. More help: call ${site.smsNumber} or ThePlainExchange.com/how-it-works`,
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
      return {
        body: `No card is saved for this number yet. Buy credits at ThePlainExchange.com, or call ${site.smsNumber} to set up payment by phone or mail.`,
      };
    case "unknown": {
      // No ensureAccount: gibberish from a spoofed number shouldn't mint an
      // account. The redirect is still deduped to once per day.
      const recent = await countRecentOutboundContaining(from, REDIRECT_MARKER, 24 * 60 * 60 * 1000);
      if (recent > 0) return null; // logged, no reply — one redirect per day
      return {
        body: `This is ${site.name}'s automated system. To reach a seller, use the contact info in their ad. Text HELP for a list of commands.`,
      };
    }
  }
}

async function sendReply(to: string, reply: Reply): Promise<Reply> {
  await sms.send(to, reply.body, reply.media);
  await logMessage({
    direction: "outbound",
    channel: reply.media?.length ? "mms" : "sms",
    address: to,
    body: reply.body,
    ...(reply.media?.length && { media: reply.media }),
  });
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

  const command = parseCommand(msg.text || "");

  // STOP always takes effect (unsubscribe); only the carrier confirmation is
  // deduped to once per number per day, so a STOP loop isn't unbounded outbound.
  if (command.kind === "stop") {
    const reply = await route(msg, command);
    if (!reply) return null;
    const recentStop = await countRecentOutboundContaining(msg.from, STOP_MARKER, 24 * HOUR_MS);
    if (recentStop > 0) return null;
    return sendReply(msg.from, reply);
  }

  // Reserve a send slot atomically BEFORE routing, so an over-cap command is
  // dropped whole — never charged with its confirmation silently suppressed.
  // Kind is known from the command (PIC replies are the costly MMS lane).
  const settings = await getEngineSettings();
  const kind = command.kind === "pic" ? "pic" : "reply";
  const allowed = await reserveSms(
    msg.from,
    kind,
    settings.smsRepliesPerHour,
    settings.smsGlobalPerHour,
    settings.smsPicsPerHour,
    HOUR_MS,
  );
  if (!allowed) return null;

  const reply = await route(msg, command);
  if (!reply) return null;
  return sendReply(msg.from, reply);
}
