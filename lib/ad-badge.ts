/**
 * The ad-number badge burned into the corner of a broadcast picture.
 *
 * Since session 018 ads go out in BATCHES: one text listing several ads by
 * their ad number, then one picture per picture-ad, each its own message. A
 * picture arriving on its own says nothing about which ad it belongs to — the
 * batch text might list four — so the ad number is composited into the
 * picture itself, bottom-right, before it is sent. It is the only thing tying
 * the photo to its line in the list, and to the PIC command that pulls the
 * rest ("PIC 1024").
 *
 * ⚠️ WHY THE GLYPHS ARE DRAWN AS PATHS INSTEAD OF TEXT
 *
 * sharp renders SVG through librsvg, and `<text>` needs a font that fontconfig
 * can find. The serverless runtime this deploys to ships no fonts, so a
 * `<text>` badge renders blank or as tofu boxes THERE while looking perfect
 * on any developer machine — a failure that cannot be caught locally and would
 * put unlabelled pictures in front of every subscriber. So every character is
 * a stroked path in this file: twelve glyphs (0-9, A, D) is all a badge needs,
 * and they render identically everywhere because nothing outside these bytes
 * decides what they look like. Do not "simplify" this to <text>.
 *
 * The pure geometry lives in `badgeSvg` so the unit suite can assert placement
 * and scaling without a rasteriser; `stampAdNumber` does the sharp work and is
 * exercised against a real render.
 */

/** sharp is loaded lazily, never at module scope — the same rule as
 * lib/photo-collage.ts. A missing native binding must cost one badge, not
 * every route that transitively imports this file. */
async function loadSharp() {
  return (await import("sharp")).default;
}

/** Glyphs are drawn on a 100-unit cap height; this is the stroke that gives
 * them weight, in the same units. */
const STROKE = 15;
/** Ink box of a full-width glyph, in glyph units (excludes the stroke). */
const GLYPH_W = 56;
/** Pen advance per glyph — tabular, so "1024" and "8888" are the same width
 * and a column of badges doesn't jitter. */
const ADVANCE = GLYPH_W + 12;
/** A space is narrower than a digit. */
const SPACE_ADVANCE = 34;

/** An ellipse as path data (librsvg draws `<ellipse>` fine — paths keep every
 * glyph one shape kind, which keeps the scaling assertions simple). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx},${cy}a${rx},${ry} 0 1 0 ${rx * 2},0a${rx},${ry} 0 1 0 ${-rx * 2},0`;
}

/**
 * Stroke centerlines for each character, on a box 0..56 wide and 0..100 tall
 * (cap top to baseline). Coordinates are inset by half the stroke so the ink
 * lands inside the box. Geometric shapes on purpose: at badge size, curves
 * with real contrast turn to mush, and these read at a glance on a flip-phone
 * screen from across a barn.
 */
const GLYPHS: Record<string, string[]> = {
  "0": [ellipsePath(28, 50, 20, 42)],
  "1": ["M8,28L28,8L28,92", "M12,92H44"],
  "2": ["M8,26C8,8 30,2 42,12C54,23 48,40 36,52L8,92H48"],
  "3": ["M9,24C14,10 32,4 42,14C52,25 44,42 28,46C46,48 54,64 46,78C37,93 16,92 8,78"],
  "4": ["M38,92V8L8,64H48"],
  "5": ["M46,8H18L13,44C26,36 42,40 46,54C51,70 40,90 24,90C16,90 11,86 8,80"],
  "6": [
    "M44,14C34,4 18,12 13,30C9,44 9,68 16,80C24,93 44,91 46,72C48,56 36,46 24,50C16,53 13,60 13,64",
  ],
  "7": ["M8,8H48L24,92"],
  "8": [ellipsePath(28, 27, 17, 19), ellipsePath(28, 70, 20, 22)],
  "9": [
    "M12,86C22,96 38,88 43,70C47,56 47,32 40,20C32,7 12,9 10,28C8,44 20,54 32,50C40,47 43,40 43,36",
  ],
  A: ["M8,92L28,8L48,92", "M16,66H40"],
  D: ["M12,8H26C44,8 50,26 50,50C50,74 44,92 26,92H12Z"],
  " ": [],
};

/** Anything the glyph table can't draw is dropped rather than rendered as a
 * gap — a badge with a mystery hole in it is worse than a shorter badge. */
export function badgeText(label: string): string {
  return label
    .toUpperCase()
    .split("")
    .filter((ch) => ch in GLYPHS)
    .join("");
}

/** Width of a rendered label in glyph units (no trailing gap). */
export function textWidthUnits(text: string): number {
  if (!text.length) return 0;
  let width = 0;
  for (const ch of text) width += ch === " " ? SPACE_ADVANCE : ADVANCE;
  return width - (text[text.length - 1] === " " ? SPACE_ADVANCE : ADVANCE) + GLYPH_W;
}

export interface BadgeLayout {
  /** Cap height in pixels — every other dimension derives from it. */
  capPx: number;
  /** The plate behind the text. */
  box: { x: number; y: number; width: number; height: number; radius: number };
  /** Where the glyph origin (left edge, cap top) sits, and the glyph scale. */
  text: { x: number; y: number; scale: number };
}

/**
 * Where the badge sits on a `width` x `height` picture: BOTTOM RIGHT (the
 * user's decision — the competitor stamps top-right, but a phone photo's
 * subject is usually centre-high, and the bottom corner is the emptiest part
 * of a picture of a stove, a buggy or a goat).
 *
 * The size is driven by the SHORTER edge so a tall portrait photo and a wide
 * landscape one get the same visual weight, then clamped: never smaller than
 * legible, never wider than 70% of the picture (a 5-digit ad number on a
 * narrow image would otherwise run the full width).
 */
export function badgeLayout(width: number, height: number, text: string): BadgeLayout {
  const short = Math.max(1, Math.min(width, height));
  const capPx = Math.max(18, Math.min(110, Math.round(short * 0.055)));
  const padX = capPx * 0.42;
  const padY = capPx * 0.3;
  const units = textWidthUnits(text);
  let scale = capPx / 100;
  let boxWidth = units * scale + padX * 2;
  const maxWidth = width * 0.7;
  if (boxWidth > maxWidth && units > 0) {
    // Shrink the whole badge (text and padding together) rather than clipping.
    scale *= (maxWidth - padX * 2) / (boxWidth - padX * 2);
    boxWidth = units * scale + padX * 2;
  }
  const boxHeight = 100 * scale + padY * 2;
  const margin = Math.max(6, Math.round(short * 0.025));
  const x = Math.max(0, width - margin - boxWidth);
  const y = Math.max(0, height - margin - boxHeight);
  return {
    capPx,
    box: { x, y, width: boxWidth, height: boxHeight, radius: boxHeight * 0.18 },
    text: { x: x + padX, y: y + padY, scale },
  };
}

/** Round for SVG output — 2 decimals is well past a pixel and keeps the
 * markup (and the test assertions) readable. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The badge as a standalone SVG the size of the picture, ready to composite at
 * 0,0. Black plate, high-visibility yellow glyphs — the same read-from-a-
 * distance combination as the competitor's, and the two colours a compressed
 * JPEG holds onto best.
 */
export function badgeSvg(label: string, width: number, height: number): string {
  const text = badgeText(label);
  const layout = badgeLayout(width, height, text);
  const paths: string[] = [];
  let pen = 0;
  for (const ch of text) {
    for (const d of GLYPHS[ch]) {
      paths.push(`<path transform="translate(${n(pen)},0)" d="${d}"/>`);
    }
    pen += ch === " " ? SPACE_ADVANCE : ADVANCE;
  }
  const { box, text: t } = layout;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"`,
    ` rx="${n(box.radius)}" fill="#000000" fill-opacity="0.85"/>`,
    `<g transform="translate(${n(t.x)},${n(t.y)}) scale(${n(t.scale)})" fill="none" stroke="#FFE000"`,
    ` stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
    paths.join(""),
    `</g></svg>`,
  ].join("");
}

/** The label a broadcast picture carries: the ad number, spelled out. Kept in
 * one place because it has to match the batch text's numbering and the PIC
 * command's argument exactly — the badge is what teaches a subscriber that
 * "1024" is a thing they can reply about. */
export function badgeLabel(adId: number): string {
  return `AD ${adId}`;
}

/**
 * The longest edge a broadcast picture is scaled to. MMS is the most
 * expensive and least reliable thing this service sends: carriers transcode
 * (or reject) big attachments, and a 5 MB phone photo helps nobody on a flip
 * phone. 1200px at q80 lands around 150-350 KB, which every carrier accepts.
 * Only ever scales DOWN.
 */
export const BROADCAST_MAX_EDGE = 1200;

/**
 * Burn the ad number into a picture's bottom-right corner.
 *
 * `.rotate()` first: EXIF orientation has to be baked into the pixels before
 * anything is composited, or the badge lands sideways on half the phone
 * photos in the world. Throws on undecodable bytes — every caller treats a
 * throw as "send the picture unbadged", because a picture with no number on it
 * still sells the item, and no picture at all does not.
 */
export async function stampAdNumber(bytes: Buffer, label: string): Promise<Buffer> {
  const sharp = await loadSharp();
  // limitInputPixels: sender bytes could be a decompression bomb — a small
  // JPEG that expands past 64MP throws instead of eating the function's
  // memory (same guard as the collage compositor).
  const base = await sharp(bytes, { limitInputPixels: 64_000_000 })
    .rotate()
    .resize(BROADCAST_MAX_EDGE, BROADCAST_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const svg = Buffer.from(badgeSvg(label, width, height));
  return sharp(base.data)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer();
}
