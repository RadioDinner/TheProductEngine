/**
 * The Twilio Lookup call itself — SERVER ONLY.
 *
 * Split out of lib/number-lookup.ts because the admin test tool is a client
 * component: importing the policy helpers for display would otherwise drag
 * this file's credential assembly (`Buffer.from(sid:token)`) into the browser
 * bundle. It would be inert there — non-public env vars come through as
 * undefined and the guard would refuse — but shipping credential-shaped code
 * to the client is a bad habit that eventually meets a bad refactor.
 *
 * The pure half (types, policy, labels, failure notes, E.164) stays importable
 * from anywhere, including the unit runner.
 */
import { parseLineType, toE164, type LineType, type LookupOutcome } from "@/lib/number-lookup";

/** Configured only when BOTH halves of the Basic-auth pair are present. */
export const lookupConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
);

/**
 * Ask Twilio what kind of line this is, with the failure reason attached.
 * Costs about half a cent per call, so callers cache the answer (isCacheable)
 * rather than asking twice.
 *
 * Every failure mode yields type "unchecked", which every policy check reads
 * as "allow" — no caller has to catch anything to stay open.
 */
export async function lookupLineTypeDetailed(
  phone: string,
  timeoutMs = 4000,
): Promise<LookupOutcome> {
  if (!lookupConfigured) return { type: "unchecked", reason: "not-configured" };
  const e164 = toE164(phone);
  if (!e164) return { type: "unchecked", reason: "bad-number" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(
    e164,
  )}?Fields=line_type_intelligence`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      const reason =
        res.status === 401
          ? "unauthorized"
          : res.status === 403
            ? "forbidden"
            : res.status === 404
              ? "not-found"
              : res.status === 429
                ? "rate-limited"
                : "twilio-error";
      // A credential problem is worth shouting about in the logs: it makes
      // the whole policy silently inert.
      if (reason === "unauthorized" || reason === "forbidden") {
        console.error(
          `[lookup] Twilio ${res.status} — line-type checks are configured but NOT WORKING; the VoIP policy is inert until this is fixed.`,
        );
      } else if (res.status !== 404) {
        console.error(`[lookup] Twilio returned ${res.status} for a line-type check`);
      }
      return { type: "unchecked", reason, status: res.status };
    }
    const body = (await res.json()) as {
      line_type_intelligence?: {
        type?: unknown;
        error_code?: unknown;
        carrier_name?: unknown;
      };
    };
    const intel = body.line_type_intelligence;
    // Twilio reports per-field errors INSIDE a 200 response; a field that
    // errored has no usable type.
    if (!intel || intel.error_code) {
      return { type: "unchecked", reason: "field-error", status: 200 };
    }
    return {
      type: parseLineType(intel.type),
      status: 200,
      ...(typeof intel.carrier_name === "string" && intel.carrier_name
        ? { carrier: intel.carrier_name }
        : {}),
    };
  } catch (e) {
    console.error("[lookup] line-type check failed:", e instanceof Error ? e.message : e);
    return { type: "unchecked", reason: "network" };
  }
}

/** The plain answer, for the hot path that only cares about the type. */
export async function lookupLineType(phone: string, timeoutMs = 4000): Promise<LineType> {
  return (await lookupLineTypeDetailed(phone, timeoutMs)).type;
}
