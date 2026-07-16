/**
 * Attachment security: an inbound MMS file is accepted ONLY when its leading
 * bytes prove it is one of these image formats. Content-type headers, file
 * names, and extensions are sender-controlled and are never consulted.
 *
 * Deliberately absent:
 * - SVG — scriptable (XSS vector); never accept it from the public.
 * - HEIC/HEIF — carriers transcode iPhone MMS to JPEG in transit, so raw HEIC
 *   essentially never arrives; if it did, most browsers can't render it, so
 *   accepting it would put broken images on the site.
 * - BMP/TIFF — rare over MMS, huge, and poorly supported in browsers.
 */
export const ACCEPTED_IMAGE_FORMATS = ["jpg", "png", "gif", "webp"] as const;
export type ImageExt = (typeof ACCEPTED_IMAGE_FORMATS)[number];

export const CONTENT_TYPE_BY_EXT: Record<ImageExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The image format the bytes actually are, or null for anything else. */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (bytes.length >= 8 && PNG_MAGIC.every((v, i) => bytes[i] === v)) return "png";
  if (bytes.length >= 6) {
    const head = ascii(bytes, 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}
