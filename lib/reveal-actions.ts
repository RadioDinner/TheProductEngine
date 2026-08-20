"use server";

/**
 * "Show number" (FEATURES item 23): the only path that turns a masked seller
 * number into a visible one. Signed-in members only; metered by the reveal
 * daily allowance + rolling bank (lib/reveal-quota.ts / migration 9979), with
 * a free repeat for an already-revealed ad. Owners and the admin never spend —
 * the ad page shows them the numbers without this action.
 */
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getAd } from "@/lib/ads";
import { ensureAccount, reserveRevealQuota } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { isAdminPhone } from "@/lib/admin";
import { etParts } from "@/lib/et";
import { requireMemberPhone } from "@/lib/member-gate";
import { mayUse, policyFrom } from "@/lib/line-policy";

export async function revealNumber(formData: FormData): Promise<void> {
  const adId = Number(formData.get("adId"));
  if (!Number.isInteger(adId) || adId <= 0) redirect("/");
  const session = { phone: await requireMemberPhone(`/ad/${adId}`) };
  const ad = await getAd(adId);
  if (!ad) redirect("/");
  // Owners and the operator already see their numbers unmetered — nothing to do.
  if (ad.ownerPhone === session.phone || isAdminPhone(session.phone)) {
    redirect(`/ad/${adId}`);
  }
  // ensureAccount so the quota bank has a row to live on (defensive — a
  // signed-in member normally has one).
  await ensureAccount(session.phone);
  const settings = await getEngineSettings();
  // Line-type policy (session 016): harvesting sellers' numbers is the main
  // reason to mint burner accounts, so a positively-identified throwaway line
  // is refused here — the quota is never touched, and the ad page shows the
  // same "out of look-ups" state rather than naming the reason.
  if (!(await mayUse(session.phone, "reveals", policyFrom(settings)))) {
    redirect(`/ad/${adId}?reveal=out`);
  }
  const today = etParts(new Date()).day;
  const quota = await reserveRevealQuota(
    session.phone,
    adId,
    settings.revealsPerDay,
    settings.revealBankCap,
    today,
  );
  // ?reveal=ok matters only pre-migration in prod (no reveal log yet): the ad
  // page trusts it solely when the log reads "unsupported" — the documented
  // unmetered degrade — so hand-typing it post-migration reveals nothing.
  redirect(quota.allowed ? `/ad/${adId}?reveal=ok` : `/ad/${adId}?reveal=out`);
}
