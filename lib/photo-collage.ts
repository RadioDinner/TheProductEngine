/**
 * Multi-picture combine (FEATURES item 32): when a seller texts more than one
 * picture, the ad still carries exactly ONE photo — the pictures are composed
 * into a single collage image. The one-picture cost model (MMS/PIC/digest all
 * send position 0 only) is untouched; every picture the seller sent still
 * shows, and the individual originals join the website gallery at 1+.
 *
 * Layouts (cells cover-cropped, thin white gutters):
 *   2 → two squares side by side; 3 → one wide on top, two squares below;
 *   4 → a 2×2 grid. Output is baseline JPEG (old handsets choke on
 *   progressive), sized well under carrier MMS limits.
 *
 * sharp does the decode/compose work. `.rotate()` honors EXIF orientation —
 * without it phone photos land sideways in the grid. An animated GIF
 * contributes its first frame.
 */
import sharp from "sharp";

/** The most pictures one ad combines — extras beyond this are ignored. */
export const MAX_COMBINED_PHOTOS = 4;

const CELL = 596; // square cell edge
const GUTTER = 8; // white gap between cells
export const COLLAGE_WIDTH = CELL * 2 + GUTTER; // 1200
const JPEG_QUALITY = 80;

interface Slot {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Exact output size for a given picture count — stored on the ad_photos row
 * so next/image gets the true aspect ratio. */
export function collageDimensions(count: number): { width: number; height: number } {
  const slots = layoutFor(Math.min(Math.max(count, 2), MAX_COMBINED_PHOTOS));
  return { width: COLLAGE_WIDTH, height: Math.max(...slots.map((s) => s.top + s.height)) };
}

function layoutFor(count: number): Slot[] {
  const right = CELL + GUTTER;
  if (count === 2) {
    return [
      { left: 0, top: 0, width: CELL, height: CELL },
      { left: right, top: 0, width: CELL, height: CELL },
    ];
  }
  if (count === 3) {
    return [
      { left: 0, top: 0, width: COLLAGE_WIDTH, height: CELL },
      { left: 0, top: right, width: CELL, height: CELL },
      { left: right, top: right, width: CELL, height: CELL },
    ];
  }
  return [
    { left: 0, top: 0, width: CELL, height: CELL },
    { left: right, top: 0, width: CELL, height: CELL },
    { left: 0, top: right, width: CELL, height: CELL },
    { left: right, top: right, width: CELL, height: CELL },
  ];
}

/**
 * Compose 2–4 images into one collage JPEG. Throws on fewer than 2 images or
 * on undecodable bytes — callers treat any throw as "couldn't combine" and
 * fall back to the first picture alone.
 */
export async function combineImageBuffers(images: Buffer[]): Promise<Buffer> {
  if (images.length < 2) throw new Error("combineImageBuffers needs at least 2 images");
  const use = images.slice(0, MAX_COMBINED_PHOTOS);
  const slots = layoutFor(use.length);
  const cells = await Promise.all(
    use.map((buf, i) =>
      // limitInputPixels: sender bytes could be a decompression bomb — a
      // small JPEG expanding past 64MP throws (caught by callers' fallback)
      // instead of eating the function's memory.
      sharp(buf, { limitInputPixels: 64_000_000 })
        .rotate()
        .resize(slots[i].width, slots[i].height, { fit: "cover" })
        .jpeg({ quality: 90 })
        .toBuffer(),
    ),
  );
  const height = Math.max(...slots.map((s) => s.top + s.height));
  return sharp({
    create: {
      width: COLLAGE_WIDTH,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(cells.map((input, i) => ({ input, left: slots[i].left, top: slots[i].top })))
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
