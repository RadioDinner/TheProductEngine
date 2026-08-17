/**
 * Combined-photo confirmation runner (FEATURES item 33): once a
 * multi-picture ad's pictures have settled — 10 quiet minutes since the last
 * one arrived — the seller is texted the finished collage, so they see
 * exactly the one picture buyers will get. Runs from the 5-minute cron, so
 * the text lands 10–15 minutes after the last picture. The decision math is
 * pure and unit-tested in lib/collage-confirm.ts.
 *
 * Mechanics:
 * - Candidates are pending/approved ads from the last 24 hours whose
 *   position-0 picture is a `collage/` object (single-picture ads never
 *   combined anything, so they get no text).
 * - The quiet clock is the newest ad_photos.created_at (migration 9974;
 *   falls back to the ad's own created_at).
 * - Sends are claimed by compare-and-set on ads.collage_notified_at BEFORE
 *   dispatch, so overlapping cron ticks can't double-send an MMS (at-most-
 *   once by design: a send failure after a claim is logged, not retried — a
 *   later picture re-arms the stamp and earns a fresh send).
 * - Pre-9974 the candidate select fails on the missing column: degrade
 *   gracefully (warn once, send nothing) — never break the digest cron.
 */
import { deriveTitle } from "@/lib/ad-display";
import {
  COLLAGE_CONFIRM_LOOKBACK_MS,
  collageConfirmationBody,
  dueCollageConfirmation,
} from "@/lib/collage-confirm";
import { db, supabaseConfigured } from "@/lib/db";
import { dispatchSms } from "@/lib/outbound";
import { isCollageSrc, isCombinePartSrc } from "@/lib/photos";

/** MMS-cost guardrail: the most confirmations one cron tick sends. The rest
 * stay unclaimed and go out on following ticks. */
const MAX_SENDS_PER_RUN = 25;

interface CandidateRow {
  id: number;
  body: string;
  created_at: string;
  collage_notified_at: string | null;
  users: { phone: string | null } | null;
  ad_photos: { src: string; position: number; created_at: string | null }[] | null;
}

/** 42703 = missing column on SELECT; PGRST204 = missing column in an UPDATE
 * payload — both mean migration 9974 isn't pasted yet. */
function missing9974(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

let warnedMissing = false;

export interface CollageConfirmRunResult {
  sent: number;
  skipped?: string;
}

/**
 * Find due ads and text each seller their finished collage. Called from the
 * digest cron every 5 minutes; must never throw (a photo-confirmation problem
 * can't be allowed to take down digest delivery).
 */
export async function runDueCollageConfirmations(): Promise<CollageConfirmRunResult> {
  if (!supabaseConfigured) return { sent: 0, skipped: "supabase not configured (dev mode)" };
  try {
    const nowMs = Date.now();
    const sinceIso = new Date(nowMs - COLLAGE_CONFIRM_LOOKBACK_MS).toISOString();
    const { data, error } = await db()
      .from("ads")
      .select(
        "id, body, created_at, collage_notified_at, users!inner(phone), ad_photos(src, position, created_at)",
      )
      .in("status", ["pending", "approved"])
      .gte("created_at", sinceIso);
    if (error) {
      if (missing9974(error)) {
        if (!warnedMissing) {
          warnedMissing = true;
          console.warn(
            "[collage-confirm] migration 9974 not applied — combined-photo texts are off until it's pasted",
          );
        }
        return { sent: 0, skipped: "migration 9974 not applied" };
      }
      throw error;
    }
    let sent = 0;
    for (const row of (data ?? []) as unknown as CandidateRow[]) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      const phone = row.users?.phone;
      if (!phone) continue; // email-only account — nowhere to text
      const photos = row.ad_photos ?? [];
      const photo0 = photos.find((p) => p.position === 0);
      // Only combined ads: a single-picture ad has a bare position-0 object.
      if (!photo0 || !isCollageSrc(photo0.src)) continue;
      // The quiet clock counts only collage-relevant rows (the collage itself
      // + its `parts/` inputs) — an approved emailed-in extra (bare src)
      // changes the website gallery, not the collage, and must not re-arm a
      // "here's your combined photo" text for an unchanged picture.
      const due = dueCollageConfirmation(
        {
          createdAt: row.created_at,
          collageNotifiedAt: row.collage_notified_at,
          photoCreatedAts: photos
            .filter((p) => p.position === 0 || isCombinePartSrc(p.src))
            .map((p) => p.created_at),
        },
        nowMs,
      );
      if (!due) continue;
      // Claim first (CAS on the exact stamp we read): a concurrent tick that
      // read the same candidate loses the update-count race and sends nothing.
      let claim = db()
        .from("ads")
        .update({ collage_notified_at: new Date(nowMs).toISOString() })
        .eq("id", row.id)
        .in("status", ["pending", "approved"]);
      claim =
        row.collage_notified_at === null
          ? claim.is("collage_notified_at", null)
          : claim.eq("collage_notified_at", row.collage_notified_at);
      const { data: claimed, error: claimError } = await claim.select("id");
      if (claimError) throw claimError;
      if (!claimed?.length) continue; // another tick got here first
      // How many source pictures the collage combines (`parts/` gallery rows).
      const pictureCount = photos.filter(
        (p) => p.position > 0 && isCombinePartSrc(p.src),
      ).length;
      try {
        const result = await dispatchSms(
          phone,
          collageConfirmationBody(row.id, deriveTitle(row.body), pictureCount),
          { cls: "pic", media: [photo0.src] },
        );
        // A suppressed send (pause/blocklist/throttle) stays claimed on
        // purpose: operator controls are deliberate, not retry fodder.
        if (result.sent) sent += 1;
      } catch (e) {
        // Claimed but not sent: deliberate at-most-once (no MMS retry storms).
        // The next picture the seller sends re-arms a fresh confirmation.
        console.error(`[collage-confirm] send failed for ad #${row.id}:`, e);
      }
    }
    return { sent };
  } catch (e) {
    console.error("[collage-confirm] run failed:", e instanceof Error ? e.message : String(e));
    return { sent: 0, skipped: "error (logged)" };
  }
}
