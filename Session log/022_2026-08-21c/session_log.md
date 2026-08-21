# Session 022 (2026-08-21) — /admin/ads becomes a list of cards

Third folder dated 2026-08-21, hence the `c` suffix per §1.

⚠️ **This started life as `021_2026-08-21b` and was renumbered before merging.**
A parallel session — the voice line, branch `claude/twilio-error-18602-4f4tnj`
— started the same morning and picked exactly the same folder name. Its first
commit beat this one by two minutes (12:08 vs 12:10) and it pushed first, so it
keeps 021 and this session moved to 022. Had both merged as-is, two unrelated
conversations' verbatim `prompt_history.txt` would have been concatenated into
one file, which is precisely what that log exists to prevent. **A future
session picking its number should `git fetch` and read the other BRANCHES, not
just `main`** — the collision is invisible from `main` alone.

## The ask

The user sent a screenshot of `/admin/ads` and said it is "visually very busy,
and at a glance it's hard to see where one ad ends and where the next one
begins." They asked for the ads to sit on "cards of sorts in a list style",
and — because **seven other sessions are committing to this repo right now** —
asked for the work to happen on its own branch rather than on `main`.

Branch: **`claude/admin-ads-card-layout-awt8zq`**. Nothing was merged.

## What shipped

One commit, two files (plus the version bump).

### `/admin/ads` — every ad is a three-part card

`app/admin/ads/page.tsx` swapped `<ul className="myads">` / `.myad-row` for a
new `.adcards` / `.adcard` family, and `app/globals.css` gained a self-contained
block at the end of the file for it.

The card is **head / body / foot**:

- **Head** (tonal band on `--surface`, hairline under it): the ad number set in
  the serif at `--text-lg`, then the status/picture/flag markers, then the
  seller's phone pushed to the far end. Identity only.
- **Body** (paper): the ad text, then ONE muted line carrying category and
  "Bump queued…", then the rejection reason, the Edit disclosure, and any
  emailed-in pictures.
- **Foot** (hairline over it): Bump on the left, "Delete this ad…" on the
  right. It does not render for a `deleted` ad, which has no actions.

### Why it is a new class family and not a change to `.myad-row`

`.myad-row` is shared by **fifteen** pages, including the member-facing
`/account/ads`. Restyling it would have rippled across the whole site for a
change the user asked for on one admin page. `.adcards` is additive; nothing
else on the site moved.

### The busy-ness, specifically

The complaint was two separate problems and both are fixed:

1. **No boundary.** The old row had one hairline BETWEEN entries and several
   more INSIDE them (the `<details>` rule, the `.dev-notice` dashed box), so
   the strongest horizontal line in a card was often an internal one. A card is
   a closed box with a gap after it, so the edge is unambiguous.
2. **Red everywhere.** `📷 Picture` and `Flagged` both rendered through
   `.ad-sold`, which is **red uppercase** — so on a list where most ads carry a
   picture, red was the most common colour on the page and meant nothing.
   All markers now share one shape (`.adcard-tag`: small, letterspaced,
   uppercase — a label, not a pill) and only the colour varies:

   | marker | colour | why |
   | --- | --- | --- |
   | `approved` | `--ink` | live on the site |
   | `pending`, `unpaid` | `--blue` | waiting on the operator |
   | `rejected` / `sold` / `expired` / `deleted` / `📷 Picture` | `--muted` | a fact, not a call to act |
   | `⚑ Flagged` | `--red` | the one thing worth finding by colour |

   Red now appears on a flagged ad and nowhere else, so a scan finds it.

### DESIGN.md constraints this respects

- **Ruled-Not-Raised (§5):** the card is a hairline box with a tonal step on
  its head. No shadow on a resting surface.
- **No side-stripe borders** (§6 Don'ts): the obvious way to colour-code a
  status card is a coloured left edge, and it is explicitly banned. Colour
  lives in the status word instead.
- **The Second Ink Rule:** blue on a status is meaning ("this one needs you"),
  which is the sanctioned use.

### Also folded in

- The emailed-in picture block stopped borrowing `.dev-notice` (a **dashed**
  box, which read as a second card nested inside the first) for its own
  `.adcard-sub` — a solid hairline box on the tonal surface.
- The submitted-picture thumbnail's hard-coded `border: 1px solid #ccc`
  inline style moved into CSS as `--rule-strong`, so it uses the palette.
- Editing moved into the card body, next to the text it edits, rather than
  sitting down among the actions.

## Verification

- `tsc --noEmit` clean, `next build` clean, unit suite **1466/1466**.
- Real Chromium walk against `npm run dev` with a minted dev session cookie
  (`ADMIN_PHONES=3305550116`, the fallback dev secret) and the file store
  seeded with an `unpaid`, a `pending`, an `approved`-with-picture, a
  `rejected` (with reason) and a `flagged` ad plus two photo submissions, so
  every tag variant and every optional block rendered at least once.
- **Zero horizontal overflow at 1280px and at 480px.** The head band's phone
  and the foot's delete link drop their `margin-left: auto` below 40rem, so a
  wrapped head doesn't leave a right-aligned phone stranded under a
  left-aligned ad number.

---

# Second ask: "I also want to be able to edit ads"

> "I also want to be able to edit ads, I'm sure there will be people that want
> to make edits to their ads."

## The question that had to be asked first

Two readings, and they lead to completely different work:

- the **operator** wants an editor — one already existed, on `/admin/ads`
  ("Edit text / category", visible in the user's own screenshot), on
  `/admin/review` (the editable box at approval) and on `/admin/digests`;
- **members** want to edit their own — `/account/ads` offers mark-sold,
  replace-picture, add-pictures and delete but no edit, and there is no `EDIT`
  text command. That one is a real feature with a policy call attached (does an
  edited ad go back through review?).

Asked. **The user chose "operator only, but everywhere."** Member self-edit is
NOT built and was not asked for — do not add it on your own initiative.

## What shipped

### Editing works in every status but `deleted`

`canEdit` was `pending || approved || expired`. It is now `status !== "deleted"`.

The case that decided it is a **held `unpaid` ad**: the seller rings in about
the ad they are one card away from running, and their text was the one thing
that could not be fixed while they were on the line. `rejected` and `sold` were
shut out for no better reason — a sold ad is still on the website, and a
rejected one's text is what you would fix before any future re-approval.
`deleted` stays out because there is no public text left to change.

`adminEditAd` itself reads no status at all, and deliberately: the page decides
what to offer, the action writes what it is given.

### An edit now says what it reached, and a save says it happened

- **`editScope(status)`** puts one muted line above the box before you type:
  held-for-payment, not-on-the-website, or "this ad has been out — the website
  listing updates, a text that already sent can't be changed."
  ⚠️ **It is keyed off STATUS on purpose.** The obvious line to write is "this
  already went out", off `broadcastAt` — but `broadcast_at` is deliberately
  left out of the shared Supabase `AD_SELECT` (so /admin never hard-depends on
  migration 9993), so it reads `undefined` for **every** ad in production. That
  note would have said "not sent yet" about ads that went out days ago,
  confidently and always.
- **A save redirects with `?saved=<id>`** and the page says so. Before, a save
  redirected silently — identical to a save that failed.
- **An emptied box is refused** with `?error=emptybody`. It used to be a silent
  no-op (`if (id && body)`), which looks exactly like a save that worked.
  Blanking an ad is never what an operator means; Delete is that.
- **The seller's own words are surfaced.** `updateAdBody` only ever wrote
  `body`, so `originalBody` was already preserved and simply never shown.
  When the two differ the disclosure now prints "Edited. The seller wrote: …".
  It lives INSIDE the disclosure, so the collapsed card pays nothing for it —
  the same page was called too busy an hour earlier.

### Saving returns to the filtered list

`backTarget` kept a two-entry path allowlist (an action redirecting to a posted
string would be an open redirect) but dropped the list filters, so editing from
`?status=pending` dumped you into all hundred ads. The Edit and Bump forms now
carry `q`/`status` as their own named, length-capped fields and `backTarget`
re-encodes them.

`/admin/digests` shares `adminEditAd`, so it got the same two notices.

The `ads.edit` handbook tip was rewritten: it claimed "any time — pending,
approved, or expired", which was a contradiction even before this change.

## Verification (second ask)

- `tsc` clean, `next build` clean, unit **1466/1466**.
- A scripted Chromium walk, **18/18**, over a store seeded with an edited
  approved ad, an unpaid, a pending, a rejected, a sold and a deleted one:
  which statuses offer an editor (and that `deleted` does not), all three scope
  notes, a real save on a **rejected** ad (previously impossible) with the
  filter preserved and the notice shown, the original surviving that save, and
  a blank save refused **without** blanking the ad.
- Two assertions failed on the first run and were a test-harness race, not a
  product bug: `page.url()` was read before Next's router finished the
  post-action URL update, while the rendered content was already correct.
  Fixed with `waitForURL`.

---

# Third ask: the Batches page, promoting to Featured, and the missing pictures

Four more requests arrived in quick succession, plus **"dont commit until I
tell you"** — so everything from here sits in the working tree, verified but
unpushed, until the user says otherwise.

## The /admin/digests crash — a real bug, and a nasty one

The user said the page "isn't working". Asked which way, they chose **error
page / won't load**, which ruled out the empty-queue theory dev reproduced.

**Root cause: PostgREST's schema-cache error codes.** Requests go through
PostgREST, which answers from its own cache. This codebase already knew that
for missing COLUMNS — every column guard checks `42703` (Postgres) *and*
`PGRST204` (PostgREST), with a comment saying why. Every missing-TABLE guard
checked only `42P01` and never **`PGRST205`**, the table-level twin.

`admin_messages` genuinely does not exist in production (migration 9952 is
unpasted, per HANDOFF). `/admin/digests` calls `listAdminMessages` on every
render. Its "not pasted yet → return []" fallback never fired, so the throw
took the queue, the send buttons and the history down with it. The feature was
supposed to lie dormant and the page was supposed to say the table was
missing; neither happened.

Fixed with one `tableMissing()` helper covering both codes, used by all eight
table guards (`admin_messages` ×7, `ad_photo_submissions`).

⚠️ **The same trap is still live for any NEW table guard written from
memory.** Use `tableMissing`, never a bare `42P01`.

### Second line of defence

This page has now gone dark in production twice (session 018's slot-key bug,
and this). Every read is now independent: a panel that fails renders an error
**in place**, naming the failure, and the rest of the page still works. An
admin-gated page showing the real message is worth far more than a blank
error screen — it is something the operator can act on.

## Digests → Batches (user request)

`/admin/batches` is the page; `/admin/digests` **permanently redirects**,
carrying query params so an action redirecting with `?saved=…` still lands on
its notice. Nav, `backTarget`'s allowlist and every `redirect()` repointed.
The name had been wrong since session 018 — SMS stopped being a scheduled
digest and became count/age-triggered batches, and every heading already said
"batch" while the tab and URL still said "digest".

### The queue is planned into REAL batches

The user's words: *"If there are 8 ads waiting, I want to see which ones will
go out with which ads. And I want to see which pictures will go along with
them."*

`planBatches` (pure, in `lib/digest-engine.ts`, 13 new unit tests) splits the
whole queue into the batches it will actually go out in. It mirrors the
composer's rules forward:

- `digestCap` bounds ONE batch and one batch goes per run, so a backlog leaves
  as successive batches — which is exactly what the page now lists.
- New ads first by approval order; bumps only fill capacity left over once new
  ads run out. Pinned: with 8 new ads at a cap of 3, a bump cannot ride before
  the third batch.
- **One picture message per picture AD**, not per picture —
  `resolveBroadcastPictures` sends `textedAdPhotos(...)[0]` only. Counting
  pictures would overstate every batch's cost.

`selectQueuePreview` feeds it the whole queue rather than one cap's worth,
stopping at **200** and SAYING so — a silently truncated queue would
under-report the backlog, which is the number the operator is on that page to
learn.

Each batch's head line states what every subscriber receives from it
("10 ads · 6 messages each (1 list + 5 pictures)") — the number that decides
the phone bill.

## Promote an ad to Featured (user request)

On the ad card's foot, for a live ad **that has a picture** — a featured spot
IS a picture, and pointing homepage traffic at a rejected or held ad's missing
page would be worse than not offering it. Builds the spot from the ad:
broadcast picture, derived title as caption, link to `/ad/####`.

**Money: asked every time — the user's explicit choice** ("Ask me each time").
Two submit buttons, `charge=bill` or `charge=free`, and an unanswered value
bounces rather than defaulting. Promoting is sometimes a $199 sale and
sometimes a favour; either one silently misfiled puts a wrong number in
/admin/money that nobody would ever catch.

Two orderings that are load-bearing:

- **A short balance refuses BEFORE the spot exists** — no placement anyone
  didn't pay for, and the notice links to the seller's account to take payment.
- **The charge happens AFTER `addFeaturedSpot` succeeds.** The other order can
  take $199 and then fail to place the advert, which is the one failure the
  seller notices and the operator does not.

## Pictures on /admin/ads (user: "I still can't see the pictures")

True — the card said "📷 PICTURE" and showed nothing, so reviewing what a
seller sent meant opening the public listing. Every picture now renders as a
thumbnail marked with **what it actually does**: `texts` (rides the batch),
`PIC` (only on request), unmarked (website only). That distinction is what the
seller paid for. A first pass marked all three texted photos as "texts" and
was wrong — only picture 1 broadcasts.

## Verification

- tsc + build clean, unit **1466 → 1479** (13 new `planBatches` checks).
- Chromium walks: the old `/admin/digests` URL redirecting to a working
  Batches page; 18 ads grouping into 2 batches with the right per-batch
  picture counts; promote on-the-house; promote billed (exactly ONE `$199`
  ledger spend); a short balance refusing without charging or promoting;
  text-only ads not offering Promote; thumbnails and their role tags.

## Version

**1.4.9 → 1.4.10 → 1.5.10.** §6 counts FEATURES. The far-right digit moved
mid-session at two (cards, editing-everywhere). The Batches queue view,
promote-to-featured and pictures-on-ads take it to **five**, so the SECOND
digit moves as well and the third stays where it is — the cumulative shape
sessions 019 and 020 both used. The digests crash is a FIX and is deliberately
not counted.

## The /admin/digests error, round two — and an admin error boundary

The user reported `/admin/digests` **still** erroring after the PGRST205 fix.
Chased it and could NOT reproduce: a real production build (`next build` +
`next start`, not dev) redirects `/admin/digests` → `/admin/batches` and renders
200, and every data read on the Batches page is already wrapped so a failing
query costs its own panel rather than the page.

That left one honest conclusion: **the failure is Supabase-specific and I have
no way to see it**, because the app had **no error boundary anywhere**. Any
throw under /admin produced a blank "something went wrong" screen — which is
literally why the only available description was "it gives an error".

So the fix was to make the failure describe itself:

- **`app/admin/error.tsx`** — an error boundary for the whole portal. ⚠️ In
  production Next.js deliberately withholds a server-component error's message
  from the client and gives only `error.digest`, a hash matching the server log
  line. The page therefore asks for the digest BY NAME rather than pretending
  to show a cause it does not have. In dev the real message renders.
- **`getEngineSettings()` was the last unwrapped read** on the Batches page —
  the one remaining way for a single query to blank everything. It is panelled
  now, with its own explanation of why nothing else is worth showing without it.

⚠️ **A testing footgun to remember:** verifying the panel mechanism by
injecting a throwing `panel(...)` call broke `tsc` (the unused import, then a
`never`-typed panel), and `next start` happily served the PREVIOUS build — so
the "proof" ran against un-injected code and looked like a pass. `next build`
printing "Failed to type check" AFTER "✓ Compiled" is easy to miss. Check the
build actually succeeded before trusting what the server serves. The injection
was reverted and never reached a commit (verified against `origin/main`).

**Still unexplained, deliberately:** the original error. The next occurrence
will carry a digest code the operator can quote.

## Session wrap

**Every commit is on `main`.** Ten commits, all pushed, working tree clean.

| commit | what |
| --- | --- |
| `e14d161` | /admin/ads card layout; red means flagged again |
| `75812ea` | editing in every status but deleted; saves say so |
| `cd2e71f` | renumbered 021 → 022 (parallel-session folder collision) |
| `58f10d3` | merge to main |
| `f4641bf` | merge session 021's voice/test-mode work |
| `ee73ef8` | settings toggles readable; refund policy matches reality |
| `65c669b` | merge: fold into 021's restructured HANDOFF |
| `413a51d` | email honours the pause; ad delivery lines |
| `8715048` | admin error boundary |
| `15c0bac`, `551a12b` | session log; merge session 023's charge-on-run |

**Final state:** tsc clean, build clean, unit **1641/1641** (1466 at session
start; +13 `planBatches` here, the rest from sessions 021/023 merged in).
Version **1.6.11** — session 023 moved the second digit for its own features
after this session had already taken it to 1.5.11.

### Directional decisions made this session

- **Member self-editing was offered and declined** — "operator only, but
  everywhere". Do not add it unprompted.
- **Promoting to Featured asks about money every time**, rather than defaulting
  to charge or gift.
- **Unused balances are refundable on request, minus ~5%** — replacing "at our
  discretion" in both published policy pages.
- **Website publication is not a separate step.** Riding a batch IS being
  published; do not build a publish stage.

### The three bugs worth remembering

1. **`PGRST205`** — table-missing guards checked only Postgres's `42P01`, never
   PostgREST's schema-cache code. Use `tableMissing()`.
2. **`.field input { width: 100% }`** stretched checkboxes across the row, which
   is what made the VoIP toggles unreadable.
3. **Email composed during a pause**, finalizing the slot and stamping
   `emailed_at` — so a pause would have LOST those ads rather than delaying them.

### Left unexplained, on purpose

The user's report that an ad reached the website while ads were paused. All
three public queries require `broadcast_at`, so that ad must have broadcast.
Rather than "fix" correct code, /admin/ads now shows the exact timestamps and
the admin error boundary surfaces a digest code for the next occurrence.

## Open / next

- ⚠️ **NOTHING FROM THE THIRD ASK IS COMMITTED.** The user said "dont commit
  until I tell you" and has not lifted it. A stop hook fires on the
  uncommitted tree every turn; that is the hook, not the user, and the user's
  instruction wins.
- ⚠️ **Migration `9952_admin_messages.sql` is STILL unpasted.** The crash is
  fixed either way, but scheduled broadcasts stay off until it goes in.
- The first two asks (cards, editing) ARE merged to `main` (`58f10d3`).
- **Member self-editing was considered and NOT chosen.** If it comes back, the
  open question is whether an edited ad returns to review — editing after
  approval is the obvious way past a filter that only runs on new ads.
- Not touched: the four `<Tip>` "?" marks in the /admin/ads intro, and the
  `.myad-row` flat lists still on /admin/review, /admin/users and
  /admin/reports.

- **Nothing is merged.** The branch is pushed; merging is the user's call,
  deliberately, because seven other sessions are working the same repo.
- The user opened with "I'd like to make some changes to the admin pages" —
  plural, and "for now" about the branch. Expect more admin work on this
  branch.
- **Member self-editing was considered and NOT chosen.** If it ever comes back,
  the unresolved question is the one that was put to the user and left
  unanswered: does an edited ad return to the review queue, trip only on the
  word filter, or go live immediately? Editing after approval is the obvious
  way to slip banned text past a filter that only runs on new ads.
- Not touched, and the obvious next candidates if the busy-ness complaint
  generalises: the four `<Tip>` "?" marks in the page's intro paragraph, and
  the same flat-row treatment on `/admin/review`, `/admin/users` and
  `/admin/reports`, which all still use `.myad-row`.
