// Batched ads with numbered pictures (session 018).
//
// What is pinned here is what a subscriber actually receives: a batch text
// that numbers ads by AD NUMBER, one picture message per picture ad with the
// number burned into its bottom-right corner, and a PIC command that pulls the
// two extras rather than resending what already arrived.
//
// The badge is rendered for real (sharp), because its whole reason for being
// drawn as vector paths is that TEXT rendering silently produces nothing on a
// runtime with no fonts — a check that only inspected the SVG source would
// pass in exactly the world where the feature is broken.
import sharp from "sharp";
import {
  BATCH_MSG_MAX_GSM,
  MMS_SEGMENT_COST,
  batchAdLine,
  batchFooter,
  batchReady,
  batchSlotKey,
  batchWaitLabel,
  buildCategorizedSmsRows,
  composeBatchMessages,
  composeCatchupMessages,
  pictureCaption,
} from "../lib/digest-engine.ts";
import { badgeLabel, badgeLayout, badgeSvg, badgeText, stampAdNumber, BROADCAST_MAX_EDGE } from "../lib/ad-badge.ts";
import { slotIdentityTimestamp } from "../lib/engine-store-supabase.ts";
import { textedAdPhotos } from "../lib/photo-collage.ts";
import { segmentation } from "../lib/sms-segments.ts";

export const name = "batch";

const NOW = new Date("2026-08-20T15:00:00Z");

function photo(src) {
  return { src, alt: "", width: 800, height: 600 };
}

function ad(id, body, opts = {}) {
  return {
    id,
    ownerPhone: "3305550100",
    originalBody: body,
    body,
    status: "approved",
    createdAt: "2026-08-20T13:00:00Z",
    approvedAt: opts.approvedAt ?? "2026-08-20T14:30:00Z",
    flagged: false,
    ...(opts.photos
      ? {
          photo: photo(opts.photos[0]),
          ...(opts.photos.length > 1 && { morePhotos: opts.photos.slice(1).map(photo) }),
        }
      : {}),
  };
}

export async function run(t) {
  // ---------- when a batch goes out ----------
  const settings = { batchMinAds: 3, batchMaxWaitMinutes: 60 };
  const fresh = [ad(1, "a"), ad(2, "b")].map((a) => ({
    ...a,
    approvedAt: "2026-08-20T14:59:00Z",
  }));
  t.eq("nothing queued is never ready", batchReady([], NOW, settings), false);
  t.eq("two fresh ads wait", batchReady(fresh, NOW, settings), false);
  t.eq(
    "the third ad sends the batch",
    batchReady([...fresh, { ...ad(3, "c"), approvedAt: "2026-08-20T14:59:30Z" }], NOW, settings),
    true,
  );
  t.eq(
    "one ad goes once it has waited the hour",
    batchReady([{ ...ad(1, "a"), approvedAt: "2026-08-20T14:00:00Z" }], NOW, settings),
    true,
  );
  t.eq(
    "59 minutes is not the hour",
    batchReady([{ ...ad(1, "a"), approvedAt: "2026-08-20T14:01:00Z" }], NOW, settings),
    false,
  );
  t.eq(
    "the OLDEST decides, whatever the order",
    batchReady(
      [
        { ...ad(2, "b"), approvedAt: "2026-08-20T14:59:00Z" },
        { ...ad(1, "a"), approvedAt: "2026-08-20T13:30:00Z" },
      ],
      NOW,
      settings,
    ),
    true,
  );
  t.eq(
    "an unapproved ad falls back to when it was posted",
    batchReady([{ createdAt: "2026-08-20T13:00:00Z" }], NOW, settings),
    true,
  );
  t.eq(
    "count trigger off: only the timer decides",
    batchReady(fresh, NOW, { batchMinAds: 0, batchMaxWaitMinutes: 60 }),
    false,
  );
  t.eq(
    "timer off: only the count decides",
    batchReady([{ ...ad(1, "a"), approvedAt: "2026-01-01T00:00:00Z" }], NOW, {
      batchMinAds: 3,
      batchMaxWaitMinutes: 0,
    }),
    false,
  );
  t.eq(
    "both off never strands a paid ad",
    batchReady(fresh, NOW, { batchMinAds: 0, batchMaxWaitMinutes: 0 }),
    true,
  );
  t.eq(
    "a nonsense negative reads as off, not as an instant send",
    batchReady(fresh, NOW, { batchMinAds: -5, batchMaxWaitMinutes: 60 }),
    false,
  );

  // ---------- the batch's identity ----------
  t.eq("keyed on the head of the queue", batchSlotKey(1022, null), "batch#1022#0");
  t.eq("a re-run gets its own key", batchSlotKey(null, 7), "batch#0#7");
  t.eq(
    "same queue, same key (two cron ticks must not double-send)",
    batchSlotKey(1022, 3) === batchSlotKey(1022, 3),
    true,
  );
  t.eq(
    "a later batch is a different key",
    batchSlotKey(1022, null) === batchSlotKey(1025, null),
    false,
  );

  // A REGRESSION PIN. Session 016 keyed editions "ad#1022" and the Supabase
  // store turned any key into "<part0>T<partN>:00:00Z" — "adT1022:00:00Z",
  // which Postgres rejects, so every compose threw in production while the
  // development file store (which keys on the raw string) was perfectly happy.
  // Any slot key must map to a REAL timestamp.
  for (const key of ["batch#1022#0", "ad#1022", "batch#0#7", "2026-08-20#extra#14:05"]) {
    t.eq(`"${key}" maps to a valid timestamp`, Number.isFinite(Date.parse(slotIdentityTimestamp(key))), true);
  }
  t.eq(
    "a calendar key keeps the identity it always had",
    slotIdentityTimestamp("2026-08-20#7"),
    "2026-08-20T07:00:00Z",
  );
  t.eq(
    "an email slot key keeps its identity too",
    slotIdentityTimestamp("2026-08-20#email#12"),
    "2026-08-20T12:00:00Z",
  );
  t.eq(
    "a batch key is deterministic",
    slotIdentityTimestamp("batch#1022#0") === slotIdentityTimestamp("batch#1022#0"),
    true,
  );
  t.eq(
    "different batches, different identities",
    slotIdentityTimestamp("batch#1022#0") === slotIdentityTimestamp("batch#1023#0"),
    false,
  );

  // ---------- the batch text ----------
  const items = [
    ad(1022, "Gazebo for sale. Call 330-275-9541"),
    ad(1023, "20 inch gas cook stove, works great. 330-462-1279", { photos: ["https://x/1.jpg"] }),
    ad(1024, "Pygmy goats, 4 nannies. 330-473-0425", {
      photos: ["https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"],
    }),
  ];
  const messages = composeBatchMessages(NOW, items, { digestNo: 42, picturesRide: true });
  t.eq("a three-ad batch is ONE text", messages.length, 1);
  const text = messages[0];
  t.eq("header names the service and the edition", text.startsWith("The Plain Exchange No. 42 - Aug 20:"), true);
  t.eq("ads are numbered by AD NUMBER, not 1-2-3", text.includes("\n1022) Gazebo for sale."), true);
  t.eq("second ad numbered by its own id", text.includes("\n1023) 20 inch gas cook stove"), true);
  t.eq("a blank line between ads", text.includes("\n\n1024)"), true);
  t.eq(
    "an ad whose one picture already rode says nothing about PIC",
    text.includes("1023) 20 inch gas cook stove, works great. 330-462-1279\n"),
    true,
  );
  t.eq("an ad with extras advertises them", text.includes("More pics: PIC 1024"), true);
  t.eq("the footer teaches AD", text.includes("Reply AD to place an ad."), true);
  t.eq("the footer teaches STOP", text.includes("Reply STOP to end."), true);
  t.eq(
    "the PIC example names an ad that actually HAS more pictures",
    text.includes("like PIC 1024."),
    true,
  );
  t.eq("it stays GSM-7 (never UCS-2 pricing)", segmentation(text).encoding, "gsm");
  t.eq("and inside the six-segment ceiling", segmentation(text).segments <= 6, true);
  t.eq("which is what the ceiling means", BATCH_MSG_MAX_GSM, 918);

  // The footer's PIC line is only useful when it can be acted on.
  t.eq(
    "no extras anywhere: no PIC example",
    batchFooter([items[0], items[1]], true).includes("PIC"),
    false,
  );
  t.eq(
    "pictures OFF: even a one-picture ad is worth a PIC example",
    batchFooter([items[1]], false).includes("PIC 1023."),
    true,
  );

  // ---------- ad lines in both modes ----------
  t.eq("text ad, pictures riding", batchAdLine(items[0], true), "1022) Gazebo for sale. Call 330-275-9541");
  t.eq(
    "one-picture ad, pictures riding: nothing to add",
    batchAdLine(items[1], true),
    "1023) 20 inch gas cook stove, works great. 330-462-1279",
  );
  t.eq(
    "one-picture ad, pictures OFF: PIC is the only way to see it",
    batchAdLine(items[1], false),
    "1023) 20 inch gas cook stove, works great. 330-462-1279 Pic? Reply PIC 1023",
  );
  t.eq(
    "three-picture ad, pictures riding: two more to pull",
    batchAdLine(items[2], true),
    "1024) Pygmy goats, 4 nannies. 330-473-0425 More pics: PIC 1024",
  );

  // The catch-up a brand-new subscriber gets is text ONLY — a signup must
  // never fan out MMS — so every picture ad in it advertises PIC.
  const catchup = composeCatchupMessages(items).join("\n");
  t.eq("catch-up advertises PIC for a one-picture ad", catchup.includes("Pic? Reply PIC 1023"), true);
  t.eq("catch-up carries no pictures of its own", catchup.includes("More pics"), false);

  // ---------- the outbox rows: text first, then one message per picture ----------
  const pictures = new Map([
    [1023, "https://cdn/badged/a.jpg"],
    [1024, "https://cdn/badged/b.jpg"],
  ]);
  const built = buildCategorizedSmsRows({
    digestId: 5,
    now: NOW,
    items,
    categoriesByAd: new Map(),
    digestNo: 42,
    sponsorLines: [],
    pictures,
    recipients: [{ phone: "3305550111", categories: null }],
  });
  t.eq("one text + two pictures", built.rows.length, 3);
  t.eq("parts are numbered in order", built.rows.map((r) => r.part), [1, 2, 3]);
  t.eq("every row knows the total", built.rows.map((r) => r.parts), [3, 3, 3]);
  t.eq("the text carries no media", built.rows[0].media, undefined);
  t.eq("picture rows carry exactly one picture each", built.rows.slice(1).map((r) => r.media.length), [1, 1]);
  t.eq("badged URLs, in ad order", built.rows.slice(1).map((r) => r.media[0]), [
    "https://cdn/badged/a.jpg",
    "https://cdn/badged/b.jpg",
  ]);
  t.eq("the caption names the ad", built.rows[1].body, "1023) 20 inch gas cook stove");
  t.eq("a picture costs what an MMS costs", built.rows[1].segments, MMS_SEGMENT_COST);
  t.eq("all three ads counted as delivered", [...built.deliveredAdIds].sort(), [1022, 1023, 1024]);

  // A subscriber whose categories exclude the picture ad must not receive its
  // photo — the picture rows follow the FILTERED list, not the whole batch.
  const filtered = buildCategorizedSmsRows({
    digestId: 5,
    now: NOW,
    items,
    categoriesByAd: new Map([
      [1022, "horses"],
      [1023, "household"],
      [1024, "livestock"],
    ]),
    digestNo: 42,
    sponsorLines: [],
    pictures,
    recipients: [{ phone: "3305550111", categories: ["horses"] }],
  });
  t.eq("only their category's ad", filtered.rows.length, 1);
  t.eq("and no picture, since that ad has none", filtered.rows[0].media, undefined);
  t.eq("nothing else counted as delivered to them", [...filtered.deliveredAdIds], [1022]);

  // Text-only batch (pictures switched off): no picture rows at all.
  const textOnly = buildCategorizedSmsRows({
    digestId: 5,
    now: NOW,
    items,
    categoriesByAd: new Map(),
    digestNo: 42,
    sponsorLines: [],
    recipients: [{ phone: "3305550111", categories: null }],
  });
  t.eq("no pictures means no picture rows", textOnly.rows.length, 1);
  t.eq("and the ads advertise PIC instead", textOnly.rows[0].body.includes("Pic? Reply PIC 1023"), true);

  // ---------- which pictures the text channel carries ----------
  t.eq(
    "the first three, in order",
    textedAdPhotos(photo("a"), [photo("b"), photo("c"), photo("d")]).map((p) => p.src),
    ["a", "b", "c"],
  );
  t.eq("no pictures at all", textedAdPhotos(undefined, undefined), []);
  t.eq(
    "a legacy collage sends the ORIGINAL, never the collage",
    textedAdPhotos(photo("/object/public/ad-photos/collage/x.jpg"), [
      photo("/object/public/ad-photos/parts/1.jpg"),
      photo("/object/public/ad-photos/parts/2.jpg"),
    ]).map((p) => p.src),
    ["/object/public/ad-photos/parts/1.jpg", "/object/public/ad-photos/parts/2.jpg"],
  );
  t.eq("captions are short and numbered", pictureCaption(items[2]), "1024) Pygmy goats");

  // ---------- what the seller is told ----------
  t.eq(
    "an hour reads as an hour",
    batchWaitLabel({ batchMinAds: 3, batchMaxWaitMinutes: 60 }),
    "with the next batch of ads, usually within the hour",
  );
  t.eq(
    "minutes read as minutes",
    batchWaitLabel({ batchMinAds: 3, batchMaxWaitMinutes: 20 }),
    "with the next batch of ads, within 20 minutes",
  );
  t.eq(
    "no timer means no promise of one",
    batchWaitLabel({ batchMinAds: 3, batchMaxWaitMinutes: 0 }),
    "with the next batch of ads",
  );

  // ---------- the badge ----------
  t.eq("the label is the ad number", badgeLabel(1024), "AD 1024");
  t.eq("only drawable characters survive", badgeText("Ad #1024!"), "AD 1024");
  const layout = badgeLayout(900, 1200, "AD 1024");
  t.eq(
    "the badge sits in the BOTTOM-RIGHT corner",
    layout.box.x + layout.box.width < 900 && layout.box.y + layout.box.height < 1200,
    true,
  );
  t.eq(
    "hard against the right edge, not floating",
    Math.round(900 - (layout.box.x + layout.box.width)) <= Math.round(900 * 0.03),
    true,
  );
  t.eq(
    "hard against the bottom edge",
    Math.round(1200 - (layout.box.y + layout.box.height)) <= Math.round(1200 * 0.03),
    true,
  );
  t.eq(
    "a bigger picture gets a bigger badge",
    badgeLayout(2000, 2000, "AD 1024").capPx > badgeLayout(600, 600, "AD 1024").capPx,
    true,
  );
  t.eq(
    "a long number on a narrow picture is shrunk, never run off the edge",
    badgeLayout(320, 240, "AD 1000024").box.width <= 320 * 0.7 + 0.5,
    true,
  );
  const svg = badgeSvg("AD 1024", 900, 1200);
  t.eq("it is a picture-sized overlay", svg.includes('width="900" height="1200"'), true);
  t.eq("with a plate behind the text", svg.includes("<rect"), true);
  t.eq("drawn as PATHS, never as <text> (no fonts on the runtime)", svg.includes("<text"), false);
  t.eq(
    "one path group per glyph, plus the two-stroke A",
    (svg.match(/<path/g) ?? []).length,
    8,
  );

  // Rendered for real: the badge has to be VISIBLE, in the corner, on a
  // picture that stays inside MMS-friendly dimensions.
  const source = await sharp({
    create: { width: 1800, height: 2400, channels: 3, background: { r: 90, g: 120, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  const stamped = await stampAdNumber(source, badgeLabel(1024));
  const meta = await sharp(stamped).metadata();
  t.eq("a big phone photo is scaled down for MMS", meta.width <= BROADCAST_MAX_EDGE, true);
  t.eq("and keeps its shape", meta.height <= BROADCAST_MAX_EDGE, true);
  t.eq("still a JPEG", meta.format, "jpeg");
  // Probe REAL PIXELS. (sharp's stats() reports on the input image, not on the
  // extracted region — a check built on it passes whatever the badge did.)
  const box = badgeLayout(meta.width, meta.height, badgeText(badgeLabel(1024))).box;
  const badgeArea = await pixels(stamped, {
    left: Math.round(box.x),
    top: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  });
  // The plate is near-black and the glyphs near-yellow, so where the badge
  // landed is nothing like the flat green it was.
  t.eq("the badge's corner is no longer the picture", badgeArea.mean[2] < 40, true);
  t.eq(
    "yellow ink actually rendered (a font-less <text> badge would be blank here)",
    badgeArea.yellow / badgeArea.count > 0.02,
    true,
  );
  const untouched = await pixels(stamped, { left: 0, top: 0, width: 200, height: 200 });
  t.eq(
    "and the picture itself is untouched",
    [untouched.min, untouched.max],
    [
      [90, 121, 90],
      [90, 121, 90],
    ],
  );
}

/** Per-channel mean/min/max and a count of badge-yellow pixels in a region. */
async function pixels(image, box) {
  const { data, info } = await sharp(image).extract(box).raw().toBuffer({ resolveWithObject: true });
  const sums = [0, 0, 0];
  const max = [0, 0, 0];
  const min = [255, 255, 255];
  let yellow = 0;
  const count = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    for (let c = 0; c < 3; c++) {
      sums[c] += data[i + c];
      max[c] = Math.max(max[c], data[i + c]);
      min[c] = Math.min(min[c], data[i + c]);
    }
    if (r > 180 && g > 150 && b < 80) yellow++;
  }
  return { mean: sums.map((s) => Math.round(s / count)), min, max, yellow, count };
}
