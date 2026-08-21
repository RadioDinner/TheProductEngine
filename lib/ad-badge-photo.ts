/**
 * The ad's SMS picture: which photo carries the label, and whether the label
 * we have on file still describes it.
 *
 * `lib/ad-badge.ts` draws the badge and `lib/photos.ts storeBadgedPhoto` puts
 * a labelled copy in storage. This module is the small amount of THINKING
 * between them — deliberately pure, with no database and no sharp, so the
 * rules below are unit-testable and every reader (the batch composer, the
 * admin list, the "Label it now" action) decides staleness identically.
 *
 * ⚠️ THE STALENESS RULE IS A COMPARISON, NEVER A FLAG.
 *
 * An ad's position-0 picture can be replaced after the label was made — a
 * follow-up MMS onto a text ad installs one, and an admin-approved PIC
 * replacement swaps it. A label rendered from the old picture is then a
 * confident lie about what goes out, and the failure is silent: the operator
 * sees a labelled picture and has no way to know it is the wrong one.
 *
 * So nothing is trusted to clear a flag when it mutates a photo. The stored
 * label carries the src it was rendered FROM, and every read compares that
 * against the ad's current first texted picture. A writer that forgets costs
 * one wasted re-render, not a wrong picture.
 */
import { badgeLabel } from "@/lib/ad-badge";
import { textedAdPhotos } from "@/lib/photo-collage";

/** A labelled copy on file: where it lives, and what it was made from. */
export interface AdBadge {
  /** Public URL of the labelled copy (bucket `ad-photos`, folder `badged/`). */
  url: string;
  /** The picture it was rendered from — the staleness key. */
  src: string;
}

/** The shape this module needs off an ad: just its pictures. Structural on
 * purpose — importing StoredAd would drag the store into a pure module. */
export interface AdPictures {
  photo?: { src: string } | undefined;
  morePhotos?: { src: string }[] | undefined;
}

/**
 * The picture an ad's SMS message actually carries, or null for a text ad.
 *
 * One place, because `resolveBroadcastPictures` sends `textedAdPhotos(...)[0]`
 * and the label has to be made from that exact picture. Reading position 0
 * directly instead would be wrong for a legacy combined ad, whose position 0
 * is a collage that has not been sent since session 018.
 */
export function badgeSourceSrc(ad: AdPictures): string | null {
  return textedAdPhotos(ad.photo, ad.morePhotos)[0]?.src ?? null;
}

/**
 * The labelled copy to use for this ad right now, or null when there isn't
 * one to trust: no label on file, no picture on the ad, or a label made from a
 * picture the ad no longer sends.
 */
export function freshBadgeUrl(ad: AdPictures, badge: AdBadge | null | undefined): string | null {
  if (!badge?.url || !badge.src) return null;
  const source = badgeSourceSrc(ad);
  return source && badge.src === source ? badge.url : null;
}

/** What the label on this ad's picture reads — "AD 1024". Re-exported through
 * here so a caller needs one import to ask about an ad's SMS picture. */
export { badgeLabel };
