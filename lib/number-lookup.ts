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
 * Ask Twilio what kind of line this is. Costs about half a cent per call, so
 * callers must cache the answer (see isCacheable) rather than asking twice.
 *
 * Returns "unchecked" for every failure mode — unconfigured, bad number,
 * non-200, timeout, malformed body — so no caller ever has to handle an
 * exception to stay open. A 404 from Twilio means "no such number", which is
 * genuinely unknown rather than a failure, but it is treated the same way:
 * we do not want a lookup quirk denying a real member their credit.
 */
export async function lookupLineType(
  phone: string,
  timeoutMs = 4000,
): Promise<LineType> {
  if (!lookupConfigured) return "unchecked";
  const e164 = toE164(phone);
  if (!e164) return "unchecked";
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
      // 404 = number not found; anything else is our problem, not the
      // member's. Either way: open, and retried next time.
      if (res.status !== 404) {
        console.error(`[lookup] Twilio returned ${res.status} for a line-type check`);
      }
      return "unchecked";
    }
    const body = (await res.json()) as {
      line_type_intelligence?: { type?: unknown; error_code?: unknown };
    };
    const intel = body.line_type_intelligence;
    // Twilio reports per-field errors INSIDE a 200 response; a field that
    // errored has no usable type.
    if (!intel || intel.error_code) return "unchecked";
    return parseLineType(intel.type);
  } catch (e) {
    console.error("[lookup] line-type check failed:", e instanceof Error ? e.message : e);
    return "unchecked";
  }
}
