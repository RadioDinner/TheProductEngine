// Attachment security: only bytes that PROVE an accepted image format pass —
// content-type headers and extensions are sender-controlled and ignored.
import { sniffImage } from "../lib/image-sniff.ts";

export const name = "image-sniff";

function bytes(...parts) {
  return Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
}

export function run(t) {
  // Accepted formats, by magic bytes.
  t.eq("jpeg", sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF-rest")), "jpg");
  t.eq(
    "png",
    sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest")),
    "png",
  );
  t.eq("gif87a", sniffImage(bytes("GIF87a", [0x00, 0x01])), "gif");
  t.eq("gif89a", sniffImage(bytes("GIF89a", [0x00, 0x01])), "gif");
  t.eq("webp", sniffImage(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")), "webp");

  // Rejected: everything that isn't provably one of the above.
  t.eq("pdf rejected", sniffImage(bytes("%PDF-1.7 ...")), null);
  t.eq("svg rejected (scriptable)", sniffImage(bytes('<svg xmlns="...">')), null);
  t.eq("html rejected", sniffImage(bytes("<!doctype html><script>")), null);
  t.eq("heic rejected (ftyp box)", sniffImage(bytes([0, 0, 0, 24], "ftypheic")), null);
  t.eq("zip rejected", sniffImage(bytes("PK", [3, 4], "payload")), null);
  t.eq("empty rejected", sniffImage(bytes()), null);
  t.eq("truncated png header rejected", sniffImage(bytes([0x89, 0x50, 0x4e])), null);
  t.eq("riff-but-not-webp rejected (wav)", sniffImage(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt ")), null);
  t.eq("garbage rejected", sniffImage(bytes([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 9, 10, 11, 12, 13])), null);
}
