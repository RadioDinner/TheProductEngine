// Multi-picture combine (FEATURES item 32) — layout math and real
// composition. Solid-color source images go in; the collage must come out
// with the exact layout dimensions, JPEG bytes, and each source's color in
// its cell (probed at cell centers), proving order and placement.
import sharp from "sharp";
import {
  MAX_COMBINED_PHOTOS,
  COLLAGE_WIDTH,
  collageDimensions,
  combineImageBuffers,
} from "../lib/photo-collage.ts";
import { sniffImage } from "../lib/image-sniff.ts";

export const name = "photo-collage";

const COLORS = [
  { r: 200, g: 30, b: 30 }, // red
  { r: 30, g: 160, b: 30 }, // green
  { r: 30, g: 30, b: 200 }, // blue
  { r: 220, g: 180, b: 30 }, // yellow
];

function solid(color, width = 900, height = 700) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function probe(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at], g: data[at + 1], b: data[at + 2] };
}

// Solid JPEG colors drift a little under compression — near is plenty.
function near(a, b) {
  return Math.abs(a.r - b.r) < 30 && Math.abs(a.g - b.g) < 30 && Math.abs(a.b - b.b) < 30;
}

export async function run(t) {
  t.eq("cap is 4", MAX_COMBINED_PHOTOS, 4);
  t.eq("2-up dims", collageDimensions(2), { width: 1200, height: 596 });
  t.eq("3-up dims", collageDimensions(3), { width: 1200, height: 1200 });
  t.eq("4-up dims", collageDimensions(4), { width: 1200, height: 1200 });
  t.eq("dims clamp above cap", collageDimensions(9), collageDimensions(4));

  const sources = await Promise.all(COLORS.map((c) => solid(c)));

  // Fewer than 2 must throw — the callers' fallback contract.
  let threw = false;
  try {
    await combineImageBuffers([sources[0]]);
  } catch {
    threw = true;
  }
  t.eq("single image throws", threw, true);

  for (const count of [2, 3, 4]) {
    const collage = await combineImageBuffers(sources.slice(0, count));
    t.eq(`${count}-up bytes are JPEG`, sniffImage(collage), "jpg");
    const meta = await sharp(collage).metadata();
    const want = collageDimensions(count);
    t.eq(`${count}-up size`, { width: meta.width, height: meta.height }, want);
  }

  // Placement: every source color lands in its cell, in order (2×2 grid).
  const four = await combineImageBuffers(sources);
  const centers = [
    [298, 298],
    [902, 298],
    [298, 902],
    [902, 902],
  ];
  for (const [i, [x, y]] of centers.entries()) {
    const got = await probe(four, x, y);
    t.eq(`4-up cell ${i + 1} color`, near(got, COLORS[i]), true);
  }
  // The gutter between cells stays white.
  const gutter = await probe(four, 600, 298);
  t.eq("gutter is white", near(gutter, { r: 255, g: 255, b: 255 }), true);

  // A 5th image is ignored, not an error.
  const five = await combineImageBuffers([...sources, await solid({ r: 0, g: 0, b: 0 })]);
  const fiveMeta = await sharp(five).metadata();
  t.eq("5 images clamp to 4-up layout", { width: fiveMeta.width, height: fiveMeta.height }, collageDimensions(4));

  // EXIF orientation is honored: a portrait image tagged "rotate 90" must
  // fill its landscape cell without stretching artifacts — just prove the
  // compose path accepts EXIF'd input and returns the right geometry.
  const oriented = await sharp(await solid(COLORS[0], 700, 900))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const withExif = await combineImageBuffers([oriented, sources[1]]);
  const exifMeta = await sharp(withExif).metadata();
  t.eq("EXIF input composes", { width: exifMeta.width, height: exifMeta.height }, collageDimensions(2));

  // Undecodable bytes throw (callers catch and fall back).
  let badThrew = false;
  try {
    await combineImageBuffers([Buffer.from("not an image at all"), sources[0]]);
  } catch {
    badThrew = true;
  }
  t.eq("garbage bytes throw", badThrew, true);
}
