// Emailed-in extra pictures (FEATURES item 1) — the ad-number parser and
// attachment normalization. A phone-number fragment in the body must never
// be mistaken for an ad number.
import { normalizeAttachments, parseAdNumber } from "../lib/email-photos.ts";

export const name = "email-photos";

export function run(t) {
  // Subject forms.
  t.eq("subject 'Ad 1042'", parseAdNumber("Ad 1042", ""), 1042);
  t.eq("subject '#1042'", parseAdNumber("#1042", ""), 1042);
  t.eq("subject 'ad#1042'", parseAdNumber("more pictures ad#1042", ""), 1042);
  t.eq("subject bare number ok", parseAdNumber("1042", ""), 1042);
  t.eq("subject 'pictures for ad 1042'", parseAdNumber("pictures for ad 1042", ""), 1042);

  // Body: explicit only.
  t.eq("body 'ad 1042'", parseAdNumber("", "here are pictures for ad 1042 thanks"), 1042);
  t.eq("body '#1042'", parseAdNumber("", "for #1042"), 1042);
  t.eq(
    "body phone fragment is NOT an ad number",
    parseAdNumber("pictures", "call me at 330-555-0142"),
    null,
  );
  t.eq("nothing anywhere", parseAdNumber("hello", "just photos"), null);
  t.eq("subject wins over body", parseAdNumber("Ad 1042", "also ad 1050"), 1042);

  // Attachment shape tolerance.
  t.eq("not an array", normalizeAttachments("nope"), []);
  t.eq(
    "content + content_type",
    normalizeAttachments([{ filename: "a.jpg", content_type: "image/jpeg", content: "QUJD" }]),
    [{ filename: "a.jpg", contentType: "image/jpeg", content: "QUJD", url: undefined }],
  );
  t.eq(
    "url-only attachment kept",
    normalizeAttachments([{ name: "b.png", download_url: "https://x.test/b.png" }]),
    [{ filename: "b.png", contentType: undefined, content: undefined, url: "https://x.test/b.png" }],
  );
  t.eq("empty entries dropped", normalizeAttachments([{ filename: "c.gif" }, null, 5]), []);
}
