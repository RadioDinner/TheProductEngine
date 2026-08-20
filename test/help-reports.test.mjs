// "I need help!" diagnostics (feature 39). Every field here arrives from the
// browser and is then displayed on an operator page, so the sanitizer is the
// boundary between "a stuck member" and "a stranger writing into my admin".
import {
  NOTE_MAX,
  reportSummary,
  sanitizeDiagnostics,
} from "../lib/help-reports.ts";

export const name = "help-reports";

export function run(t) {
  // ---- path: displayed AND linked on the admin page ----
  t.eq("a normal path passes", sanitizeDiagnostics({ path: "/account/post" }).path, "/account/post");
  // A full URL would render an operator-facing link pointing off-site on a
  // stranger's say-so — refused, not "cleaned".
  t.eq("an absolute URL is refused", sanitizeDiagnostics({ path: "https://evil.test/x" }).path, "/");
  t.eq("a protocol-relative URL is refused", sanitizeDiagnostics({ path: "//evil.test" }).path, "/");
  t.eq("a bare word is refused", sanitizeDiagnostics({ path: "account" }).path, "/");
  t.eq("javascript: is refused", sanitizeDiagnostics({ path: "javascript:alert(1)" }).path, "/");
  t.eq("a missing path defaults to /", sanitizeDiagnostics({}).path, "/");
  t.eq("a non-string path defaults to /", sanitizeDiagnostics({ path: 42 }).path, "/");

  // ---- everything is bounded: these strings are somebody else's storage ----
  const huge = "x".repeat(5000);
  t.eq("note is capped", sanitizeDiagnostics({ note: huge }).note.length, NOTE_MAX);
  t.eq("user agent is capped", sanitizeDiagnostics({ userAgent: huge }).userAgent.length, 400);
  t.eq("referrer is capped", sanitizeDiagnostics({ referrer: huge }).referrer.length, 400);
  t.eq("last error is capped", sanitizeDiagnostics({ lastError: huge }).lastError.length, 400);
  t.eq("viewport is capped", sanitizeDiagnostics({ viewport: huge }).viewport.length, 40);
  t.eq("timezone is capped", sanitizeDiagnostics({ timezone: huge }).timezone.length, 60);
  t.eq("path is capped", sanitizeDiagnostics({ path: "/" + huge }).path.length, 300);

  // ---- empty means absent, not "" ----
  // The admin page tests these for truthiness to decide whether to render a
  // line at all; an empty string would print a stray label with nothing after.
  t.eq("empty note is undefined", sanitizeDiagnostics({ note: "" }).note, undefined);
  t.eq("whitespace note is undefined", sanitizeDiagnostics({ note: "   \n  " }).note, undefined);
  t.eq("empty referrer is undefined", sanitizeDiagnostics({ referrer: "" }).referrer, undefined);
  t.eq("non-string is undefined", sanitizeDiagnostics({ userAgent: null }).userAgent, undefined);

  // ---- whitespace is collapsed, so one report is one line ----
  t.eq(
    "newlines collapse",
    sanitizeDiagnostics({ note: "it\n\nbroke   here" }).note,
    "it broke here",
  );
  t.eq("outer space trimmed", sanitizeDiagnostics({ note: "  hi  " }).note, "hi");

  // A realistic capture survives intact.
  const real = sanitizeDiagnostics({
    path: "/account/ads",
    referrer: "https://theplainexchange.com/account",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    viewport: "390x844 @3x",
    timezone: "America/New_York",
    note: "the picture won't upload",
  });
  t.eq("real path kept", real.path, "/account/ads");
  t.eq("real viewport kept", real.viewport, "390x844 @3x");
  t.eq("real note kept", real.note, "the picture won't upload");

  // ---- the email subject line ----
  // It is the whole notification on a phone, so it has to carry page + who.
  const s = reportSummary({ path: "/account/post", phone: "3305550142", note: "stuck" });
  t.eq("subject names the page", s.includes("/account/post"), true);
  t.eq("subject names the person", s.includes("3305550142"), true);
  t.eq("subject quotes the note", s.includes("stuck"), true);
  const anon = reportSummary({ path: "/login", phone: null });
  t.eq("signed-out is said plainly", anon.includes("signed-out visitor"), true);
  t.eq("no note leaves no dangling quote", anon.includes('"'), false);
  // A long note must not run away with the subject line.
  const long = reportSummary({ path: "/", phone: null, note: "y".repeat(300) });
  t.eq("long notes are truncated", long.length < 140, true);
  t.eq("…with an ellipsis", long.includes("…"), true);
}
