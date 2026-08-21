# Session 019 — 2026-08-20 — the admin dashboard, the members grid, and the money

**Version 1.1.7 → 1.2.8.** Two moves, and the audit trail §6 asks for:

1. Mid-session, when the work looked like TWO features (the grid and the
   dashboard), the far-right digit moved: 1.1.7 → **1.1.8**. The relocation of
   /admin was weighed as a possible "major change" and judged not to be —
   session 018 reworked the entire SMS send pipeline and still only moved the
   far-right digit, so that is the bar.
2. At wrap the session had shipped **nine** features (listed below), which is
   comfortably "4 or more", so the SECOND digit moved: 1.1.8 → **1.2.8**. Per
   §6 the third digit is deliberately NOT reset.

## What shipped (nine features, five commits, all on `main`)

| Commit | What |
|---|---|
| `2f1f230` | The members grid + the admin dashboard with system health |
| `afd81ff` | `docs/pricing.md` corrected; what a refund actually costs |
| `139a924` | Cash vs granted credit, the refund guard, the 5% fee (migration 9957) |
| `a2bf576` | Featured listings: four spots, the queue, event pricing (migration 9956) |
| `402581c` | One phone number, self-service artwork, the slot timeline, the income report |

The nine: **1** the members grid · **2** the dashboard + health · **3** the
cash/granted split and refund guard · **4** the 5% refund-fee policy ·
**5** featured listings as a product · **6** event-listing pricing ·
**7** self-service artwork · **8** the slot timeline · **9** the income report.

**Git posture (as run):** started on the designated branch
`claude/admin-dashboard-users-table-7pp5dp`, which was 4 commits behind
`origin/main` and had no unique commits — fast-forwarded onto `main` before
starting. The user then said mid-session: *"youre good to commit as soon as you
have work completed, commit directly to main"*, so the work is on `main`.

## What the user asked for

Two things, verbatim:

1. *"I want to remove the horizontal scrollbar on the users table on the admin
   page when I log in. I also want it more 'TABLE' looking. Like a pervasive
   database viewer table or excel, I want to be able to drag and drop columns,
   resize them, filter by columns, sort by columns, etc."*
2. *"I also want an ADMIN dashboard that appears when I go to /admin. … 'current
   SMS subscribers' and 'Current email subscribers'. Also include 'active ads'.
   And then a system health status. When ads and messages are on and not paused
   and running, put status 'All systems go'"*

## 1 · The members grid (/admin/users/table)

### Where the horizontal scrollbar actually came from

Two causes, both fixed:

- **`.admin { max-width: 48rem }`.** The whole admin portal is capped at a
  reading measure. An eight-column spreadsheet inside a 768px column can only
  overflow. The table page now breaks out with `.admin-wide`
  (`width: min(100vw - 2rem, 120rem)` centred on the viewport, since the parent
  is itself centred). The breakout is dropped under 40rem — on a phone a grid
  is a grid and scrolling it is the honest behaviour.
- **Nothing ever fitted the columns to the space.** The old table was
  `width: 100%` with `white-space: nowrap` inside an `overflow-x: auto` box, so
  the content decided the width and the box scrolled.

### The fix, and why it is shaped this way

`fitColumnWidths()` in `lib/user-table.ts` scales a set of widths so the row
fills **exactly** the width available. The grid measures its scroll container
(`clientWidth`, which EXCLUDES the vertical scrollbar — measuring the border
box instead leaves the grid ~15px too wide and puts the horizontal scrollbar
straight back) and refits on every resize.

The consequence worth remembering: **stored widths behave as proportions, not
pixels.** Dragging a column wider takes the space from its neighbour, so the
total never changes and no scrollbar can appear. Resize the browser and every
column rescales. The function is unit-pinned as idempotent, because the grid
refits on every ResizeObserver tick and a drifting width would creep a pixel
per refit until something overflowed.

A horizontal scrollbar can still appear in exactly one case: more columns
ticked on than fit at `MIN_COLUMN_WIDTH` (72px) each. That is honest — 24
columns cannot fit on a laptop — and the page says so in red above the grid.

### What "more TABLE looking" turned into

`components/UserGrid.tsx` (client) + the `.ug-*` CSS block:

- Sticky heading row AND a sticky per-column filter row under it; the grid
  scrolls vertically inside its own box so headings stay put.
- A frozen row-number gutter down the left, like a spreadsheet.
- Ruled cells (`border-collapse: separate` — sticky cells drop collapsed
  borders in every browser), zebra striping, row hover, tabular numerals,
  right-aligned numbers/money/dates.
- Cells clip with an ellipsis and carry the full value as a tooltip. This is
  what makes a fixed-width grid readable, and `max-width: 0` on the cells is
  what stops one long unbroken value forcing the column wider.
- **Drag and drop**: a ⠿ grip in each heading (HTML5 drag), with an insertion
  marker on the target. Keyboard equivalent: focus the grip, press ← or →.
- **Resize**: drag the line between two headings. Double-click resets that
  column to its natural width and refits.
- **Filter per column**: type under the heading, Enter or blur to apply,
  Escape to revert. A "Clear N filters" button appears in the toolbar.
- **Sort**: click a heading; click again to flip.
- Toolbar: Columns picker (in the current drag order, so ticking one on
  doesn't reset the order), Reset layout, rows-per-page (25/50/100/250).

### Decisions inside that, with reasons

- **Filtering and sorting stay in the DATABASE.** Doing either in the browser
  would only filter the 50 rows on screen — worse than useless, because it
  looks right and is wrong.
- **Column order rides the URL (`cols`); widths live in localStorage.** Order
  is part of the query's shape and should be shareable; widths are a comfort
  setting for one operator on one screen. Saved layouts carry both.
- **`validColumns` now preserves REQUEST order** (it used to force catalogue
  order). That is what carries a dragged order. The old comment's worry —
  headings and cells disagreeing — is handled by one array driving both.
- **Filters moved to one query parameter per column** (`f.email=yoder`). The
  old comma-joined `f=col:value,col:value` split any value containing a comma
  into two broken filters. The legacy form is still READ, so existing
  bookmarks keep working; nothing writes it any more. Saved views now post
  their filters as JSON for the same reason.
- **Filter boxes gained comparison operators**: `>= <= > < =` on numbers,
  money and dates; `=exact` and `!not` on text. A bare value still means "at
  least" / "on or after" / "contains", so every saved view keeps its meaning.
- **Dates are now VALIDATED.** They never were: `parseFilter` passed any
  string to `.gte(column, value)`, so typing "last tuesday" into a date filter
  reached Postgres as a cast error and 500'd the page. Now only `YYYY-MM-DD`
  or a full ISO timestamp parses.
- **A bare day against a timestamp column is a whole DAY, not midnight.**
  `=2026-08-01` becomes `>= the 1st AND < the 2nd`; `<=2026-08-01` becomes
  `< the 2nd`. Comparing the raw day string would quietly cut the day short.
- **A value the column can't take turns the box red** instead of being dropped
  silently on the next render.

## 2 · The dashboard (/admin)

`/admin` is now the dashboard. **The review queue moved to `/admin/review`** —
same page, new address; every `redirect("/admin")` in `lib/admin-actions.ts`
(approve, reject, resolve a chat report, approve/decline an event) now points
at it, and the nav gained a Dashboard link ahead of Review.

Contents:

- Four tiles: **SMS subscribers**, **Email subscribers**, **Active ads** (with
  a split of "on the website" vs "waiting to go out"), and **Waiting for
  review**. The fourth was not in the user's list — it was added deliberately,
  because moving the queue off the landing page would otherwise mean an ad
  could wait for days unnoticed. Flagged to the user.
- The **system health** panel: a headline plus the checks it is built from.
- A "Waiting on you" list (review queue, open help reports) when either is
  non-zero.

### The health verdict (`lib/system-health.ts`, pure and unit-pinned)

Three levels — `stopped` (red), `attention` (amber), `go` (green) — and the
overall level is the worst of the checks.

- `stopped`: ads paused, messages paused, or **TELNYX_API_KEY missing** (which
  outranks the pauses in the headline: no amount of un-pausing helps).
- `attention`: under-attack mode, a delivery backlog **inside** the send
  window, or Resend/Stripe/Supabase not configured.
- `go`: **"All systems go"**, exactly as asked.

**Deliberately not a fault: quiet hours.** Outside the send window ads queue by
design — that window is a promise the compliance copy makes to every
subscriber. The panel stays green and the summary says when the next batch
goes. Colouring a normal night red would teach the operator to ignore the
panel, which is the only way a health panel can really fail. Same reasoning
for an overnight queue: it is not a backlog. Both are pinned by tests.

Detail lines render only for rows that aren't green (plus the send window,
which is the one green state that still explains why nothing is moving) —
eight rows of prose saying "this is fine" is how a panel stops being read.

## Verification

- `tsc` clean, `next build` clean, unit suite **1153 → 1249** (new suites
  `system-health` 37, `user-table` 50 → 101). Abuse 17/17 (the two 🔴 are the
  pre-existing annotated notes).
- **A real browser walk, 37/37 checks.** The members table cannot render in
  dev (it is one database VIEW; the fixture store has no equivalent), so a
  temporary `GRID_DEMO=1` fixture branch was added to the page, the grid was
  driven with Playwright, and the branch was removed before committing. What
  was actually proven in Chromium at 1440px and 900px: no horizontal scrollbar
  on the page or in the grid; the columns sum to exactly the container width;
  dragging a divider widens one column and narrows its neighbour with the
  total unchanged and still no scrollbar; widths persist; heading clicks sort
  both ways; typing under a heading filters that column and resets to page 1;
  a junk date is refused in the box and never reaches the URL; drag-and-drop
  and the arrow-key equivalent both reorder; 24 columns scroll the grid but
  never the page, and say so.

## 3 · The money work (second half of the session)

The user's opening question was whether unused balances could be forfeited,
and how to measure actual income. The answer turned into four shipped pieces.

### The refund fee, and correcting the premise

They asked "can I make a policy that only 95% of their credit gets refunded?"
because they believed a refund costs them a Stripe fee. It does — but not the
way they thought. **Stripe does not RETURN the 2.9% + $0.30 when you refund**;
it was taken at capture and stays taken. So refunding $2,500 costs the $87.50
already spent (3.5%), not a new 5%.

5% is still the right number, for a reason worth keeping: the flat $0.30 makes
the fee WORST on the smallest top-up — 4.4% on the $20 preset, 3.2% on the
$100 one. 5% is the smallest round number that covers every preset, which
makes it cost recovery rather than a penalty. Also noted: the published terms
already said refunds are "at our discretion", so a stated percentage is MORE
generous than what was live, not a retraction. Live on /refund-policy and the
T&Cs, with no fee when the fault is ours.

### The hole the user spotted: "getting refunded for the free ad credit"

Real, and it had no guard at all. A member adds $20, collects the $40 starter
credit, and their balance reads $60 — a single number that does not know two
thirds of it was a gift. Refunds are operator-manual, so only memory stood
between the service and refunding $60 for a $20 payment.

`lib/money.ts` splits a ledger into CASH (refundable) and GRANTED (never),
with **grants consumed first** — the member-friendly ordering, and the one the
policy now publishes. `/admin/users` shows Refundable beside the balance, and
a payout that would exceed it is **refused**, not warned about. Migration
**9957** splits the old catch-all `adjustment` into `payment`/`courtesy`/
`payout`; legacy rows stay legal and are read conservatively in both
directions, so an unclassified row can never fund a refund.

### The income report (/admin/money)

The direct answer to "fifty people prepaying $50 and never posting is $2,500
collected but nothing earned". Three groups: what you have EARNED (split into
the part paid with real money — the income figure — and the part paid with
credit you gave), what you are HOLDING (cash collected, still owed to members
as a percentage of it, paid back out), and what you have GIVEN away.
`lib/income.ts` reads per-member because grants-first is a per-member rule;
summing raw kinds service-wide would mis-split earned revenue.

### Prices, and the featured product

The user set: **$19.99** an event listing, **$199** a featured spot for 30
days, **four spots, two stacked on each side**. Then asked for a request page
that HONORS a queue, then for self-service artwork, then for a slot timeline.

`lib/featured-schedule.ts` is the arithmetic, pinned against the user's own
worked example — four approved on 8-17/8-20/8-24/8-30 means the fifth starts
9-16, the sixth 9-19, and the ninth waits on the FIFTH's run rather than any
original. `/featured` explains that and quotes it from the same function the
approval runs, so the date promised is the date given. Queue order is stored
submission time; the admin approve button re-derives position from that order
rather than trusting the page it was pressed on.

`/admin/featured` grew a **slot timeline**: four rows, a bar per booked run
across the days it holds, today's line in red. Which slot a run sits in is
DERIVED (`assignSlots` replays the same earliest-free-slot rule), so the
picture can never drift from the schedule it draws.

Two small things worth remembering:

- **The homepage's left featured column renders even when empty**, unlike
  every other sidebar. Before the first spot is sold that column IS the
  advertisement for the product; hiding it would leave /featured unreachable
  from the front page.
- **Checkout gained one shared rule** (`isPurchasableAmount`) covering the
  presets plus the two listing prices, used by the checkout page AND both
  purchase actions — previously the page and the actions each had their own
  copy of the preset check, so a price that rendered could have failed to pay.

### The support number

The user gave (330) 275-1603 for sales; config already had (234) 301-0048 for
support. Built as a separate sales line, then the user confirmed they are the
same phone — so both were collapsed onto one `site.supportPhone` /
`site.supportEmail`. There is deliberately no second number now.

## For the next session

### ⚠️ Operator action queue

1. **Paste `9957_money_kinds.sql`.** Until then the Adjust-balance form's kind
   selector falls back to the legacy `adjustment`, and money.ts reads those
   conservatively — refunds stay safe, but "cash collected" on /admin/money
   keeps understating and the unclassified figure keeps growing.
2. **Paste `9956_featured_requests.sql`.** Until then /featured shows the board
   and takes calls and emails, but cannot queue anyone — and says so plainly
   rather than failing. It was AMENDED mid-session (it gained `image_src`) and
   is re-runnable, so paste it again if an earlier copy already went in.
3. **Decide the two carried-over money items** listed under "Still open" below.

### Still open (money)

- **The old Stripe account.** Payments made before the session-016 account move
  must be refunded THERE; the junk accounts from the OAuth loop should be
  closed. Unchanged from session 016 — still the operator's.
- **The website add-on** (`web_addon_cents` = 0). Two seams must be built
  before it can go above $0: SMS self-serve purchase, and a per-ad admin
  toggle. Documented in `docs/pricing.md`.
- **Whether the starter credit should be $180 rather than $40** was a
  session-016 note written against the OLD $150 sheet and is now stale — the
  credit is $40, capped at the first 200 members ($8,000 maximum exposure).
  Re-decide from the current sheet if it comes up, not from that note.
- **A dormancy nudge** ("you still have $50 on your account") was recommended
  and NOT built. The user chose the 5% refund fee instead; the nudge is still
  the thing that turns a dead balance into an ad or a clean refund, and it
  needs no lawyer. Worth revisiting once /admin/money shows a real
  "still owed" figure.
- **`bumpCost` never being decided** (session 005) is now moot: BUMP was
  removed entirely in session 016. Struck from the open list.

### Known gaps in what was built

- **A featured request cannot pick a slot number, and does not need to** — the
  scheduler assigns one. But approving a request does NOT yet create the
  `featured_spots` row: the operator still adds the spot by hand with the
  artwork attached to the request. Wiring approval → spot creation is the
  obvious next increment.
- **The income report reads up to 100,000 ledger rows** and says on the page
  when it stopped. That is a glance, not an export; if the ledger outgrows it,
  the honest fix is a proper export rather than a bigger ceiling.
- **/admin/money will read all zeroes until there is real ledger activity.**
  That is correct, not broken — it was verified against an empty dev store.

### Prevalent things future-me should know

- **The review queue lives at `/admin/review` now**, not `/admin`. Every
  redirect follows it, and `notifyAdminNewAd`'s email link was fixed too — but
  anything written from memory will get this wrong.
- **`site.supportPhone` / `site.supportEmail` are the ONLY contact details.**
  The user confirmed support and sales are the same line; there is deliberately
  no second number to keep in step.
- **Environment note (a real mistake worth not repeating):** `git checkout main
  | tail && git reset --hard origin/main` took its exit status from `tail`, not
  from `git checkout`, so the reset ran even though the checkout had aborted —
  wiping every uncommitted edit to tracked files. They were rebuilt from
  context and re-verified in full. Never chain a destructive git command behind
  a pipeline whose exit status is not the command you care about.
- The unit suite ended at **1369** (new this session: `system-health` 37,
  `money` 62, `featured-schedule` 58; `user-table` 50 → 101).
