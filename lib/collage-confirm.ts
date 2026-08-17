/**
 * Combined-photo confirmation decisions (FEATURES item 33) — the pure math
 * behind "text the seller their finished collage once the picture set has
 * been quiet for 10 minutes". Dependency-free so the unit suite imports it
 * directly; the cron-side runner (lib/collage-notify.ts) feeds it real ads.
 */

/** Quiet time after the last picture before the set counts as complete. */
export const COLLAGE_QUIET_MS = 10 * 60 * 1000;

/** Only ads this recent are considered — keeps the cron query tiny and stops
 * a freshly-pasted 9974 (which backfills ad_photos.created_at to the paste
 * time) from texting sellers about long-finished ads. */
export const COLLAGE_CONFIRM_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface CollageConfirmInput {
  /** When the ad itself was posted. */
  createdAt: string;
  /** When the seller was last texted the collage; null = never. */
  collageNotifiedAt: string | null;
  /** When each picture row landed (ad_photos.created_at; nulls skipped). */
  photoCreatedAts: (string | null | undefined)[];
}

/**
 * Is this collage ad due its combined-photo text at `nowMs`? Returns the
 * newest picture-activity time (the value a claim should CAS against), or
 * null for "not now": still inside the quiet window, or already notified
 * for the current picture set. A stamp OLDER than the newest picture means
 * pictures arrived since the last text — that re-arms exactly one more send
 * after the next quiet period.
 */
export function dueCollageConfirmation(
  ad: CollageConfirmInput,
  nowMs: number,
): { lastPhotoAt: string } | null {
  const photoTimes = ad.photoCreatedAts
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter(Number.isFinite);
  const lastMs = Math.max(Date.parse(ad.createdAt), ...photoTimes);
  if (!Number.isFinite(lastMs)) return null;
  if (nowMs - lastMs < COLLAGE_QUIET_MS) return null;
  const notifiedMs = ad.collageNotifiedAt ? Date.parse(ad.collageNotifiedAt) : null;
  if (notifiedMs !== null && notifiedMs >= lastMs) return null;
  return { lastPhotoAt: new Date(lastMs).toISOString() };
}

/** The seller-facing MMS body (GSM-sanitized at the outbound choke point). */
export function collageConfirmationBody(
  adId: number,
  title: string,
  pictureCount: number,
): string {
  const count = pictureCount >= 2 ? `your ${pictureCount} pictures` : "your pictures";
  return `Here's the combined photo for ad #${adId} (${title}) - ${count} in one picture. This is what buyers will see.`;
}
