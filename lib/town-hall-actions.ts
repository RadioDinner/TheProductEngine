"use server";

/**
 * Town hall event submission (FEATURES item 18, v1). Signed-in members list
 * upcoming events for FREE; every submission waits for the same admin review
 * as an ad (approve/decline on /admin — decline refunds nothing because
 * nothing was charged). Content rules match the walled garden: emoji are
 * stripped, and links are simply NOT allowed in event text in v1 (rejected
 * with a friendly note — stricter than ads' flag-for-review, by design: a
 * free board would otherwise be the cheapest link-drop in the product).
 *
 * The paid SMS/email event blast is PHASE 2 — nothing here touches payments.
 * Outcomes are signaled repo-style: redirect() with query params.
 */

import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { ensureAccount } from "@/lib/store";
import { hasLink, stripEmoji } from "@/lib/content-filter";
import { etParts } from "@/lib/et";
import {
  EVENT_BODY_MAX,
  EVENT_PLACE_MAX,
  EVENT_TIME_MAX,
  EVENT_TITLE_MAX,
  eventDateVerdict,
} from "@/lib/town-hall";
import { submitEvent } from "@/lib/town-hall-store";

export async function submitTownHallEvent(formData: FormData): Promise<void> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Ftown-hall");

  // Same posting-ban gate as every submission lane.
  const account = await ensureAccount(session.phone);
  if (account.postingBannedAt) redirect("/town-hall?error=banned#add");

  const title = stripEmoji(String(formData.get("title") ?? ""));
  const date = String(formData.get("date") ?? "").trim();
  const timeText = stripEmoji(String(formData.get("time") ?? ""));
  const placeText = stripEmoji(String(formData.get("place") ?? ""));
  const body = stripEmoji(String(formData.get("body") ?? ""));

  if (!title || !body) redirect("/town-hall?error=empty#add");
  if (
    title.length > EVENT_TITLE_MAX ||
    timeText.length > EVENT_TIME_MAX ||
    placeText.length > EVENT_PLACE_MAX ||
    body.length > EVENT_BODY_MAX
  ) {
    redirect("/town-hall?error=toolong#add");
  }

  const verdict = eventDateVerdict(date, etParts(new Date()).day);
  if (verdict !== "ok") {
    redirect(`/town-hall?error=${verdict === "invalid" ? "date" : verdict}#add`);
  }

  // No links in event text, v1 — friendlier said up front than at review.
  if ([title, timeText, placeText, body].some((text) => hasLink(text))) {
    redirect("/town-hall?error=link#add");
  }

  const outcome = await submitEvent({
    ownerPhone: session.phone,
    title,
    eventDate: date,
    timeText: timeText || null,
    placeText: placeText || null,
    body,
  });
  if (outcome === "unsupported") redirect("/town-hall?error=notopen#add");
  redirect("/town-hall?submitted=1");
}
