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

  const outcome = await addFeaturedRequest({
    kind,
    businessName,
    contactName: contactName || null,
    phone,
    email,
    linkUrl,
    adId,
    note,
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
      `Note: ${note ?? "—"}\n\n` +
      `${waiting} request${waiting === 1 ? "" : "s"} now waiting: ${site.webHost}/admin/featured`,
  );

  back("submitted=1");
}
