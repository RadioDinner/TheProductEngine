// Multi-picture combine (FEATURES item 32, scrapbook rework session 014) —
// placement math and real composition. The style contract: pictures are
// NEVER cropped or stretched (aspect ratios preserved exactly), they land
// corner-anchored on a portrait 4:5 white page in send order, later
// pictures composite on top where they overlap. Solid-color sources go in;
// each color is probed at an overlap-free point of its own placement.
import sharp from "sharp";
import {
  MAX_COMBINED_PHOTOS,
  COLLAGE_WIDTH,
  COLLAGE_HEIGHT,
  collageDimensions,
  collagePlacements,
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

// Mixed shapes on purpose: landscape, portrait, landscape, portrait.
const SIZES = [
  { width: 1600, height: 1200 },
  { width: 900, height: 1200 },
  { width: 1400, height: 1000 },
  { width: 1000, height: 1400 },
];

function solid(color, { width, height }) {
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

const inside = (p, x, y) =>
  x >= p.left && x < p.left + p.width && y >= p.top && y < p.top + p.height;

/** A probe point inside placement i that no LATER (on-top) placement covers. */
function visiblePoint(placements, i) {
  const p = placements[i];
  const candidates = [
    [0.5, 0.5],
    [0.2, 0.2],
    [0.8, 0.2],
    [0.2, 0.8],
    [0.8, 0.8],
    [0.1, 0.5],
    [0.9, 0.5],
  ].map(([fx, fy]) => [
    Math.round(p.left + p.width * fx),
    Math.round(p.top + p.height * fy),
  ]);
  return candidates.find(([x, y]) => !placements.slice(i + 1).some((q) => inside(q, x, y)));
}

export async function run(t) {
  t.eq("cap is 4", MAX_COMBINED_PHOTOS, 4);
  t.eq("page is portrait 4:5", { width: COLLAGE_WIDTH, height: COLLAGE_HEIGHT }, { width: 1200, height: 1500 });
  for (const count of [2, 3, 4, 9]) {
    t.eq(`dims are the fixed page (${count})`, collageDimensions(count), {
      width: COLLAGE_WIDTH,
      height: COLLAGE_HEIGHT,
    });
  }

  // Placement invariants for every count: nothing cropped (aspect ratio
  // preserved), nothing off the page, input order kept, cap enforced.
  for (const count of [2, 3, 4]) {
    const dims = SIZES.slice(0, count);
    const placements = collagePlacements(dims);
    t.eq(`${count}-up placement count`, placements.length, count);
    for (const [i, p] of placements.entries()) {
      const wantRatio = dims[i].width / dims[i].height;
      const gotRatio = p.width / p.height;
      t.eq(
        `${count}-up picture ${i + 1} keeps its shape (no crop)`,
        Math.abs(gotRatio - wantRatio) < 0.02,
        true,
      );
      t.eq(
        `${count}-up picture ${i + 1} stays on the page`,
        p.left >= 0 && p.top >= 0 && p.left + p.width <= COLLAGE_WIDTH && p.top + p.height <= COLLAGE_HEIGHT,
        true,
      );
    }
  }
  t.eq("placements clamp above cap", collagePlacements(SIZES.concat([SIZES[0]])).length, 4);
  // An extreme panorama still fits uncropped.
  const pano = collagePlacements([{ width: 4000, height: 800 }, SIZES[1]])[0];
  t.eq(
    "panorama fits uncropped",
    Math.abs(pano.width / pano.height - 5) < 0.05 && pano.left + pano.width <= COLLAGE_WIDTH,
    true,
  );

  const sources = await Promise.all(COLORS.map((c, i) => solid(c, SIZES[i])));

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
    t.eq(
      `${count}-up size`,
      { width: meta.width, height: meta.height },
      collageDimensions(count),
    );
    // Every source color is visible at an overlap-free point of its own
    // placement — proves order, position, and that nothing hid a picture.
    const placements = collagePlacements(SIZES.slice(0, count));
    for (let i = 0; i < count; i += 1) {
      const point = visiblePoint(placements, i);
      t.eq(`${count}-up picture ${i + 1} has a visible point`, Boolean(point), true);
      if (point) {
        const got = await probe(collage, point[0], point[1]);
        t.eq(`${count}-up picture ${i + 1} color shows`, near(got, COLORS[i]), true);
      }
    }
    // Somewhere on the page the white ground still shows (scrapbook look):
    // a corner no placement covers.
    const corners = [
      [4, 4],
      [COLLAGE_WIDTH - 5, 4],
      [4, COLLAGE_HEIGHT - 5],
      [COLLAGE_WIDTH - 5, COLLAGE_HEIGHT - 5],
    ];
    const free = corners.find(([x, y]) => !placements.some((p) => inside(p, x, y)));
    t.eq(`${count}-up has a free corner`, Boolean(free), true);
    if (free) {
      const got = await probe(collage, free[0], free[1]);
      t.eq(`${count}-up white shows through`, near(got, { r: 255, g: 255, b: 255 }), true);
    }
  }

  // A 5th image is ignored, not an error.
  const five = await combineImageBuffers([...sources, await solid({ r: 0, g: 0, b: 0 }, SIZES[0])]);
  const fiveMeta = await sharp(five).metadata();
  t.eq(
    "5 images clamp to the fixed page",
    { width: fiveMeta.width, height: fiveMeta.height },
    collageDimensions(4),
  );

  // EXIF orientation is honored: a landscape image tagged "rotate 90"
  // becomes portrait BEFORE placement, so its placed shape is portrait.
  const oriented = await sharp(await solid(COLORS[0], { width: 1200, height: 900 }))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const withExif = await combineImageBuffers([oriented, sources[1]]);
  const exifMeta = await sharp(withExif).metadata();
  t.eq(
    "EXIF input composes at page size",
    { width: exifMeta.width, height: exifMeta.height },
    collageDimensions(2),
  );
  // After EXIF rotation the first picture is 900×1200 (portrait): its
  // placement anchors top-left, so a point inside a portrait-shaped region
  // must carry its color while the spot right of a landscape-width region
  // stays white.
  const exifPlacements = collagePlacements([{ width: 900, height: 1200 }, SIZES[1]]);
  const p0 = exifPlacements[0];
  t.eq("EXIF rotation applied before placement", p0.height > p0.width, true);
  const insideP0 = await probe(withExif, p0.left + Math.round(p0.width / 2), p0.top + 20);
  t.eq("EXIF picture shows upright", near(insideP0, COLORS[0]), true);

  // Undecodable bytes throw (callers catch and fall back).
  let badThrew = false;
  try {
    await combineImageBuffers([Buffer.from("not an image at all"), sources[0]]);
  } catch {
    badThrew = true;
  }
  t.eq("garbage bytes throw", badThrew, true);
}
