// Editable auto-reply copy (session 023): "I want an admin tab where I can go
// in and edit the messages and add or remove variables from auto replies,
// rather than having a code/prompt session."
//
// Everything here is about the two ways an edit could quietly break the
// service: a variable that renders as nothing, and a phrase the CODE depends
// on being deleted by somebody who had no way to know.
import {
  SMS_MAX_CHARS,
  TEMPLATES,
  exampleValues,
  renderTemplate,
  templateGroups,
  templateSpec,
  templateTokens,
  validateTemplateBody,
} from "../lib/message-templates.ts";
import { segmentation } from "../lib/sms-segments.ts";

export const name = "message-templates";

export function run(t) {
  /* ---------------- rendering ---------------- */

  t.eq("a plain substitution", renderTemplate("Ad #{adId} is in.", { adId: 1042 }), "Ad #1042 is in.");
  t.eq("the same variable twice", renderTemplate("{a} and {a}", { a: "x" }), "x and x");
  t.eq("numbers become text", renderTemplate("{n}", { n: 0 }), "0");

  // The whole point of the tidy-up: optional clauses render empty and the
  // sentence has to close up around them. A body written for three clauses
  // must read correctly when none of them apply.
  t.eq(
    "an absent clause leaves no gap",
    renderTemplate("Got it! Ad #{adId}. {money}{photo}{window}", {
      adId: 7,
      money: "",
      photo: "",
      window: "",
    }),
    "Got it! Ad #7.",
  );
  t.eq(
    "one clause of three",
    renderTemplate("Got it! Ad #{adId}. {money}{photo}{window}", {
      adId: 7,
      money: "It costs $20.",
      photo: "",
      window: "",
    }),
    "Got it! Ad #7. It costs $20.",
  );
  t.eq("no space before punctuation", renderTemplate("Done {x}.", { x: "" }), "Done.");
  t.eq("no space after an open bracket", renderTemplate("({x}ok)", { x: "" }), "(ok)");
  t.eq("undefined renders empty", renderTemplate("a{missing}b", {}), "ab");
  t.eq("null renders empty", renderTemplate("a{x}b", { x: null }), "ab");

  // Newlines are the layout of the welcome texts on a flip-phone screen, so
  // they survive; runs of spaces do not.
  t.eq(
    "blank lines survive",
    renderTemplate("one\n\ntwo", {}),
    "one\n\ntwo",
  );
  t.eq(
    "a variable carrying its own blank line",
    renderTemplate("prices{starter}", { starter: "\n\nYou have $40 of free ad credit!" }),
    "prices\n\nYou have $40 of free ad credit!",
  );
  t.eq("runs of spaces collapse", renderTemplate("a  b", {}), "a b");
  t.eq("it is trimmed", renderTemplate("  {x} hi  ", { x: "" }), "hi");

  /* ---------------- finding the variables ---------------- */

  t.eq("tokens in order", templateTokens("{b} then {a} then {b}"), ["b", "a"]);
  t.eq("nothing to find", templateTokens("plain words"), []);
  t.eq("money is not a token", templateTokens("costs $20"), []);
  t.eq("a token can't start with a digit", templateTokens("{1adId}"), []);

  /* ---------------- what the editor refuses ---------------- */

  const spec = {
    key: "test",
    group: "g",
    label: "l",
    channel: "sms",
    when: "w",
    body: "Ad #{adId}",
    vars: [{ name: "adId", describes: "the ad number", example: "1042" }],
  };

  t.eq("a good edit saves", validateTemplateBody(spec, "Your ad #{adId} is in.").length, 0);
  // "Remove a variable" is the feature, so dropping one is always allowed.
  t.eq("dropping a variable is fine", validateTemplateBody(spec, "Your ad is in.").length, 0);
  t.eq("blank is refused", validateTemplateBody(spec, "   ")[0].kind, "empty");
  // A misspelt token would render as nothing and nobody would ever find out.
  t.eq("an invented variable is refused", validateTemplateBody(spec, "{ballance}")[0].kind, "unknown-var");
  t.eq(
    "and it is named, so it can be fixed",
    validateTemplateBody(spec, "{ballance}")[0].message.includes("{ballance}"),
    true,
  );
  t.eq(
    "too long is refused",
    validateTemplateBody({ ...spec, maxChars: 10 }, "way over the limit here")[0].kind,
    "too-long",
  );

  // A required phrase is not style — several replies are stopped from
  // repeating themselves by finding a phrase of their own text in the sent
  // log, and carriers require the opt-out word.
  const guarded = {
    ...spec,
    body: "You're unsubscribed and won't get more. Reply START.",
    requires: [{ text: "unsubscribed and won't get more", why: "the repeat guard finds it." }],
  };
  t.eq("keeping the phrase saves", validateTemplateBody(guarded, guarded.body).length, 0);
  t.eq(
    "losing it is refused",
    validateTemplateBody(guarded, "You're off the list.")[0].kind,
    "missing-phrase",
  );
  t.eq(
    "and the reason is given",
    validateTemplateBody(guarded, "You're off the list.")[0].message.includes("repeat guard"),
    true,
  );

  /* ---------------- the catalogue itself ---------------- */

  t.eq("every key is unique", new Set(TEMPLATES.map((x) => x.key)).size, TEMPLATES.length);
  t.eq("templateSpec finds one", templateSpec("ad.approved")?.key, "ad.approved");
  t.eq("and returns nothing for a stranger", templateSpec("nope"), undefined);
  t.eq(
    "every template is in a group",
    TEMPLATES.every((x) => x.group.trim().length > 0),
    true,
  );
  t.eq(
    "groups cover every template",
    templateGroups().reduce((n, g) => n + g.templates.length, 0),
    TEMPLATES.length,
  );

  // Every default must be renderable with its own declared variables and
  // nothing else — otherwise the catalogue ships copy the editor would refuse.
  const badDefaults = TEMPLATES.filter((x) => validateTemplateBody(x, x.body).length > 0);
  t.eq(`every shipped default validates (bad: ${badDefaults.map((x) => x.key).join(", ") || "none"})`, badDefaults.length, 0);

  // Every declared variable must actually be used by its own default. A
  // variable nothing uses is a button on the admin page that does nothing
  // useful, and a hint that the send site forgot to pass it.
  const unused = [];
  for (const x of TEMPLATES) {
    const tokens = templateTokens(x.body);
    for (const v of x.vars) if (!tokens.includes(v.name)) unused.push(`${x.key}.${v.name}`);
  }
  // Some are deliberately offered but not used by default — the operator can
  // add them. Keep that list explicit so it never grows by accident.
  const ALLOWED_UNUSED = new Set([
    "ad.received.text.price",
    "ad.received.text.balance",
    "ad.received.picture.price",
    "ad.received.picture.balance",
    "ad.money.covered.balance",
    // "$130 of credit left after it runs" — offered, but the shipped wording
    // keeps the text to one segment.
    "ad.money.covered.left",
    "ad.money.card.balance",
    // The raw balance, offered beside {spare}. The shipped wording uses
    // {spare} because the two must be on the same scale as {short}; an
    // operator who prefers the plain balance can swap them.
    "ad.money.owing.balance",
    "ad.approved.awaiting-payment.balance",
    // "we'll put $30 on your card" — offered for an operator who wants the
    // figure spelled out; the default names the price instead.
    "ad.money.card.short",
    "ad.held.price",
    "ad.held.balance",
    "ad.ran.price",
    "ad.ran.left",
    "ad.ran.title",
    "ad.charge-failed.balance",
    "sold.confirmed.title",
    "sold.confirmed.plain.title",
    "unknown.redirect.supportPhone",
  ]);
  const surprises = unused.filter((u) => !ALLOWED_UNUSED.has(u));
  t.eq(`no unexplained spare variables (${surprises.join(", ") || "none"})`, surprises.length, 0);

  // Every SMS default has to be sendable and affordable. Six segments is the
  // ceiling the editor enforces; a default at the ceiling would mean the
  // service ships a message that costs six texts to everyone who gets it.
  const dear = [];
  for (const x of TEMPLATES) {
    if (x.channel !== "sms") continue;
    const rendered = renderTemplate(x.body, exampleValues(x));
    if (rendered.length > (x.maxChars ?? SMS_MAX_CHARS)) dear.push(`${x.key} (too long)`);
    if (segmentation(rendered).segments > 4) dear.push(`${x.key} (${segmentation(rendered).segments} texts)`);
  }
  t.eq(`no shipped default is expensive (${dear.join(", ") || "none"})`, dear.length, 0);

  // The promise the whole session exists to make true, pinned to the exact
  // message the seller reads.
  t.eq(
    "the card-on-file sentence says the card waits for the run",
    /card won't be charged until your ad runs/.test(templateSpec("ad.money.card").body),
    true,
  );
  // And nothing anywhere may claim a charge that hasn't happened.
  const premature = TEMPLATES.filter((x) => /was charged/.test(x.body) && x.key !== "ad.ran");
  t.eq(`no default claims a past charge (${premature.map((x) => x.key).join(", ") || "none"})`, premature.length, 0);

  // Compliance words survive in the catalogue as shipped.
  t.eq("the opt-out confirmation says START", templateSpec("stop.confirmation").body.includes("START"), true);
  t.eq("the category menu says STOP", templateSpec("welcome.5").body.includes("STOP"), true);
  t.eq("and HELP", templateSpec("welcome.5").body.includes("HELP"), true);

  /* ---------------- example values ---------------- */

  const ex = exampleValues(templateSpec("ad.approved"));
  t.eq("examples cover every variable", Object.keys(ex).sort(), ["adId", "batchWait"]);
  t.eq(
    "and produce a readable preview",
    renderTemplate(templateSpec("ad.approved").body, ex).startsWith("Your ad #1042 is approved."),
    true,
  );
}
