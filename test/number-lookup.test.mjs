// Line-type policy. Every assertion here is really one question: can an
// infrastructure problem cost a real member their money or their access?
// The answer has to be no on every path, so the fail-open behaviour is pinned
// harder than the blocking behaviour.
import {
  isBurnerLine,
  isCacheable,
  lineMay,
  lineTypeLabel,
  parseLineType,
  toE164,
} from "../lib/number-lookup.ts";

export const name = "number-lookup";

/** The recommended stance: no free money, no seller directory, trading fine. */
const RECOMMENDED = {
  lookupEnabled: true,
  voipStarterCredit: false,
  voipReveals: false,
  voipPosting: true,
};
const OFF = {
  lookupEnabled: false,
  voipStarterCredit: false,
  voipReveals: false,
  voipPosting: false,
};

export function run(t) {
  // ---- which lines are "throwaway" ----
  t.eq("app numbers are burners", isBurnerLine("nonFixedVoip"), true);
  t.eq("voicemail services are burners", isBurnerLine("voicemail"), true);
  t.eq("pagers are burners", isBurnerLine("pager"), true);
  t.eq("mobiles are not", isBurnerLine("mobile"), false);
  t.eq("landlines are not", isBurnerLine("landline"), false);
  // The distinction that keeps real local businesses — the sponsors this
  // service wants — from being treated as disposable.
  t.eq("BUSINESS VoIP is not a burner", isBurnerLine("fixedVoip"), false);
  t.eq("toll-free is not a burner", isBurnerLine("tollFree"), false);
  t.eq("unknown is not a burner", isBurnerLine("unknown"), false);
  t.eq("unchecked is not a burner", isBurnerLine("unchecked"), false);

  // ---- fail-open, three ways ----
  // 1. Policy off: nothing is denied, whatever the line is.
  for (const p of ["starterCredit", "reveals", "posting"]) {
    t.eq(`policy off allows ${p}`, lineMay("nonFixedVoip", p, OFF), true);
  }
  // 2. Never established: a Twilio outage, a bad credential or a pending
  //    migration all arrive here, and none of them may cost a member anything.
  for (const p of ["starterCredit", "reveals", "posting"]) {
    t.eq(`unchecked allows ${p}`, lineMay("unchecked", p, RECOMMENDED), true);
  }
  // 3. Twilio answered but had no type for the number.
  t.eq("unknown allows the credit", lineMay("unknown", "starterCredit", RECOMMENDED), true);

  // ---- the recommended stance actually bites, but only where intended ----
  t.eq("burner is denied the free credit", lineMay("nonFixedVoip", "starterCredit", RECOMMENDED), false);
  t.eq("burner is denied number look-ups", lineMay("nonFixedVoip", "reveals", RECOMMENDED), false);
  t.eq("burner may still post and pay", lineMay("nonFixedVoip", "posting", RECOMMENDED), true);
  // A real member is untouched by every switch.
  for (const p of ["starterCredit", "reveals", "posting"]) {
    t.eq(`mobile keeps ${p}`, lineMay("mobile", p, RECOMMENDED), true);
    t.eq(`business VoIP keeps ${p}`, lineMay("fixedVoip", p, RECOMMENDED), true);
  }
  // The strict stance is expressible too.
  const strict = { ...RECOMMENDED, voipPosting: false };
  t.eq("strict stance blocks burner posting", lineMay("nonFixedVoip", "posting", strict), false);
  t.eq("…and still not a real mobile", lineMay("mobile", "posting", strict), true);
  // The permissive stance: checking on, nothing withheld.
  const permissive = { lookupEnabled: true, voipStarterCredit: true, voipReveals: true, voipPosting: true };
  t.eq("permissive allows a burner the credit", lineMay("nonFixedVoip", "starterCredit", permissive), true);

  // ---- caching: a failure must never be remembered ----
  // This is the property that keeps an outage from branding a real member as
  // unverifiable forever.
  t.eq("a failed check is never cached", isCacheable("unchecked"), false);
  t.eq("a real answer is cached", isCacheable("mobile"), true);
  t.eq("a burner answer is cached", isCacheable("nonFixedVoip"), true);
  t.eq("even 'unknown' is cached", isCacheable("unknown"), true);

  // ---- parsing whatever Twilio sends ----
  t.eq("known type passes through", parseLineType("nonFixedVoip"), "nonFixedVoip");
  t.eq("case is tolerated", parseLineType("NONFIXEDVOIP"), "nonFixedVoip");
  t.eq("mobile parses", parseLineType("mobile"), "mobile");
  // Anything we don't recognise must land on a NON-burner value, so a new
  // Twilio type can never start silently denying people.
  t.eq("an unrecognised type is 'unknown'", parseLineType("teleportation"), "unknown");
  t.eq("…which is not a burner", isBurnerLine(parseLineType("teleportation")), false);
  t.eq("missing type is 'unknown'", parseLineType(undefined), "unknown");
  t.eq("null is 'unknown'", parseLineType(null), "unknown");
  t.eq("a number is 'unknown'", parseLineType(42), "unknown");
  t.eq("empty string is 'unknown'", parseLineType(""), "unknown");

  // ---- E.164, the only form the endpoint accepts ----
  t.eq("10 digits gain +1", toE164("3305550142"), "+13305550142");
  t.eq("formatting is ignored", toE164("(330) 555-0142"), "+13305550142");
  t.eq("a leading 1 is kept once", toE164("13305550142"), "+13305550142");
  t.eq("too short is refused", toE164("5550142"), null);
  t.eq("too long is refused", toE164("133055501429"), null);
  t.eq("empty is refused", toE164(""), null);

  // ---- labels are human ----
  t.eq("app numbers read plainly", lineTypeLabel("nonFixedVoip"), "VoIP (app number)");
  t.eq("business VoIP is distinguished", lineTypeLabel("fixedVoip"), "VoIP (business line)");
  t.eq("unchecked reads as not checked", lineTypeLabel("unchecked"), "Not checked");
  t.eq("every type has a non-empty label", ["mobile", "landline", "tollFree", "unknown", "voicemail", "pager"].every((k) => lineTypeLabel(k).length > 0), true);
}
