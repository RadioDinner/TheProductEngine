// Upload ceilings. These exist because of a real prod failure: the app
// accepted 8 MB pictures while the host rejects any request body over ~4.5 MB
// BEFORE our code runs — so a normal phone photo produced a blank "This page
// couldn't load" and nothing in our logs. The invariants below are what stop
// that from coming back, so they are pinned hard.
import {
  CLIENT_MAX_EDGE,
  CLIENT_JPEG_QUALITY,
  CLIENT_SHRINK_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  PLATFORM_BODY_LIMIT_BYTES,
  shrinkTo,
  uploadFits,
  uploadLimitLabel,
} from "../lib/upload-limits.ts";

export const name = "upload-limits";

export function run(t) {
  const MB = 1024 * 1024;

  // ---- the invariant the outage was about ----
  t.eq("per-file cap is under the platform body cap", MAX_UPLOAD_BYTES < PLATFORM_BODY_LIMIT_BYTES, true);
  t.eq("whole-post cap is under the platform body cap", MAX_UPLOAD_TOTAL_BYTES < PLATFORM_BODY_LIMIT_BYTES, true);
  t.eq("per-file cap does not exceed the whole-post cap", MAX_UPLOAD_BYTES <= MAX_UPLOAD_TOTAL_BYTES, true);
  // Room left for multipart boundaries and the other form fields — a request
  // exactly at the cap must still fit.
  t.eq("at least 256 KB of headroom under the platform cap", PLATFORM_BODY_LIMIT_BYTES - MAX_UPLOAD_TOTAL_BYTES >= 256 * 1024, true);

  // ---- uploadFits ----
  t.eq("nothing selected fits", uploadFits([]).ok, true);
  t.eq("one small file fits", uploadFits([100 * 1024]).ok, true);
  t.eq("one file exactly at the cap fits", uploadFits([MAX_UPLOAD_BYTES]).ok, true);
  const tooBig = uploadFits([MAX_UPLOAD_BYTES + 1]);
  t.eq("one oversized file does not fit", tooBig.ok, false);
  t.eq("…and it is reported as a per-file problem", tooBig.reason, "file");
  // The case a per-file check alone would miss: eight legal files, one illegal
  // request. This is the multi-picture "extras" input.
  const manySmall = Array(8).fill(Math.floor(MAX_UPLOAD_TOTAL_BYTES / 4));
  const overTotal = uploadFits(manySmall);
  t.eq("eight individually-legal files can still bust the request", overTotal.ok, false);
  t.eq("…and it is reported as a total problem", overTotal.reason, "total");
  // Exactly at the total, with every file inside the per-file cap.
  const half = MAX_UPLOAD_TOTAL_BYTES / 2;
  t.eq("files summing exactly to the total fit", uploadFits([half, half]).ok, true);
  // A single file big enough to fill the whole request is still a per-file
  // failure — that is the more specific, more useful message.
  t.eq("one file at the whole-post size is a per-file problem", uploadFits([MAX_UPLOAD_TOTAL_BYTES]).reason, "file");
  // Explicit limits override the defaults (so a caller with its own ceiling
  // can reuse the same arithmetic).
  t.eq("custom per-file limit honored", uploadFits([500], { perFile: 400 }).reason, "file");
  t.eq("custom total limit honored", uploadFits([300, 300], { total: 500 }).reason, "total");

  // ---- shrinkTo ----
  const land = shrinkTo(4032, 3024, 1600);
  t.eq("landscape phone photo caps its long edge", land.width, 1600);
  t.eq("…keeping the aspect ratio", land.height, 1200);
  const port = shrinkTo(3024, 4032, 1600);
  t.eq("portrait caps its long edge too", port.height, 1600);
  t.eq("…keeping the aspect ratio", port.width, 1200);
  const square = shrinkTo(2000, 2000, 1600);
  t.eq("square stays square", `${square.width}x${square.height}`, "1600x1600");
  // Never scale UP: a small picture is left alone rather than blown up into a
  // bigger file than it started as.
  const small = shrinkTo(640, 480, 1600);
  t.eq("small picture keeps its width", small.width, 640);
  t.eq("small picture keeps its height", small.height, 480);
  const exact = shrinkTo(1600, 900, 1600);
  t.eq("a picture already at the cap is untouched", `${exact.width}x${exact.height}`, "1600x900");
  // Degenerate inputs must not produce a 0-pixel canvas (which throws in the
  // browser) or a NaN.
  const zero = shrinkTo(0, 0, 1600);
  t.eq("zero dimensions clamp to 1px", `${zero.width}x${zero.height}`, "1x1");
  const sliver = shrinkTo(5000, 1, 1600);
  t.eq("an extreme ratio still caps the long edge", sliver.width, 1600);
  t.eq("…and never rounds the short edge to zero", sliver.height >= 1, true);

  // ---- client encode settings are sane ----
  t.eq("max edge is well above what MMS or the site shows", CLIENT_MAX_EDGE >= 1200, true);
  t.eq("jpeg quality is a sane fraction", CLIENT_JPEG_QUALITY > 0.5 && CLIENT_JPEG_QUALITY <= 1, true);
  // Files under the threshold are sent untouched, so the threshold must be
  // below the cap — otherwise a file could skip shrinking AND fail the check.
  t.eq("shrink threshold is below the per-file cap", CLIENT_SHRINK_THRESHOLD_BYTES < MAX_UPLOAD_BYTES, true);

  // ---- copy helper ----
  t.eq("whole megabytes read as whole numbers", uploadLimitLabel(3 * MB), "3 MB");
  t.eq("fractions get one decimal", uploadLimitLabel(4.5 * MB), "4.5 MB");
  t.eq("defaults to the per-file cap", uploadLimitLabel(), uploadLimitLabel(MAX_UPLOAD_BYTES));
}
