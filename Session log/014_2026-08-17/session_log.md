# Session 014 — 2026-08-17

Branch: `claude/ad-photo-review-errors-a0t57t` for the feature work; the
user then merged it to main (PR #2) and said "commit directly to main for
the remainder of this session" — the Supabase log-noise fixes below went
straight to `main`.

## What shipped

- **`6df1e71` — Picture-set coaching + combined-photo confirmation
  (FEATURES item 33) + stored-photo checker.**
  - AD NEW that saves one picture now replies with the user's requested
    coaching: "Got your ad! … If you have more pictures, please send them
    one at a time - up to 4 total. If we don't hear from you within 10
    minutes, we'll assume this is the only picture." Multi-picture and
    follow-up confirmations state how many pictures fit ("You can send N
    more, one at a time") and promise the combined photo. Segment audit:
    every new reply stays GSM-encoded; the picture-ad confirmation goes
    1 → 2 segments (the requested copy simply doesn't fit in one).
  - Combined-photo confirmation: once a combined ad's pictures have been
    quiet for 10 minutes, the 5-minute cron texts the seller the finished
    collage as an MMS (`lib/collage-notify.ts`, via the outbound choke
    point, `pic` class, 25 sends/tick cap). Claims are CAS'd on
    `ads.collage_notified_at` before dispatch (at-most-once; overlapping
    cron ticks can't double-send); a picture arriving after a send makes
    the stamp stale and re-arms exactly one fresh confirmation. Emailed-in
    extras (bare storage paths) deliberately do NOT re-arm it — only
    collage-relevant rows (position 0 + `parts/`) drive the quiet clock.
    Pure decision math + seller copy in `lib/collage-confirm.ts`
    (dependency-free, unit-tested).
  - **⚠️ Migration `9974_collage_confirmation.sql`** (ads.collage_notified_at
    + ad_photos.created_at; re-runnable) — until pasted, the confirmation
    texts are silently off (cron warns once, digests unaffected);
    `/api/health` probes `migration9974`.
  - `/admin/sms-diag` gained **"Check a stored photo"**: paste one of our
    storage URLs and the server fetches it and verifies HTTP status, served
    headers against the actual bytes (content-type vs sniffed format,
    content-length vs received), JPEG start/end markers, and a full sharp
    decode — the verdict names the failing layer.

## The "image contains errors" investigation (user report)

Firefox said the review-queue collage
(`…/ad-photos/collage/aa1625d1-….jpg`) "cannot be displayed because it
contains errors" (message only copyable via inspect-element — that's
Firefox rendering the error as the broken image's alt text).

- **Could not fetch the live object from this session**: the environment's
  egress policy blocks `*.supabase.co` (proxy CONNECT 403; the remote
  runner and WebFetch are blocked the same way).
- **Code-level audit came back clean**: the collage buffer is re-sniffed
  before upload (it only lands at `collage/….jpg` if the bytes really start
  with the JPEG signature), the upload sends the raw buffer with
  `content-type: image/jpeg` derived from those same bytes (supabase-js
  passes a Buffer through untouched — verified against the installed
  storage-js source), and `combineImageBuffers` locally produces a clean
  baseline JPEG (SOI/EOI verified, full decode OK).
- **Verdict**: corruption in our pipeline is effectively ruled out; the
  likeliest causes are a truncated/cached download in that browser (fix:
  hard refresh / another browser) or a Supabase serving-layer hiccup. The
  new sms-diag checker gives a definitive one-click answer from the
  deployed environment — ask for its verdict on that URL next session.

## Directional decisions

- **The 24 h pending-ad attach window stays** (session-013 behavior). The
  new "10 minutes" copy is when the set is *announced complete* (and the
  combined photo texted), not when attaching closes: a late picture on a
  still-pending ad still attaches and earns one fresh combined-photo text.
  Flagged to the user in the wrap-up; tightening the window to 10 minutes
  is a one-constant change if they want the literal behavior.
- Confirmation MMS is at-most-once by design (claim before send; a send
  failure after a claim is logged, not retried) — no MMS retry storms.
- Suppressed sends (PAUSE/blocklist/under-attack) stay claimed on purpose:
  operator controls are deliberate, not retry fodder.

## Verification

- Unit suite 464 → **476** (new `test/collage-confirm.test.mjs`: quiet
  window, re-arm, boundary, junk-timestamp, copy checks).
- Abuse suite 19/19; `tsc --noEmit` clean; `next build` clean.
- Adversarial review workflow (3 lenses × find → refute) run over the diff
  before push — outcome recorded below.

## Part 2: Supabase error-log triage (user screenshot + CSV)

The dashboard showed 26 Postgres errors/hour. Three families, none of which
broke anything — but one exposed real migration drift:

1. **`digests_channel_county_scheduled_for_key` 23505, twice every 5 min** —
   `createDigestIfAbsent` used insert-then-catch-23505 as its idempotency
   check, so every cron tick logged two handled "errors" (sms + email
   channel). Digests were composing and sending normally the whole time.
   Fixed: select-first, unique constraint kept as the race guard.
2. **`column chat_messages.photo does not exist` 42703 (sporadic)** — the
   chat pages' graceful retry-without-photo firing. Root cause: **migration
   9980 drift** — pasted mid-session-009, then amended later that session;
   prod has reported_at but not photo/the current send_chat. Chat pictures
   + reporting silently off. USER ACTION: re-paste 9980 (re-runnable). The
   health probe now checks reported_at AND photo so single-column probes
   can't vouch for an amended file again.
3. **`buckets_pkey` 23505 (per cold start)** — ensureBucket create-on-exists;
   fixed with a getBucket probe first.

## Part 3: the collage corruption ROOT-CAUSED and fixed

The user ran the new sms-diag checker on the failing collage: bytes at rest
start `efbfbd efbfbd…` — the UTF-8 REPLACEMENT CHARACTER, repeated. The
stored file is the JPEG after a lossy binary→string→UTF-8 round trip. That
plus the checker's clean serve headers pinned the layer: the upload
transport, in production only.

Reproduction matrix (all with the prod-pinned versions — storage-js
2.110.0, sharp 0.35.3): plain Node upload of a sharp buffer → intact;
inside a `next dev` route handler → intact; inside a production
`next build`+`next start` route handler → intact. Conclusion: not
storage-js, not undici, not Next — it's **Vercel's function runtime**,
matching a known bug class (Vercel community: "Node Buffer body re-encoded
as UTF-8 on Vercel functions — high bytes become EF BF BD"). Why singles
worked in July but the collage broke now: unknowable from outside Vercel
(their runtime updates independently of deploys); the fix below doesn't
depend on knowing.

**Fix (both layers in `storeImageBytes`, the single upload choke point for
every image the app stores):**
1. Upload body is now an exact **ArrayBuffer copy**, never a Node Buffer —
   a plain BufferSource with no Node-specific type for an instrumentation
   layer to string-coerce.
2. **Read-back verification**: after every upload, download the object and
   compare byte-for-byte. On mismatch: delete the corrupt object, log the
   hex signatures, return a clean failure — the callers' existing fallbacks
   (post as text + tell the seller / first-picture-as-photo) take over. No
   corrupt photo can ever ship silently again, whatever the transport does.

Proven end-to-end against the REAL function with a fake storage server:
honest server → ok + verified; server simulating the exact Vercel mangle →
"readback mismatch" failure + corrupt object deleted (observed the DELETE).

**Existing damage:** the corrupt collage(s) in prod storage stay corrupt
until rebuilt. After this deploys: any new picture texted to a pending ad
rebuilds its collage through the fixed pipeline; ad #1015 (test ad) can be
fixed by texting one more picture, or delete + repost. Whether `parts/` and
recent bare singles are also corrupt is checkable with the sms-diag
checker (if the runtime mangles all Buffer bodies, everything uploaded
since the runtime change is bad — worth spot-checking one of each).

## Part 4: scrapbook-style collage rework (user request, competitor examples)

The user shared five competitor collages (2/3/4 pictures) and reported the
real pain: the cover-cropped grid cuts off important detail, especially at
3 pictures. Reworked `lib/photo-collage.ts` to the competitor's style:

- **Nothing is ever cropped or stretched.** Each picture keeps its full
  frame and native aspect ratio (EXIF-rotated first), scaled to FIT a
  generous corner-anchored region.
- **Portrait 4:5 white page (1200×1500) for every count** — pictures land
  staggered (diagonal two-up, TL/right-tall/BL three-up, loose 2×2
  four-up), typical photos overlap slightly, later pictures on top, white
  ground showing through.
- New pure `collagePlacements()` drives both the composer and the tests;
  `collageDimensions()` now always returns the fixed page (call sites
  unchanged). Sample renders (2/3/4-up) were generated with the real code
  and sent to the user in chat for approval of the look.
- Test suite rewritten around the new invariants (aspect preserved,
  on-page, visible probe point per picture, white shows through, EXIF
  before placement, panorama fits): photo-collage 20 → 65 checks; total
  suite 476 → **521**.
- Composed sizes are modest (sample 2-up 27 KB … 4-up 37 KB; real photos
  a few hundred KB at q80 — comfortably under carrier MMS limits).

Deliberate choices: send order = placement order (slot 2 is the tall one
in a 3-up — no orientation-based reshuffling, so replies' "picture N"
numbering always matches); overlap is emergent from region sizes, not
random, so composes are deterministic and testable.

## Part 5: website shows the full originals, not the collage (user request)

"I want the full size, non collage images to be the images on the ads when
they're shown on the website." Done display-only: new pure
`websiteAdPhotos()` in `lib/photo-collage.ts` (unit-tested) filters a
position-0 collage out in favor of its `parts/` originals (send order,
emailed extras after; a collage with no surviving originals stays; singles
untouched). Applied in BOTH site-ad mappers — `toAd` (ads-supabase, prod)
and `toSiteAd` (engine-store file store, dev parity) — so ad pages, list
cards, and og:image all show the first original + the rest as the gallery.
NOTHING else changes: the collage still exists at ad_photos position 0 and
still serves PIC MMS, the seller's combined-photo confirmation, the email
digest embed, and the admin review queue (what the operator approves is
what PIC sends). The storage-marker helpers (isCollageSrc /
isCombinePartSrc, bucket constant) moved to pure photo-collage.ts,
re-exported from photos.ts for existing call sites. Suite 521 → **529**.

## Open questions / next steps

1. **USER: paste migration 9974**, then check `/api/health` →
   `migration9974: {applied: true}`.
2. **USER: after the deploy, open `/admin/sms-diag` → "Check a stored
   photo" and paste the failing collage URL** — the verdict line settles
   the "contains errors" mystery. (Also worth a plain Chrome try of the
   URL.)
3. Send a real 2-picture ad end-to-end in prod: expect the coaching reply,
   then the combined-photo MMS 10–15 min after the last picture.
4. Carried backlog: session-013 operator queue (Stripe prod config is
   still the launch blocker) + code backlog in HANDOFF.

## Review workflow outcome

3 lenses × find → adversarial refute (21 agents); 16 confirmed findings
deduping to 8 real fixes, ALL FIXED in the follow-up commit:

1. **Claim-then-suppressed lost the promised text forever** (high): a
   PAUSE/under-attack-throttle during a tick claimed every due ad and sent
   nothing, permanently. Fix: paused/throttled sends CAS-restore the claim
   (nothing was transmitted → double-send-safe) so the text goes out when
   the control lifts; blocklisted numbers and thrown dispatches stay
   claimed (deliberate / may-have-sent).
2. **Claims now count against the 25/tick cap** (was successes-only, so a
   failing tick could walk the whole backlog).
3. **Stale-src race**: a follow-up picture between the candidate select and
   the dispatch replaces + deletes the old collage → the MMS carried a dead
   URL. Fix: re-read the ad after winning the claim; if the src changed or
   dueness lapsed, restore the claim and skip (a later tick sends the fresh
   collage).
4. **attachAdPhotos ordering**: parts rows now insert BEFORE the position-0
   collage update, so a cron tick can never see a fresh collage whose
   quiet-clock rows don't exist yet (premature + duplicate MMS).
5. **Candidate select paged** past PostgREST's ~1000-row cap (oldest
   first); claim errors from a stale schema cache route through the
   warn-once degrade path instead of error spam.
6. **Lookback 24 h → 25 h**: an equal lookback silently dropped sets that
   finished in the attach window's final minutes.
7. **Telnyx transport got a 10 s AbortSignal timeout** (lib/sms.ts) — one
   hung fetch can no longer eat the 60 s cron/webhook budget (benefits
   every SMS/MMS send, not just this feature).
8. **sms-diag checker honesty**: dropped the JPEG end-marker "truncated"
   probe (healthy phone JPEGs routinely carry trailing bytes — Samsung
   motion-photo trailers etc.); decode uses failOn "error" (browser-like
   tolerance) + the 64 MP input cap. Also: a `parts/` object promoted to
   position 0 by a compose fallback now keeps a gallery row when a later
   collage replaces it (no orphaned picture, correct picture count).

Post-fix: unit 476/476, abuse 19/19, tsc + build clean.
