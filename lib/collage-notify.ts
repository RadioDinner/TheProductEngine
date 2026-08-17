/**
 * Combined-photo confirmation runner (FEATURES item 33): once a
 * multi-picture ad's pictures have settled — 10 quiet minutes since the last
 * one arrived — the seller is texted the finished collage, so they see
 * exactly the one picture buyers will get. Runs from the 5-minute cron, so
 * the text lands 10–15 minutes after the last picture. The decision math is
 * pure and unit-tested in lib/collage-confirm.ts.
 *
 * Mechanics (each hardened by the session-014 adversarial review):
 * - Candidates are pending/approved ads from the lookback window whose
 *   position-0 picture is a `collage/` object (single-picture ads never
 *   combined anything, so they get no text). The select is paged past
 *   PostgREST's ~1000-row cap, oldest ads first.
 * - The quiet clock is the newest collage-relevant ad_photos.created_at
 *   (migration 9974; falls back to the ad's own created_at).
 * - Sends are claimed by compare-and-set on ads.collage_notified_at BEFORE
 *   dispatch, so overlapping cron ticks can't double-send an MMS. The ad is
 *   then re-read: if the collage changed or a new picture landed since the
 *   candidate select (the seller is being coached to trickle pictures, so
 *   this race is real), the claim is CAS-restored and the send skipped — a
 *   later tick delivers the FRESH collage instead of a deleted object's URL.
 * - A send the outbound gate suppresses as paused/throttled is CAS-restored
 *   too (nothing was transmitted, so restoring cannot double-send): those
 *   controls are temporary, and the promised text must go out when they
 *   lift. A blocklisted number stays claimed (deliberate, permanent), and a
 *   THROWN dispatch stays claimed (the MMS may actually have gone out —
 *   at-most-once wins; the seller's next picture re-arms a fresh send).
 * - Claims (not successes) count against the per-tick cap, and a deadline
 *   bounds the run so a slow Telnyx can't eat the digest cron's budget.
 * - Pre-9974 the candidate select (or claim) fails on the missing column:
 *   degrade gracefully (warn once, send nothing) — never break the cron.
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

/** MMS-cost guardrail: the most CLAIMS one cron tick attempts. The rest stay
 * unclaimed and go out on following ticks. */
const MAX_CLAIMS_PER_RUN = 25;

/** Wall-clock budget for one run — the digest cron shares a 60 s function. */
const RUN_BUDGET_MS = 15_000;

/** PostgREST silently caps un-ranged selects at ~1000 rows — page past it. */
const PAGE = 1000;

interface PhotoRow {
  src: string;
  position: number;
  created_at: string | null;
}

interface CandidateRow {
  id: number;
  body: string;
  created_at: string;
  collage_notified_at: string | null;
  users: { phone: string | null } | null;
  ad_photos: PhotoRow[] | null;
}

/** The quiet clock counts only collage-relevant rows (the collage itself +
 * its `parts/` inputs) — an approved emailed-in extra (bare src) changes the
 * website gallery, not the collage, and must not re-arm a "here's your
 * combined photo" text for an unchanged picture. */
function collageClockTimes(photos: PhotoRow[]): (string | null)[] {
  return photos
    .filter((p) => p.position === 0 || isCombinePartSrc(p.src))
    .map((p) => p.created_at);
}

/** 42703 = missing column on SELECT; PGRST204 = missing column in an UPDATE
 * payload — both mean migration 9974 isn't pasted yet. */
function missing9974(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

let warnedMissing = false;

function warn9974Once(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    "[collage-confirm] migration 9974 not applied — combined-photo texts are off until it's pasted",
  );
}

/** Best-effort CAS undo of a claim nothing was sent for: put the previous
 * stamp back only if our claim stamp is still in place. */
async function restoreClaim(id: number, claimIso: string, prevIso: string | null): Promise<void> {
  const { error } = await db()
    .from("ads")
    .update({ collage_notified_at: prevIso })
    .eq("id", id)
    .eq("collage_notified_at", claimIso);
  if (error) console.error(`[collage-confirm] claim restore failed for ad #${id}:`, error.message);
}

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
    const deadlineMs = nowMs + RUN_BUDGET_MS;
    const claimIso = new Date(nowMs).toISOString();
    const sinceIso = new Date(nowMs - COLLAGE_CONFIRM_LOOKBACK_MS).toISOString();

    // Oldest first + paged: nobody starves behind a big backlog, and the
    // ~1000-row PostgREST cap can't silently hide candidates.
    const candidates: CandidateRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db()
        .from("ads")
        .select(
          "id, body, created_at, collage_notified_at, users!inner(phone), ad_photos(src, position, created_at)",
        )
        .in("status", ["pending", "approved"])
        .gte("created_at", sinceIso)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        if (missing9974(error)) {
          warn9974Once();
          return { sent: 0, skipped: "migration 9974 not applied" };
        }
        throw error;
      }
      const page = (data ?? []) as unknown as CandidateRow[];
      candidates.push(...page);
      if (page.length < PAGE) break;
    }

    let sent = 0;
    let claims = 0;
    for (const row of candidates) {
      if (claims >= MAX_CLAIMS_PER_RUN || Date.now() > deadlineMs) break;
      const phone = row.users?.phone;
      if (!phone) continue; // email-only account — nowhere to text
      const photos = row.ad_photos ?? [];
      const photo0 = photos.find((p) => p.position === 0);
      // Only combined ads: a single-picture ad has a bare position-0 object.
      if (!photo0 || !isCollageSrc(photo0.src)) continue;
      const due = dueCollageConfirmation(
        {
          createdAt: row.created_at,
          collageNotifiedAt: row.collage_notified_at,
          photoCreatedAts: collageClockTimes(photos),
        },
        nowMs,
      );
      if (!due) continue;

      // Claim first (CAS on the exact stamp we read): a concurrent tick that
      // read the same candidate loses the update-count race and sends nothing.
      let claim = db()
        .from("ads")
        .update({ collage_notified_at: claimIso })
        .eq("id", row.id)
        .in("status", ["pending", "approved"]);
      claim =
        row.collage_notified_at === null
          ? claim.is("collage_notified_at", null)
          : claim.eq("collage_notified_at", row.collage_notified_at);
      const { data: claimed, error: claimError } = await claim.select("id");
      if (claimError) {
        // A schema cache that went stale mid-run (or a mid-run paste) must
        // not spray "run failed" errors — same warn-once path as the select.
        if (missing9974(claimError)) {
          warn9974Once();
          return { sent, skipped: "migration 9974 not applied" };
        }
        throw claimError;
      }
      if (!claimed?.length) continue; // another tick got here first
      claims += 1;

      // Re-read after winning the claim: earlier sends in this loop take
      // real seconds, and a follow-up picture in that window REPLACES the
      // collage and deletes the old storage object — dispatching the stale
      // URL would send a broken MMS. If anything moved, restore the claim
      // and let a later tick send the fresh collage after its quiet period.
      const { data: fresh, error: freshError } = await db()
        .from("ads")
        .select("status, ad_photos(src, position, created_at)")
        .eq("id", row.id)
        .maybeSingle();
      if (freshError || !fresh) {
        if (freshError) {
          console.error(`[collage-confirm] re-read failed for ad #${row.id}:`, freshError.message);
        }
        await restoreClaim(row.id, claimIso, row.collage_notified_at);
        continue;
      }
      const freshPhotos = ((fresh.ad_photos ?? []) as unknown as PhotoRow[]);
      const freshPhoto0 = freshPhotos.find((p) => p.position === 0);
      const stillDue =
        (fresh.status === "pending" || fresh.status === "approved") &&
        freshPhoto0 &&
        freshPhoto0.src === photo0.src &&
        dueCollageConfirmation(
          {
            createdAt: row.created_at,
            collageNotifiedAt: row.collage_notified_at, // the PRE-claim stamp
            photoCreatedAts: collageClockTimes(freshPhotos),
          },
          nowMs,
        ) !== null;
      if (!stillDue) {
        await restoreClaim(row.id, claimIso, row.collage_notified_at);
        continue;
      }

      // How many source pictures the collage combines (`parts/` gallery rows).
      const pictureCount = freshPhotos.filter(
        (p) => p.position > 0 && isCombinePartSrc(p.src),
      ).length;
      try {
        const result = await dispatchSms(
          phone,
          collageConfirmationBody(row.id, deriveTitle(row.body), pictureCount),
          { cls: "pic", media: [freshPhoto0.src] },
        );
        if (result.sent) {
          sent += 1;
        } else if (result.reason === "paused" || result.reason === "throttled") {
          // Temporary operator controls — nothing was transmitted, so
          // restoring is double-send-safe and the text goes out when the
          // control lifts. A blocklisted number stays claimed (permanent).
          await restoreClaim(row.id, claimIso, row.collage_notified_at);
        }
      } catch (e) {
        // Claimed but errored: deliberate at-most-once (the request may have
        // reached Telnyx — no MMS retry storms). The next picture the seller
        // sends re-arms a fresh confirmation.
        console.error(`[collage-confirm] send failed for ad #${row.id}:`, e);
      }
    }
    return { sent };
  } catch (e) {
    console.error("[collage-confirm] run failed:", e instanceof Error ? e.message : String(e));
    return { sent: 0, skipped: "error (logged)" };
  }
}
