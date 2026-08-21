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

## Version

**1.4.9 → 1.4.10**, moved once for the whole session. §6 counts FEATURES: the
card layout and operator-editing-everywhere make **two**, which is still "3 or
fewer", so the far-right digit moves once and stays there. (9 + 1 = 10, taken
literally as §6 says to.) A third feature would not move it again; a fourth
would move the SECOND digit instead.

## Open / next

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
