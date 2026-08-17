// Combined-photo confirmation (FEATURES item 33) — the pure decision math:
// when has a multi-picture ad's set been quiet long enough to text the seller
// the finished collage, and when does a later picture re-arm exactly one more
// send. The cron-side claim CAS relies on lastPhotoAt being exact.
import {
  COLLAGE_QUIET_MS,
  collageConfirmationBody,
  dueCollageConfirmation,
} from "../lib/collage-confirm.ts";

export const name = "collage-confirm";

const T0 = Date.parse("2026-08-17T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;

export function run(t) {
  // Quiet-window basics: the clock runs from the NEWEST activity.
  t.eq(
    "9 minutes after the last picture: not yet",
    dueCollageConfirmation(
      { createdAt: iso(T0 - 30 * MIN), collageNotifiedAt: null, photoCreatedAts: [iso(T0 - 9 * MIN)] },
      T0,
    ),
    null,
  );
  t.eq(
    "10 quiet minutes: due, stamped with the newest picture time",
    dueCollageConfirmation(
      { createdAt: iso(T0 - 30 * MIN), collageNotifiedAt: null, photoCreatedAts: [iso(T0 - 10 * MIN)] },
      T0,
    ),
    { lastPhotoAt: iso(T0 - 10 * MIN) },
  );
  t.eq("quiet window matches the exported constant", COLLAGE_QUIET_MS, 10 * MIN);

  // The newest of ad-created and every picture drives the clock — an old ad
  // with a fresh picture is NOT due yet.
  t.eq(
    "fresh picture on an old ad resets the clock",
    dueCollageConfirmation(
      {
        createdAt: iso(T0 - 120 * MIN),
        collageNotifiedAt: null,
        photoCreatedAts: [iso(T0 - 110 * MIN), iso(T0 - 2 * MIN)],
      },
      T0,
    ),
    null,
  );
  // Null picture times (pre-9974 rows mid-paste) fall back to ad creation.
  t.eq(
    "null photo times fall back to the ad's own age",
    dueCollageConfirmation(
      { createdAt: iso(T0 - 15 * MIN), collageNotifiedAt: null, photoCreatedAts: [null, undefined] },
      T0,
    ),
    { lastPhotoAt: iso(T0 - 15 * MIN) },
  );

  // Already notified for this exact set: never a second text.
  t.eq(
    "notified after the last picture: done",
    dueCollageConfirmation(
      {
        createdAt: iso(T0 - 60 * MIN),
        collageNotifiedAt: iso(T0 - 20 * MIN),
        photoCreatedAts: [iso(T0 - 40 * MIN)],
      },
      T0,
    ),
    null,
  );
  // A picture AFTER the last text re-arms exactly one more send.
  t.eq(
    "picture after the last text re-arms",
    dueCollageConfirmation(
      {
        createdAt: iso(T0 - 60 * MIN),
        collageNotifiedAt: iso(T0 - 30 * MIN),
        photoCreatedAts: [iso(T0 - 40 * MIN), iso(T0 - 12 * MIN)],
      },
      T0,
    ),
    { lastPhotoAt: iso(T0 - 12 * MIN) },
  );
  t.eq(
    "re-armed but still inside the quiet window: wait",
    dueCollageConfirmation(
      {
        createdAt: iso(T0 - 60 * MIN),
        collageNotifiedAt: iso(T0 - 30 * MIN),
        photoCreatedAts: [iso(T0 - 40 * MIN), iso(T0 - 5 * MIN)],
      },
      T0,
    ),
    null,
  );
  // Notification stamped exactly AT the last picture time counts as done
  // (>= — the claim CAS stamps now(), which is always past the quiet window).
  t.eq(
    "stamp equal to the last picture time: done",
    dueCollageConfirmation(
      {
        createdAt: iso(T0 - 60 * MIN),
        collageNotifiedAt: iso(T0 - 20 * MIN),
        photoCreatedAts: [iso(T0 - 20 * MIN)],
      },
      T0,
    ),
    null,
  );
  // Garbage timestamps never crash the cron — they just skip the ad.
  t.eq(
    "unparseable timestamps skip, not throw",
    dueCollageConfirmation(
      { createdAt: "not a date", collageNotifiedAt: null, photoCreatedAts: ["also junk"] },
      T0,
    ),
    null,
  );

  // Seller-facing copy: GSM-friendly (no curly quotes/em dashes), counts named.
  t.eq(
    "confirmation body names the ad and count",
    collageConfirmationBody(1015, "Brand new baluster", 2),
    "Here's the combined photo for ad #1015 (Brand new baluster) - your 2 pictures in one picture. This is what buyers will see.",
  );
  t.eq(
    "degenerate count falls back to plain wording",
    collageConfirmationBody(1016, "Horse cart", 0),
    "Here's the combined photo for ad #1016 (Horse cart) - your pictures in one picture. This is what buyers will see.",
  );
}
