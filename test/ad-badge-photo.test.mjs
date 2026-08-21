// Which picture carries the ad number, and whether the label on file still
// describes it (session 024).
//
// The badge itself — that the ink actually lands on the pixels — is pinned in
// batch.test.mjs, which renders one for real. What is pinned HERE is the
// thinking around it, and both halves have a specific failure they exist to
// stop:
//
//  - `badgeSourceSrc` must name the picture the batch actually SENDS. For a
//    legacy combined ad that is not position 0: position 0 is a collage, and
//    collages have not been broadcast since session 018.
//  - `freshBadgeUrl` must refuse a label made from a picture the ad no longer
//    sends. A seller can replace an ad's picture after it was labelled, and a
//    stale label is worse than none — it shows the operator a confident
//    preview of a picture nobody will receive.
import { badgeSourceSrc, freshBadgeUrl } from "../lib/ad-badge-photo.ts";

export const name = "ad-badge-photo";

const BUCKET = "https://xyz.supabase.co/storage/v1/object/public/ad-photos";

function photo(src) {
  return { src, alt: "", width: 800, height: 600 };
}

export function run(t) {
  // ---- which picture carries the label ----

  t.eq("a text ad has no picture to label", badgeSourceSrc({}), null);
  t.eq(
    "an empty gallery is still no picture",
    badgeSourceSrc({ photo: undefined, morePhotos: [] }),
    null,
  );
  t.eq(
    "a one-picture ad labels that picture",
    badgeSourceSrc({ photo: photo(`${BUCKET}/a.jpg`) }),
    `${BUCKET}/a.jpg`,
  );
  t.eq(
    "a three-picture ad labels the FIRST — one picture goes out per ad",
    badgeSourceSrc({
      photo: photo(`${BUCKET}/a.jpg`),
      morePhotos: [photo(`${BUCKET}/b.jpg`), photo(`${BUCKET}/c.jpg`)],
    }),
    `${BUCKET}/a.jpg`,
  );
  // The one that would go wrong if this read position 0 directly: a legacy
  // combined ad broadcasts an ORIGINAL, never the collage sitting at 0.
  t.eq(
    "a legacy collage ad labels its first original, not the collage",
    badgeSourceSrc({
      photo: photo(`${BUCKET}/collage/page.jpg`),
      morePhotos: [photo(`${BUCKET}/parts/one.jpg`), photo(`${BUCKET}/parts/two.jpg`)],
    }),
    `${BUCKET}/parts/one.jpg`,
  );
  t.eq(
    "a collage whose originals are gone keeps the collage — better than nothing",
    badgeSourceSrc({ photo: photo(`${BUCKET}/collage/page.jpg`) }),
    `${BUCKET}/collage/page.jpg`,
  );
  // Website-only extras (past the 3 the text channel carries) never label.
  t.eq(
    "a 4th picture never becomes the labelled one",
    badgeSourceSrc({
      photo: photo(`${BUCKET}/a.jpg`),
      morePhotos: [photo(`${BUCKET}/b.jpg`), photo(`${BUCKET}/c.jpg`), photo(`${BUCKET}/d.jpg`)],
    }),
    `${BUCKET}/a.jpg`,
  );

  // ---- is the label on file still true ----

  const ad = { photo: photo(`${BUCKET}/a.jpg`) };
  const label = { url: `${BUCKET}/badged/x.jpg`, src: `${BUCKET}/a.jpg` };

  t.eq("a label made from this ad's picture is used", freshBadgeUrl(ad, label), label.url);
  t.eq("no label on file reads as no label", freshBadgeUrl(ad, undefined), null);
  t.eq("an explicitly null label reads as no label", freshBadgeUrl(ad, null), null);
  // THE ONE THAT MATTERS: the picture was replaced after the label was made.
  t.eq(
    "a label made from a REPLACED picture is refused",
    freshBadgeUrl({ photo: photo(`${BUCKET}/new.jpg`) }, label),
    null,
  );
  t.eq(
    "a label cannot outlive the picture being deleted",
    freshBadgeUrl({}, label),
    null,
  );
  // Half a record can't be checked for staleness, so it is not trusted.
  t.eq(
    "a URL with no source src is refused",
    freshBadgeUrl(ad, { url: `${BUCKET}/badged/x.jpg`, src: "" }),
    null,
  );
  t.eq(
    "a source src with no URL is refused",
    freshBadgeUrl(ad, { url: "", src: `${BUCKET}/a.jpg` }),
    null,
  );
  // A legacy collage ad's label is keyed to the ORIGINAL it was made from, so
  // it stays fresh even though position 0 is something else entirely.
  const collageAd = {
    photo: photo(`${BUCKET}/collage/page.jpg`),
    morePhotos: [photo(`${BUCKET}/parts/one.jpg`)],
  };
  t.eq(
    "a collage ad's label is keyed to the original that ships",
    freshBadgeUrl(collageAd, { url: `${BUCKET}/badged/y.jpg`, src: `${BUCKET}/parts/one.jpg` }),
    `${BUCKET}/badged/y.jpg`,
  );
  t.eq(
    "a label made from the collage itself is refused — that picture is not sent",
    freshBadgeUrl(collageAd, { url: `${BUCKET}/badged/y.jpg`, src: `${BUCKET}/collage/page.jpg` }),
    null,
  );
}
