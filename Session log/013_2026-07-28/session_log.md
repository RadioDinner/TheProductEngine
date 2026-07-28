# Session 013 — 2026-07-28

Two asks: (1) build the multi-picture auto-combine ("I texted numerous
pictures to the number and it didn't auto combine them into a single image"
— the session-011 idea, now a real gap the user hit), merged to main; and
(2) a pre-launch evaluation — "are there any holes in our system?" — with
the operator confirming all migrations are pasted and 10DLC registration is
complete.

## What shipped

- `c5a69c0` **Multi-picture combine (FEATURES item 32)** — committed on
  `claude/multi-image-combine-launch-review-8dbe4r`, fast-forwarded onto
  `main` (per the user's "Merge to main for this session"). Main already
  contained session 012's pay-by-phone commit (the user had merged it), so
  the fast-forward was clean.

### How the feature works

- **One MMS carrying 2–4 pictures:** each attachment is byte-validated
  (existing sniff policy) and re-hosted individually into the new `parts/`
  storage folder (website gallery, ad_photos positions 1+), then composed
  into a single collage JPEG in `collage/` at position 0 — the one picture
  MMS/PIC/digests carry. Layouts: 2 side-by-side squares; 3 = one wide on
  top + two below; 4 = 2×2 grid; 8px white gutters; EXIF orientation
  honored; 1200px wide, baseline JPEG q80 (old handsets + carrier size
  limits). A 5th+ attachment is dropped and the confirmation says so.
- **Pictures trickled across messages** (the likely real-world failure the
  user hit — phones often send "AD NEW …" and each photo as separate
  messages): a photo-only MMS from a sender with a PENDING ad younger than
  24 h attaches to that ad and the collage is rebuilt up to the 4-picture
  cap. Approved ads never change silently (pending-only by design). No
  pending ad → the old how-to-post guidance (now pluralized); strangers
  still mint no account.
- **Pricing unchanged and fair:** a combined ad is ONE picture ad
  (costPhoto). A photo landing on a TEXT ad upgrades it and charges exactly
  costPhoto − costText — waived when a free ad pass paid for the ad (a pass
  always covered either kind), never double-charged on retries (ledger-note
  idempotency), refunded if the attach fails after charging, and refused
  with the exact shortfall when credits are insufficient.
- **No migration.** Provenance lives in storage paths (`collage/`,
  `parts/`, bare = single photo or emailed-in extra), so the schema is
  untouched and emailed-in extras (item 1) never join the collage.
  Compose/storage failures degrade to first-picture-as-photo with the rest
  in the gallery — a photo problem never blocks an ad (session-007 policy).
- **New dependency: `sharp`** (the standard Node/Vercel image library) does
  the decode/resize/compose. First real dependency added since launch prep;
  chosen over hand-rolled JPEG work and over any external AI service (the
  session-011 question "is there an AI service that can do this for free?"
  — answer: not needed, it's deterministic image compositing, done locally
  for $0).

### Where the code lives

- `lib/photo-collage.ts` (new) — pure layout + sharp composition
  (`combineImageBuffers`, `collageDimensions`, `MAX_COMBINED_PHOTOS = 4`).
- `lib/photos.ts` — `fetchImageBytes` (extracted fetch guardrails),
  `storeImageBytes(bytes, folder?)`, `ingestInboundPhotos` (the multi-photo
  ingest: validate → parts → collage → fallbacks), `isCollageSrc` /
  `isCombinePartSrc` markers.
- `lib/engine-store.ts` + `lib/engine-store-supabase.ts` —
  `latestPendingAdFor`, `attachAdPhotos` (position-0 replace + gallery
  append, row-first so a crash never leaves a broken image; returns the old
  src so the engine can delete a replaced collage object), `createAd` now
  takes `morePhotos`.
- `lib/engine.ts` — `handleAdSubmission` ingests all attachments;
  `handlePhotoFollowup` (attach + upgrade charge + recompose); the bare-
  photo route tries attach before guidance.
- Docs: FEATURES.md item 32 (+ detail note), /admin/help section
  ("Several pictures on one ad").

### Verification

- Unit suite 428 → **448** (`test/photo-collage.test.mjs`: dimensions per
  layout, JPEG magic, per-cell color placement probes, white gutter, 5th-
  image clamp, EXIF input, garbage-bytes throw; runner now awaits async
  suites).
- 17/17 dev engine walk (temp script, deleted per convention): multi-photo
  AD NEW, follow-up attach, 4-cap, pass-paid upgrade waived, credit upgrade
  charged exactly 8 (10−2 defaults), no double charge, shortfall refused +
  nothing charged, stranger guidance + no account, plural guidance.
- Abuse suite 19/19; `tsc` clean; `next build` clean.

## Pre-launch audit

Run as a 8-dimension adversarial workflow (find → verify): schema parity,
money paths, SMS compliance + cost control, ops/launch checklist truth,
security surfaces, digest pipeline, an adversarial review of the new
combine code, and backlog reconciliation. **Findings are summarized in
HANDOFF.md (Session 013 section) and were reported in chat** — that's the
authoritative copy of the audit outcome for future sessions.

## Directional decisions

- Multi-picture combine ships with a 4-picture cap (the user's own number
  from session 011), pending-ads-only follow-up attach, and the
  upgrade-charge policy above — all inferred from standing product rules
  (one paid picture per ad; free pass covers either kind). Flag for the
  user: if they'd rather follow-up photos NEVER charge (or attach to
  approved ads too), both are small policy switches in
  `handlePhotoFollowup`.
- `sharp` accepted as a dependency (deterministic, local, free; no external
  service).

## Open questions / next step

- The audit's confirmed holes (see HANDOFF) are the next work order.
- Field-test the combine on the user's real phone: text AD NEW + several
  pictures in one MMS, then trickle one more picture as its own message;
  confirm the collage in review, on PIC, and on the site gallery.
- Prod deploy note: Vercel will `npm install` sharp automatically — nothing
  to do, but the first deploy after this merge is the one to watch.
