// "Who are you, and how do we reach you back?" — the rules the problem report
// and the feature-suggestion form share (session 018, user decision).
//
// The rule that matters most is the last one: each contact field is optional
// ON ITS OWN, but one of the two must be there. Everything else is bounds and
// forgiveness — a member typing "(330) 555-0123" or "330.555.0123" has not
// made a mistake, and telling them they have is how a form loses a report.
import {
  CONTACT_MAX,
  NAME_MAX,
  contactLine,
  contactPhoneDigits,
  contactProblemMessage,
  looksLikeEmail,
  nameTargetPhone,
  parseContactDetails,
} from "../lib/contact-details.ts";

export const name = "contact-details";

const ok = { firstName: "Sam", lastName: "Yoder", phone: "(330) 555-0123", email: "" };

function problem(raw) {
  const out = parseContactDetails(raw);
  return out.ok ? null : out.problem;
}

export function run(t) {
  // ---- the happy path ----
  const parsed = parseContactDetails(ok);
  t.eq("a name and a phone is enough", parsed.ok, true);
  t.eq("the phone is stored as ten digits", parsed.details.phone, "3305550123");
  t.eq("no email is null, not empty string", parsed.details.email, null);
  t.eq(
    "an email alone is enough",
    parseContactDetails({ ...ok, phone: "", email: "Sam@Example.COM" }).details.email,
    "sam@example.com",
  );
  t.eq(
    "both is fine",
    parseContactDetails({ ...ok, email: "sam@example.com" }).ok,
    true,
  );

  // ---- names ----
  t.eq("first name is required", problem({ ...ok, firstName: "" }), "firstName");
  t.eq("last name is required", problem({ ...ok, lastName: "  " }), "lastName");
  t.eq("punctuation is not a name", problem({ ...ok, firstName: "..." }), "firstName");
  t.eq("a name with a letter passes", parseContactDetails({ ...ok, lastName: "O'Neil" }).ok, true);
  t.eq("accented names pass", parseContactDetails({ ...ok, firstName: "José" }).ok, true);
  t.eq(
    "a novel is not a name",
    problem({ ...ok, firstName: "a".repeat(NAME_MAX + 1) }),
    "firstName",
  );
  t.eq(
    "inner whitespace collapses",
    parseContactDetails({ ...ok, firstName: "  Mary   Ann  " }).details.firstName,
    "Mary Ann",
  );
  t.eq("a missing field is not a crash", problem({}), "firstName");
  t.eq("neither is a non-string", problem({ firstName: 42, lastName: null }), "firstName");

  // ---- phones, forgivingly ----
  t.eq("formatted", contactPhoneDigits("(330) 555-0123"), "3305550123");
  t.eq("dotted", contactPhoneDigits("330.555.0123"), "3305550123");
  t.eq("with the country code", contactPhoneDigits("1 330 555 0123"), "3305550123");
  t.eq("nine digits is a typo", contactPhoneDigits("330555012"), null);
  t.eq("and it is reported as one", problem({ ...ok, phone: "330555012" }), "phone");
  t.eq("letters are not a phone", contactPhoneDigits("call me"), null);

  // ---- emails, loosely ----
  t.eq("ordinary", looksLikeEmail("sam@example.com"), true);
  t.eq("subdomain", looksLikeEmail("sam@mail.example.co.uk"), true);
  t.eq("plus addressing", looksLikeEmail("sam+ads@example.com"), true);
  t.eq("no domain dot", looksLikeEmail("sam@example"), false);
  t.eq("no at sign", looksLikeEmail("sam.example.com"), false);
  t.eq("a space", looksLikeEmail("sam @example.com"), false);
  t.eq("reported as its own problem", problem({ ...ok, phone: "", email: "nope" }), "email");

  // ---- the rule the user actually asked for ----
  t.eq(
    "both blank is the one thing that fails",
    problem({ firstName: "Sam", lastName: "Yoder", phone: "", email: "" }),
    "contact",
  );
  t.eq(
    "and the message says which fields",
    contactProblemMessage("contact"),
    "Please leave a phone number or an email so we can get back to you.",
  );
  t.eq(
    "every problem has a sentence",
    ["firstName", "lastName", "phone", "email", "contact"].every(
      (p) => contactProblemMessage(p).length > 10,
    ),
    true,
  );

  // ---- what the operator reads ----
  t.eq(
    "one line, in the order you'd act on it",
    contactLine({ firstName: "Sam", lastName: "Yoder", phone: "3305550123", email: "sam@example.com" }),
    "Sam Yoder · (330) 555-0123 · sam@example.com",
  );
  t.eq(
    "no empty separators when one is missing",
    contactLine({ firstName: "Sam", lastName: "Yoder", phone: null, email: "sam@example.com" }),
    "Sam Yoder · sam@example.com",
  );

  // ---- which account learns the name (session 018) ----
  // The proved phone always wins over the typed one: a member signed in as
  // A who types B's number must not rename B's account.
  t.eq("the session wins", nameTargetPhone("3305550111", "3305550222"), "3305550111");
  t.eq("signed out, the typed number is used", nameTargetPhone(null, "3305550222"), "3305550222");
  t.eq("neither: nothing is written", nameTargetPhone(null, null), null);
  t.eq("an empty session is not a target", nameTargetPhone("", ""), null);
  t.eq(
    "a signed-in member who leaves the phone blank still teaches their own account",
    nameTargetPhone("3305550111", null),
    "3305550111",
  );

  // ---- bounds ----
  t.eq(
    "an oversized email is cut before it is judged, not stored whole",
    problem({ ...ok, phone: "", email: `${"a".repeat(CONTACT_MAX)}@example.com` }),
    "email",
  );
}
