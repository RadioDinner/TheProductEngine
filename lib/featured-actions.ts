"use server";

import "@/analytics/src/register-after";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { addFeaturedRequest, listPendingRequests } from "@/lib/featured-requests";
import { acceptableSpotLink } from "@/lib/featured";
import { normalizePhone } from "@/lib/phone";
import { stripEmoji } from "@/lib/content-filter";
import { notifyOperator } from "@/lib/notify";
import { site } from "@/lib/config";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limits";
import { storeImageBytes } from "@/lib/photos";
import { sniffImage, CONTENT_TYPE_BY_EXT } from "@/lib/image-sniff";
import { supabaseConfigured } from "@/lib/db";

/** Same ceiling every other upload uses — deliberately BELOW the platform's
 * request-body cap, so an oversized file fails with our message rather than a
 * blank error page (the lesson of the session-016 upload outage). */
const MAX_FEATURED_IMAGE_BYTES = MAX_UPLOAD_BYTES;

/** Trim, strip emoji, and cap — the same treatment every other public free-text
 * field gets before it reaches the database or an operator's screen. */
function clean(raw: FormDataEntryValue | null, max: number): string {
  return stripEmoji(String(raw ?? "").trim()).slice(0, max);
}

/**
 * Ask for a featured ad or premium business listing (session 019).
 *
 * Deliberately NOT a payment step. The request joins the queue, the operator
 * reviews it, and only an approved listing is charged — which is what lets the
 * page promise "nothing is charged for a listing that never runs". The three
 * ways to pay sit beside the form for whoever wants to settle up now.
 *
 * Open to anyone signed in OR not: a business wanting to advertise is often
 * not a member yet, and making them make an account first is a good way to
 * lose the sale. A signed-in session fills the contact details in.
 */
export async function submitFeaturedRequest(formData: FormData): Promise<void> {
  const session = await readSession();

  const businessName = clean(formData.get("businessName"), 80);
  const contactName = clean(formData.get("contactName"), 80);
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = normalizePhone(rawPhone) ?? (session?.phone ?? null);
  const email = clean(formData.get("email"), 120).toLowerCase() || null;
  const note = clean(formData.get("note"), 500) || null;

  const kind = formData.get("kind") === "featured_ad" ? "featured_ad" : "business";

  // Where the spot goes when someone clicks it (user, session 019): "It'll
  // either go to the link they choose, or open the ad they want to feature."
  const rawLink = String(formData.get("linkUrl") ?? "").trim();
  const linkUrl = rawLink && acceptableSpotLink(rawLink) ? rawLink : null;
  const adIdRaw = Number(String(formData.get("adId") ?? "").trim());
  const adId = Number.isInteger(adIdRaw) && adIdRaw > 0 ? adIdRaw : null;

  const back = (query: string) => redirect(`/featured?${query}`);

  if (!businessName) back("error=name");
  // A way to reach them is the whole point of a request — without one there is
  // nothing to approve, only a name on a list.
  if (!phone && !email) back("error=contact");
  // A link that isn't a real absolute http(s) URL was typed wrong; saying so
  // beats silently dropping it and running a spot that goes nowhere.
  if (rawLink && !linkUrl) back("error=link");

  // The artwork, uploaded here rather than emailed in (session 019 follow-up:
  // "Make a self service for the images"). Optional on purpose — a business
  // that has not had a picture made yet should still be able to hold its place
  // in the queue, and losing that request is worse than a missing image.
  //
  // The browser has already shrunk it (components/ImageUpload), so this is
  // normally a few hundred KB. The size ceiling still stands as the backstop
  // for anything that skipped the browser, and it is BELOW the platform's own
  // request-body cap so the failure is ours to explain rather than a blank
  // error page (the session-016 addendum-4 outage).
  let imageSrc: string | null = null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    if (image.size > MAX_FEATURED_IMAGE_BYTES) back("error=image_big");
    const bytes = Buffer.from(await image.arrayBuffer());
    // Sniff the real bytes: a filename can say .jpg about anything.
    const ext = sniffImage(bytes);
    if (!ext) back("error=image_kind");
    if (supabaseConfigured) {
      const stored = await storeImageBytes(bytes);
      if (!stored.ok) back("error=image_store");
      imageSrc = (stored as { ok: true; url: string }).url;
    } else {
      imageSrc = `data:${CONTENT_TYPE_BY_EXT[ext!]};base64,${bytes.toString("base64")}`;
    }
  }

  const outcome = await addFeaturedRequest({
    kind,
    businessName,
    contactName: contactName || null,
    phone,
    email,
    linkUrl,
    adId,
    note,
    imageSrc,
  });
  if (outcome === "unsupported") back("error=unsupported");

  // Tell the operator straight away — a featured request is a sale waiting to
  // be closed, and the queue page is not somewhere anyone watches all day.
  const waiting = (await listPendingRequests()).length;
  await notifyOperator(
    `${site.name}: featured listing request`,
    `${businessName} asked for a ${kind === "featured_ad" ? "featured ad" : "premium business listing"}.\n` +
      `Contact: ${phone ?? "—"} ${email ?? ""}\n` +
      `Link: ${linkUrl ?? (adId ? `ad #${adId}` : "—")}\n` +
      `Artwork: ${imageSrc ? "uploaded" : "NOT sent — ask them for it"}\n` +
      `Note: ${note ?? "—"}\n\n` +
      `${waiting} request${waiting === 1 ? "" : "s"} now waiting: ${site.webHost}/admin/featured`,
  );

  back("submitted=1");
}
