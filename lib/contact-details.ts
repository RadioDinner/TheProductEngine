/**
 * "Who are you, and how do we reach you back?" — the shared rules for the two
 * forms that need an answer: the problem report and the feature suggestion
 * (user decision, session 018).
 *
 * The problem report deliberately went the other way when it was built
 * (session 016): nothing was required, because a stuck member usually cannot
 * describe what went wrong and the diagnostics describe it for them. That is
 * still true of the NOTE, which stays optional. It was not true of the
 * REPLY — a report the operator can't answer turns into a phone call they
 * have to guess the source of, and the session-018 decision is that a name
 * and one way to reach the person are worth the extra ten seconds.
 *
 * Pure and import-light on purpose: the help panel is a client component, so
 * anything it validates against has to survive being bundled for the browser,
 * and the unit suite tests these rules without a form or a database.
 */

export const NAME_MAX = 40;
export const CONTACT_MAX = 120;

export interface ContactDetails {
  firstName: string;
  lastName: string;
  /** 10 digits, or null when they left it blank. */
  phone: string | null;
  /** Lower-cased, or null when they left it blank. */
  email: string | null;
}

/** Which field to point at. The form shows one message per case; every one of
 * them names the field, because "invalid input" on a five-field form is the
 * least helpful sentence in software. */
export type ContactProblem = "firstName" | "lastName" | "phone" | "email" | "contact";

export type ContactParse =
  | { ok: true; details: ContactDetails }
  | { ok: false; problem: ContactProblem };

/** Strip to the digits and keep the last 10 — "(330) 555-0123", "1 330 555
 * 0123" and "330.555.0123" are the same number, and a member typing any of
 * them should not be told they got it wrong. (Mirrors lib/phone's rule; kept
 * here so this module stays free of imports for the browser bundle.) */
export function contactPhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

/** Deliberately loose: something@something.something with no spaces. A
 * stricter pattern rejects real addresses, and the only cost of a typo here
 * is one bounced reply — while a rejected real address costs the report. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw);
}

/** A name has to contain a letter — "." and "-" are not a person, and a blank
 * that passes validation defeats the point of asking. */
function isName(value: string): boolean {
  return value.length > 0 && value.length <= NAME_MAX && /\p{L}/u.test(value);
}

/**
 * Validate the four fields together. Order matters: the FIRST thing wrong is
 * what the form reports, and "you left both contact fields blank" only makes
 * sense once whatever they did type is known to be usable.
 */
export function parseContactDetails(raw: {
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  email?: unknown;
}): ContactParse {
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const firstName = text(raw.firstName);
  const lastName = text(raw.lastName);
  if (!isName(firstName)) return { ok: false, problem: "firstName" };
  if (!isName(lastName)) return { ok: false, problem: "lastName" };

  const phoneRaw = text(raw.phone).slice(0, CONTACT_MAX);
  const emailRaw = text(raw.email).slice(0, CONTACT_MAX).toLowerCase();
  const phone = phoneRaw ? contactPhoneDigits(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, problem: "phone" };
  if (emailRaw && !looksLikeEmail(emailRaw)) return { ok: false, problem: "email" };
  // Each field is optional on its own; together they are not. This is the
  // user's rule, in their words: "make them optional fields if we have at
  // least one. They'd need to enter 1 of the following, the email or phone."
  if (!phone && !emailRaw) return { ok: false, problem: "contact" };

  return {
    ok: true,
    details: { firstName, lastName, phone, email: emailRaw || null },
  };
}

/** The sentence the form shows for each problem. One place, so the help panel
 * and the suggestion page cannot drift apart. */
export function contactProblemMessage(problem: ContactProblem): string {
  switch (problem) {
    case "firstName":
      return "Please enter your first name.";
    case "lastName":
      return "Please enter your last name.";
    case "phone":
      return "That phone number doesn't look right — 10 digits, like (330) 555-0123.";
    case "email":
      return "That email doesn't look right — check it and try again.";
    case "contact":
      return "Please leave a phone number or an email so we can get back to you.";
  }
}

/**
 * WHICH account, if any, a form submission should teach a name to (user
 * request, session 018).
 *
 * The signed-in session wins outright — that is the only phone here we have
 * actually proved. Failing that, a typed phone number is a reasonable claim
 * and the worst case of believing it is a wrong name on a record, so it is
 * used — but ONLY to fill a name in, never to create an account and never to
 * replace a name already there (the store enforces both).
 *
 * Pure, so the precedence is a test rather than a paragraph.
 */
export function nameTargetPhone(
  sessionPhone: string | null | undefined,
  typedPhone: string | null | undefined,
): string | null {
  return sessionPhone || typedPhone || null;
}

/** "Sam Yoder · (330) 555-0123 · sam@example.com" — one line for the
 * operator's email and the admin list. */
export function contactLine(details: ContactDetails): string {
  const phone = details.phone
    ? `(${details.phone.slice(0, 3)}) ${details.phone.slice(3, 6)}-${details.phone.slice(6)}`
    : null;
  return [`${details.firstName} ${details.lastName}`, phone, details.email]
    .filter(Boolean)
    .join(" · ");
}
