/**
 * "May this number do X?" — the one question the rest of the app asks.
 *
 * Sits between the policy arithmetic (lib/number-lookup.ts, pure and unit
 * tested) and the store's cached line type. Kept separate from both so
 * number-lookup.ts stays importable by the test runner without dragging in
 * the database.
 *
 * The lookup is LAZY and cached forever after: nothing is asked at signup,
 * because a line type only matters at the moment somebody tries to use a
 * privilege, and asking then means we never pay Twilio for the numbers that
 * sign up and do nothing. Roughly half a cent per member, once.
 */
import { getLineType, setLineType } from "@/lib/store";
import {
  isCacheable,
  lineMay,
  type LineType,
  type Privilege,
  type VoipPolicy,
} from "@/lib/number-lookup";
import { lookupLineType } from "@/lib/number-lookup-server";

/** Pull the four switches out of EngineSettings. */
export function policyFrom(settings: VoipPolicy): VoipPolicy {
  return {
    lookupEnabled: settings.lookupEnabled,
    voipStarterCredit: settings.voipStarterCredit,
    voipReveals: settings.voipReveals,
    voipPosting: settings.voipPosting,
  };
}

/**
 * This number's line type, asking Twilio once if we've never established it.
 *
 * Returns "unchecked" — which every policy check reads as "allow" — whenever
 * the switch is off, the lookup fails, or migration 9967 is still pending.
 * A failed lookup is deliberately NOT cached, so an outage costs one retry
 * rather than permanently mislabelling a real member.
 */
export async function resolveLineType(
  phone: string,
  policy: VoipPolicy,
): Promise<LineType> {
  if (!policy.lookupEnabled) return "unchecked";
  const cached = await getLineType(phone).catch(() => "unchecked" as LineType);
  if (cached !== "unchecked") return cached;
  const fresh = await lookupLineType(phone);
  if (isCacheable(fresh)) {
    // Best-effort: a member must never be denied a privilege because we
    // couldn't write down what we just learned.
    await setLineType(phone, fresh).catch(() => "unsupported");
  }
  return fresh;
}

/**
 * The gate. False ONLY when a number is positively identified as a throwaway
 * line and the operator has that privilege switched off — every other path,
 * including every failure, returns true.
 */
export async function mayUse(
  phone: string,
  privilege: Privilege,
  policy: VoipPolicy,
): Promise<boolean> {
  if (!policy.lookupEnabled) return true;
  const type = await resolveLineType(phone, policy);
  return lineMay(type, privilege, policy);
}
