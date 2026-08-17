/**
 * Multi-picture combine (FEATURES item 32): when a seller texts more than one
 * picture, the ad still carries exactly ONE photo — the pictures are composed
 * into a single collage image. The one-picture cost model (MMS/PIC/digest all
 * send position 0 only) is untouched; every picture the seller sent still
 * shows, and the individual originals join the website gallery at 1+.
 *
 * Style (session-014 rework, refined by user decision):
 * - 2 or 3 pictures → SCRAPBOOK: nothing is ever cropped. Each picture
 *   keeps its full frame and native aspect ratio, scaled to fit a generous
 *   corner-anchored region of the portrait 4:5 white page; regions are
 *   sized so typical photos overlap slightly (later pictures sit on top),
 *   with white showing through — a staggered photo-pile.
 * - 4 pictures → clean 2×2 GRID: each cell filled edge-to-edge (cover-crop
 *   — that's what makes it read as a grid) with thin white gutters.
 *
 * Output is baseline JPEG (old handsets choke on progressive), sized well
 * under carrier MMS limits. sharp does the decode/compose work. `.rotate()`
 * honors EXIF orientation — without it phone photos land sideways. An
 * animated GIF contributes its first frame.
 */
import sharp from "sharp";

/** The most pictures one ad combines — extras beyond this are ignored. */
export const MAX_COMBINED_PHOTOS = 4;

/** The public storage bucket every ad photo lives in (lib/photos.ts uploads
 * there; these path markers encode provenance so no schema change is needed):
 * - `collage/` — a combined multi-picture image (always at ad_photos position
 *   0 when present; safe to delete when replaced by a recompose);
 * - `parts/` — an individual source picture of a collage;
 * - bare path — a single-picture ad's photo, or an emailed-in extra. */
export const AD_PHOTOS_BUCKET = "ad-photos";
const PUBLIC_MARKER = `/object/public/${AD_PHOTOS_BUCKET}/`;

export function isCollageSrc(src: string): boolean {
  return src.includes(`${PUBLIC_MARKER}collage/`);
}

export function isCombinePartSrc(src: string): boolean {
  return src.includes(`${PUBLIC_MARKER}parts/`);
}

/**
 * The website's view of an ad's pictures (user decision, session 014): a
 * combined ad shows its FULL individual pictures — the collage never renders
 * on the site. The collage keeps existing at ad_photos position 0 for the
 * one-picture SMS channels (PIC MMS, the seller's combined-photo text, the
 * email digest embed); this filter is display-only. Order: the `parts/`
 * originals first (they ARE pictures 1..N, in send order), then emailed-in
 * extras. A collage with no surviving originals stays (better the collage
 * than no picture); single-picture ads pass through untouched.
 */
export function websiteAdPhotos<T extends { src: string }>(photos: T[]): T[] {
  if (!photos.length || !isCollageSrc(photos[0].src)) return photos;
  const rest = photos.slice(1);
  const parts = rest.filter((p) => isCombinePartSrc(p.src));
  if (!parts.length) return photos;
  return [...parts, ...rest.filter((p) => !isCombinePartSrc(p.src))];
}

/** The page: portrait 4:5, like a print photo mat. Every collage is this
 * size regardless of count — stable dimensions for next/image and MMS. */
export const COLLAGE_WIDTH = 1200;
export const COLLAGE_HEIGHT = 1500;
const JPEG_QUALITY = 80;

/** Exact output size — stored on the ad_photos row so next/image gets the
 * true aspect ratio. (Count no longer changes the page size; the parameter
 * stays for call-site compatibility.) */
export function collageDimensions(count?: number): { width: number; height: number } {
  void count;
  return { width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT };
}

/** A picture's region: the box its full frame must fit inside (no crop) and
 * the page corner/edge point the scaled picture hugs. */
interface Slot {
  boxW: number;
  boxH: number;
  x: number;
  y: number;
  ax: "left" | "right";
  ay: "top" | "bottom";
}

const W = COLLAGE_WIDTH;
const H = COLLAGE_HEIGHT;
const GRID_GUTTER = 8;

/** Corner-anchored scrapbook regions (2 and 3 pictures — 4 uses the grid),
 * sized so typical phone photos overlap a little (the diagonal two-up, the
 * staggered three). Order matters twice: slot N holds the seller's Nth
 * picture, and later pictures composite ON TOP where they overlap. */
function slotsFor(count: number): Slot[] {
  if (count === 2) {
    return [
      { boxW: 0.68 * W, boxH: 0.6 * H, x: 0, y: 0, ax: "left", ay: "top" },
      { boxW: 0.68 * W, boxH: 0.6 * H, x: W, y: H, ax: "right", ay: "bottom" },
    ];
  }
  return [
    { boxW: 0.64 * W, boxH: 0.44 * H, x: 0, y: 0, ax: "left", ay: "top" },
    { boxW: 0.56 * W, boxH: 0.64 * H, x: W, y: 0.18 * H, ax: "right", ay: "top" },
    { boxW: 0.6 * W, boxH: 0.44 * H, x: 0, y: H, ax: "left", ay: "bottom" },
  ];
}

export interface CollagePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The 4-picture layout (user decision): a fixed 2×2 grid, each cell filled
 * edge-to-edge — cover-cropped, which is what makes it read as a grid —
 * with a thin white gutter between cells. */
export function gridCells(): CollagePlacement[] {
  const w = (W - GRID_GUTTER) / 2;
  const h = (H - GRID_GUTTER) / 2;
  return [
    { left: 0, top: 0, width: w, height: h },
    { left: w + GRID_GUTTER, top: 0, width: w, height: h },
    { left: 0, top: h + GRID_GUTTER, width: w, height: h },
    { left: w + GRID_GUTTER, top: h + GRID_GUTTER, width: w, height: h },
  ];
}

/**
 * Where each picture lands on the page, given the pictures' (EXIF-corrected)
 * pixel sizes. Pure — the unit suite pins the invariants. 2–3 pictures:
 * scrapbook fit — aspect ratios preserved exactly (nothing cropped, nothing
 * stretched), every placement on the page, input order kept. 4 pictures:
 * the fixed 2×2 grid — dims are ignored because grid cells COVER-crop.
 */
export function collagePlacements(
  dims: { width: number; height: number }[],
): CollagePlacement[] {
  const use = dims.slice(0, MAX_COMBINED_PHOTOS);
  if (use.length >= MAX_COMBINED_PHOTOS) return gridCells();
  const slots = slotsFor(Math.min(Math.max(use.length, 2), 3));
  return use.map((d, i) => {
    const s = slots[i];
    const scale = Math.min(s.boxW / d.width, s.boxH / d.height);
    const width = Math.max(1, Math.round(d.width * scale));
    const height = Math.max(1, Math.round(d.height * scale));
    const left = s.ax === "left" ? Math.round(s.x) : Math.round(s.x - width);
    const top = s.ay === "top" ? Math.round(s.y) : Math.round(s.y - height);
    return { left, top, width, height };
  });
}

/**
 * Compose 2–4 images into one collage JPEG. Throws on fewer than 2 images or
 * on undecodable bytes — callers treat any throw as "couldn't combine" and
 * fall back to the first picture alone.
 */
export async function combineImageBuffers(images: Buffer[]): Promise<Buffer> {
  if (images.length < 2) throw new Error("combineImageBuffers needs at least 2 images");
  const use = images.slice(0, MAX_COMBINED_PHOTOS);
  // Normalize first: EXIF-rotate and learn each picture's true pixel size.
  // limitInputPixels: sender bytes could be a decompression bomb — a small
  // JPEG expanding past 64MP throws (caught by callers' fallback) instead of
  // eating the function's memory.
  const normalized = await Promise.all(
    use.map((buf) =>
      sharp(buf, { limitInputPixels: 64_000_000 }).rotate().toBuffer({ resolveWithObject: true }),
    ),
  );
  const placements = collagePlacements(
    normalized.map((n) => ({ width: n.info.width, height: n.info.height })),
  );
  // Scrapbook (2–3): "fill" to the exact placement size — never distorts,
  // collagePlacements preserved the ratio. Grid (4): "cover" fills each
  // fixed cell edge-to-edge, cropping centered.
  const fit = use.length >= MAX_COMBINED_PHOTOS ? ("cover" as const) : ("fill" as const);
  const cells = await Promise.all(
    normalized.map((n, i) =>
      sharp(n.data)
        .resize(placements[i].width, placements[i].height, { fit })
        .jpeg({ quality: 90 })
        .toBuffer(),
    ),
  );
  return sharp({
    create: {
      width: COLLAGE_WIDTH,
      height: COLLAGE_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(cells.map((input, i) => ({ input, left: placements[i].left, top: placements[i].top })))
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
