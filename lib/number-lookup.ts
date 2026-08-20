/**
 * Line-type lookup (Twilio Lookup v2) and the policy built on top of it.
 *
 * WHY (session 016, user ask): signing up proves only that a number can
 * receive one SMS. A Google Voice or TextNow number passes exactly as well as
 * a real mobile line, so a scripted attacker with disposable numbers could
 * claim a large share of the 200 launch starter-credit slots — $40 each — and
 * could mint burner accounts to harvest sellers' phone numbers.
 *
 * THE DESIGN DECISION, and it matters: this does NOT block VoIP numbers from
 * signing up. Blocking costs real customers — plenty of ordinary people
 * legitimately use a VoIP line, and a Plain community in particular runs on
 * shared phones, answering services and whatever number the family actually
 * has. Losing one real seller costs more than a burner gains.
 *
 * Instead it withholds the two things that are worth abusing:
 *   - the FREE starter credit (removes the entire economic motive), and
 *   - number look-ups (removes the scraping motive).
 * A VoIP member can still sign up, post, and pay like anybody else. The
 * attacker's return drops to zero; the real customer notices nothing.
 *
 * Everything is OFF until the operator turns it on, so an unconfigured deploy
 * behaves exactly as it did before this file existed.
 */

/**
 * Twilio's line_type_intelligence values, plus our own two.
 *
 * The distinction that carries the policy is fixedVoip vs nonFixedVoip:
 * nonFixedVoip is the burner class (Google Voice, TextNow — numbers not tied
 * to a service address, obtainable in seconds and by the dozen), while
 * fixedVoip is what a real small business runs its office line on. Lumping
 * them together would punish exactly the local businesses this service wants
 * as sponsors.
 */
export type LineType =
  | "mobile"
  | "landline"
  | "fixedVoip"
  | "nonFixedVoip"
  | "tollFree"
  | "personal"
  | "premium"
  | "sharedCost"
  | "uan"
  | "voicemail"
  | "pager"
  /** Twilio answered, but had no line type for this number. */
  | "unknown"
  /** We never asked, or the ask failed. NEVER cached — see below. */
  | "unchecked";

/** Line types the policy treats as disposable. */
const BURNER_TYPES = new Set<LineType>(["nonFixedVoip", "voicemail", "pager"]);

/** True if this line type is the throwaway kind the policy is aimed at. */
export function isBurnerLine(type: LineType): boolean {
  return BURNER_TYPES.has(type);
}

/**
 * Should this result be remembered on the account?
 *
 * "unchecked" never is. That is the whole safety property of the cache: a
 * Twilio outage, an expired credential or a network blip must not brand a real
 * member as unverifiable forever. An unstored result is simply retried the
 * next time it matters.
 */
export function isCacheable(type: LineType): boolean {
  return type !== "unchecked";
}

export interface VoipPolicy {
  /** Master switch. Off = nothing below applies and no lookups are made. */
  lookupEnabled: boolean;
  /** Burner lines may receive the free starter credit. */
  voipStarterCredit: boolean;
  /** Burner lines may use website number look-ups. */
  voipReveals: boolean;
  /** Burner lines may post ads at all (the strict stance; default on). */
  voipPosting: boolean;
}

export type Privilege = "starterCredit" | "reveals" | "posting";

/**
 * May this line do this thing?
 *
 * Fail-open by construction, in three separate ways, because every one of
 * these would otherwise turn an infrastructure problem into a lockout of
 * paying customers:
 *   - policy off  → yes (the feature is not in use)
 *   - unchecked   → yes (we could not ask; assume good faith and retry later)
 *   - not a burner → yes
 * Only a POSITIVE identification of a throwaway line, while the switch for
 * that privilege is off, returns false.
 */
export function lineMay(
  type: LineType,
  privilege: Privilege,
  policy: VoipPolicy,
): boolean {
  if (!policy.lookupEnabled) return true;
  if (type === "unchecked") return true;
  if (!isBurnerLine(type)) return true;
  if (privilege === "starterCredit") return policy.voipStarterCredit;
  if (privilege === "reveals") return policy.voipReveals;
  return policy.voipPosting;
}

/** Human label for the admin user page. */
export function lineTypeLabel(type: LineType): string {
  switch (type) {
    case "mobile":
      return "Mobile";
    case "landline":
      return "Landline";
    case "fixedVoip":
      return "VoIP (business line)";
    case "nonFixedVoip":
      return "VoIP (app number)";
    case "tollFree":
      return "Toll-free";
    case "voicemail":
      return "Voicemail service";
    case "pager":
      return "Pager";
    case "unknown":
      return "Unknown";
    case "unchecked":
      return "Not checked";
    default:
      return type;
  }
}

/** Map whatever Twilio returns onto our union, without trusting it blindly. */
export function parseLineType(raw: unknown): LineType {
  if (typeof raw !== "string" || !raw) return "unknown";
  const known: LineType[] = [
    "mobile",
    "landline",
    "fixedVoip",
    "nonFixedVoip",
    "tollFree",
    "personal",
    "premium",
    "sharedCost",
    "uan",
    "voicemail",
    "pager",
  ];
  const match = known.find((k) => k.toLowerCase() === raw.toLowerCase());
  return match ?? "unknown";
}

/** Configured only when BOTH halves of the Basic-auth pair are present. */
export const lookupConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
);

/** 10 digits → E.164, which is the only form the Lookup endpoint accepts. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * A lookup's outcome, WITH the reason when it didn't produce a type.
 *
 * The policy deliberately fails open, which creates one nasty blind spot: a
 * wrong Account SID looks exactly like "nobody has used a burner yet". Both
 * are silence. So the raw reason is carried out of here for the admin test
 * tool to display — an operator has to be able to tell a working check from
 * one that has been quietly 401ing since the day they set it up.
 */
export interface LookupOutcome {
  type: LineType;
  /** Present only when type is "unchecked". */
  reason?:
    | "not-configured"
    | "bad-number"
    | "unauthorized"
    | "forbidden"
    | "not-found"
    | "rate-limited"
    | "twilio-error"
    | "field-error"
    | "network";
  /** HTTP status, when there was one. */
  status?: number;
  /** Carrier name, when Twilio gave one — handy in the test tool. */
  carrier?: string;
}

/** What each failure means and what to do about it, in the operator's words. */
export function lookupReasonNote(outcome: LookupOutcome): string {
  switch (outcome.reason) {
    case "not-configured":
      return "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN isn't set on the server. Add both and redeploy.";
    case "bad-number":
      return "That isn't a 10-digit US number.";
    case "unauthorized":
      return "Twilio rejected the credentials (401). Check TWILIO_ACCOUNT_SID is the Account SID starting \"AC\", and that the auth token belongs to that same account.";
    case "forbidden":
      return "Twilio refused the request (403). Line Type Intelligence may not be enabled on that account, or the account can't use Lookup.";
    case "not-found":
      return "Twilio has no record of that number. Real numbers normally resolve — try another one.";
    case "rate-limited":
      return "Twilio rate-limited the lookup (429). Wait a moment and try again.";
    case "twilio-error":
      return `Twilio returned an error${outcome.status ? ` (${outcome.status})` : ""}. Nothing is wrong on this end — try again shortly.`;
    case "field-error":
      return "Twilio answered but couldn't determine the line type for that number.";
    case "network":
      return "Couldn't reach Twilio at all (network or timeout).";
    default:
      return "";
  }
}

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
