# Session 024 — the labelled SMS picture, kept (2026-08-21)

Branch `claude/ad-image-labeling-4r6d10`. Version **1.6.11 → 1.6.12** (§6: one
feature — item 53 — so the far-right digit moves).

## What the user asked for

> *"On the ads with pictures, I noticed that my system is not automatically
> labeling the 'text' image with the ad number. I had given instructions that
> told you to create a label on the FIRST picture that comes in on an ad with
> the ad number. For example, if I send in an image for an ad, get the ad
> number from the ad im posting and add it to the image. I want that same image
> to be on the 'ADS' page of the admin portal, so I can see what was or what
> will be sent out in the SMS."*

Two things, and they turned out to have the same root.

## What was actually wrong — read this before "fixing" it again

**The labeller was not broken.** `lib/ad-badge.ts` works; its unit test renders
a badge for real and probes the pixels, and it passes. What was wrong is that
**the labelled copy was thrown away.**

`storeBadgedPhoto` was called from `resolveBroadcastPictures` while a batch was
being composed, its URL went into the outbox rows, and then it was gone — never
written to the ad, never an `ad_photos` row, deliberately (so the website and
the review queue keep the clean original). Which meant:

1. **Nothing outside a subscriber's phone had ever seen it.** /admin/ads showed
   the clean original, because that is the only thing it had. The user's report
   is exactly right from where they were standing.
2. **A failed render was invisible.** Every failure path returns null and the
   batch broadcasts the UNBADGED original — correct behaviour (a picture with
   no number still sells the item; no picture does not) but silent. The only
   trace is a `console.error` in the function log.

⚠️ **And point 2 has teeth now in a way it didn't in session 018.** Session 016
removed collaging, so **`stampAdNumber` is the ONLY production code path left
that uses sharp.** A deploy that loses the native binding — which has happened
here once already (2026-08-19, Next 16 tracing dropped libvips) — would show up
as unlabelled pictures and *nothing else visibly wrong at all*. That is a
perfect match for the symptom reported, and it cannot be ruled out from the
code; it needs the live deployment. Hence the self-test below.

So the fix is one change with two halves: **make the label when the picture
arrives, keep it on the ad**, and **make a failure to make it something you can
see.**

## What shipped — item 53

**The label is made at INGEST, not at send.** `createAd`, `attachAdPhotos` and
an approved PIC-replacement each schedule `refreshAdBadge(id)` via
`afterResponse` — the ad has a number and a picture at that moment, which is
literally what the user described. Never awaited: a seller texting an ad is
waiting on the reply, and a fetch + sharp render + upload is seconds of it.

**It is kept.** Migration **9948** adds `ads.badged_photo` (the URL) and
`ads.badged_photo_src` (the picture it was rendered FROM).

⚠️ **The second column is the whole safety design, and it is a COMPARISON, not
a flag.** An ad's picture can be replaced after it was labelled (a follow-up
MMS onto a text ad, an admin-approved PIC replacement). A label made from the
old picture would then be a *confident lie* about what goes out — worse than no
label, because the operator has no way to see it. So nothing is trusted to
clear a flag when it mutates a photo: every reader compares
`badged_photo_src` against the ad's current first texted picture and treats a
mismatch as "not labelled yet". A writer that forgets costs one wasted
re-render, never a wrong picture. `lib/ad-badge-photo.ts` is that rule, pure and
unit-pinned (16 checks).

**/admin/ads shows it.** The thumbnail marked `texts` IS the labelled copy, and
it is shown **whole and larger** than the other thumbnails —
`.adcard-thumb--texted` uses `object-fit: contain` at 11rem, because the square
`cover` crop the other thumbnails use *cuts off the bottom-right corner*, which
is precisely where the ad number is. The one thing the preview exists to let
you check was the one thing being cropped away. Under the text: *"Text picture
is labelled AD 1040 — the thumbnail is the copy that goes out."*

**The send path still never depends on any of it.** `resolveBroadcastPictures`
uses a fresh stored label when there is one (so most batches now do no image
work at all), otherwise renders one on the spot AND records it — so an ad
posted before this shipped is labelled by the batch that carries it, and
/admin/ads afterwards shows exactly what went out.

### The two things that make a failure visible

- **`/admin/sms-diag` → "Picture-label self-test".** Renders a label for real on
  the live deployment and **counts the high-visibility-yellow pixels**. No ink =
  the renderer is broken and every broadcast picture is going out unlabelled.
  This is the button that answers the sharp/libvips question above; it is the
  only way to tell "the label failed" from "this ad never had a picture", and
  it works on the deploy rather than on a developer's machine.
- **A "Label the picture AD 1024 now" button** on any row without a fresh
  label. It either produces the picture or says why not — and its failure
  notice names the log string to search and points at the self-test.

`/api/health` probes 9948 by name like every other migration.

## Also fixed, in passing

`pictureRole` matched pictures by POSITION in the raw list. For a legacy
combined ad the raw position 0 is a collage — which has not been broadcast
since session 018 — so the `texts` badge was being put on the one picture that
*isn't* sent. It now matches by SRC against `textedAdPhotos`, which is what the
composer actually reads.

## Directional decisions

1. **Label at ingest, not at send.** The user's words describe ingest ("if I
   send in an image for an ad, get the ad number … and add it to the image"),
   and it is also what lets the admin page show the picture without doing image
   work in a page render.
2. **Store on `ads`, not `ad_photos`.** Mirrors `getAdsOwed` / `getAdDelivery`
   exactly: a lazily-read column pair with its own read, never in `AD_SELECT`.
3. **Staleness by comparison, never by a flag another writer must remember to
   clear.** See the warning above.
4. **A dev-mode ad is never labelled** — `refreshAdBadge` bails before doing any
   work when Supabase isn't configured, because there is no bucket to put the
   copy in. Same seam as every other storage feature here.
5. **The failure stays non-fatal.** An unlabellable picture still broadcasts, as
   the plain original. What changed is that it now SAYS so.

## ⚠️ Migration 9948 is waiting

`supabase/migrations/9948_ad_badged_photo.sql`. **It degrades gently** — unlike
9950. Unpasted, the label is still burned into every broadcast picture exactly
as before (rendered at send time, discarded); what you lose is the /admin/ads
preview and the saved re-render. Nothing sends wrong.

Next migration takes **9947**.

## Open / next

- **Paste 9948**, then look at a real picture ad on /admin/ads.
- **Run the picture-label self-test on the live deployment.** If it reports no
  ink or an exception, the ads the user saw were genuinely unlabelled and the
  cause is the image renderer on Vercel, not this code — that is the one
  hypothesis this session could not settle from the repo, and it is one click
  to settle from production.
- Ads posted before today have no stored label. They get one from the batch
  that carries them, or from the button. Nothing to backfill by hand.
- `sharp` is now load-bearing for exactly one feature and used nowhere else in
  production. Worth remembering when a Next/Vercel upgrade lands: if the badge
  quietly disappears again, that is the first place to look.
