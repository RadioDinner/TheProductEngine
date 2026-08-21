# HANDOFF — The Plain Exchange

Live cross-session state document (per `new_session_instructions.md`). Update
this every session. Per-session detail lives in `Session log/`.

**Last updated:** 2026-08-21 (session 021 — the call line no longer dials the
operator's cell at all. Session 020's wrap follows below: the send window, the
ledger reset, the call flow, AD replacing AD NEW, held-unpaid ads, and
scheduled admin broadcasts. v1.4.9).

## ⚠️ START HERE: two NEW migrations are waiting

**`9953_unpaid_ads.sql`** and **`9952_admin_messages.sql`** were written AFTER
the user confirmed the queue clear, and have NOT been pasted. Both degrade
safely — held ads simply are not held, and the broadcast form says the table is
missing — so nothing is broken, but two features are off until they go in.
**`9952` is the newest; the next migration takes 9951.**

### Everything before them IS applied (user confirmed 2026-08-21)

**`9954`, `9955`, `9956` and `9957` are applied.** Nothing else is waiting. Every
feature below is fully on rather than degrading, so if one of them misbehaves,
a pending migration is NOT the explanation — look at the code.

Consequences worth carrying:

- **`9954_reset_ledger.sql` has RUN.** It is destructive and runs exactly
  once; it is spent, and it has disarmed itself — `config.ledger_reset_at`
  carries `{"shape": "wipe-and-grant-v2"}`, so re-pasting does nothing.
  Resetting the books again means deleting that config row FIRST,
  deliberately. Do not write a "reset the books" migration by copying this one
  without reading why it was shaped that way (money section below).
- **`9955_saturday_close.sql` has RUN**, so the stored `sms_window_end_hour`
  row now matches the 6pm the public pages promise. The Saturday trap still
  stands as a rule to remember: **deleting `sms_saturday_end_hour` does not
  disable the early close** — with no row, `getEngineSettings` falls back to
  the CODE default and Saturday still stops at 5pm. Setting it equal to
  `sms_window_end_hour` is what turns it off.
- **`9957_money_kinds.sql` has RUN**, so `payment` / `courtesy` / `payout` are
  split out of the legacy `adjustment` catch-all and new money rows say which
  they are. The "unclassified" notice on /admin/money should read **$0** now —
  9954 deleted every legacy row, so there is no guesswork left to report. If
  it ever shows a figure again, that is a NEW unclassified row, not history.
- **`9956_featured_requests.sql` has RUN** — featured listings and the request
  queue are fully on.

⚠️ **Still outstanding, and no code change reaches it: the 10DLC campaign
description registered with the carrier still says 7am–9pm.** That lives at
Telnyx. The published window and the registered description have to agree —
this is the last piece of the session-020 change not yet done.

## Session 021 (2026-08-21) — NOTHING DIALS THE OPERATOR'S CELL ANY MORE

User decision, in their words: *"I don't want it to ring to my cell phone
first."* Session 020 had already made the attendant menu answer first, but it
kept the old ring-first path alive behind `VOICE_RING_FIRST`. That was the gap:
the behaviour was one Vercel setting away from coming back, and the user's cell
was still ringing — which means the variable was in fact set in production.

**Deleted, not defaulted off** (the distinction is the whole point):

- `lib/voice.ts` — `ringTwiml`, `whisperTwiml`, `acceptTwiml`,
  `callWasAnswered`, `ringToPhones`, `ringFirst`, `ringSeconds`.
- `app/api/voice/route.ts` — the `whisper`, `accept` and `after-ring` stages,
  and the branch at the entry step. `case ""` now unconditionally answers with
  the menu.
- `app/api/health/route.ts` — the `VOICE_RING_TO` count (nothing to report).
- Env: **`VOICE_RING_FIRST`, `VOICE_RING_TO` and `VOICE_RING_SECONDS` are dead.
  ⚠️ USER: delete them from Vercel** — harmless if left, but they read as live
  configuration and are not.

`test/voice.test.mjs` asserts all seven names are absent from the module AND
that no TwiML stage emits `<Dial` — the guard was verified to fail when an
exported name was added to its list, so it is not a vacuous check. Voice suite
49 → **80**; whole suite **1464/1464**, tsc clean, build clean.

**One analytics change rode along, and it is worth knowing about.** The only
`analytics.callInbound` emit for a non-voicemail call lived in `after-ring`,
which is gone — and which had already been dead since session 020 turned
ring-first off, so `call_inbound` in GA has silently been counting *voicemails
only*. It now fires once at the entry step (`outcome: "attendant"`,
`duration 0`), and the voicemail-stage emit was REMOVED so a voicemail is not
counted twice. Net: one `call_inbound` per call, which is what "how many people
phone rather than text" actually asked. The cost is that GA no longer breaks
calls down by outcome — `/admin/calls` still does, exactly, per row.

**Still true and unchanged:** Telnyx forwards the public number's voice calls
to the Twilio number (Telnyx portal → Call Forwarding → Always); Twilio holds
only the "A call comes in" webhook pointing at `/api/voice`. Neither console
has a ring/forward setting for the cell — that only ever lived in this code.

**Not touched:** the Twilio Trust Hub rejection (error 18602, "Business ID
could not be verified"). Same rejection as session 016; the fix on record there
is legal name + EIN exactly per IRS CP-575, a street address rather than the PO
Box, and sole-prop classification. Still open.

## Session 020 (2026-08-21) — THE SEND WINDOW MOVES, AND SATURDAY CLOSES EARLY

**Version 1.2.8 → 1.3.9** (§6: the far-right digit moved mid-session when the
work looked like three features; the send-window copy rule, the operator
setting, the ledger reset and the books-opened line took it past four, so the
SECOND digit moved as well — the same cumulative shape session 019 used).

The user brought back community advice: *"9pm is way too late to send ads on
Saturday nights, and 6 would work for the week days."* Then went one step
further, and the two halves are deliberately DIFFERENT NUMBERS:

> **Published:** "I'll publish that the ads run 7am to 6pm Monday to Saturday"
> **Actual:** "but I want to secretly stop sending ads by 5pm on Saturdays"

### The mechanism to remember: the end hour is PER-WEEKDAY now

`smsWindowEndHour` (18) is the PUBLISHED close and the real one Mon–Fri.
`smsSaturdayEndHour` (17) is Saturday's real close. `windowEndHourFor(weekday,
settings)` in `lib/digest-engine.ts` picks between them, and `smsWindowOpen`
calls it — so every enforcement point (compose in `runQueuedBroadcasts`, the
drain in `drainDigestOutbox`, the approval reply, the admin panels) got
Saturday for free. Both hours are END-EXCLUSIVE, so 18 = last weekday text at
5:59pm and 17 = last Saturday text at 4:59pm.

**The Saturday hour can only ever SHORTEN Saturday.** `windowEndHourFor` takes
`Math.min(saturday, published)`. That is not tidiness: a fat-fingered 20 on
/admin/settings would otherwise text people past the hours the compliance copy
promises every subscriber. Under-delivering on the published window is safe;
over-delivering is a broken promise. Pinned by tests.

### Keeping it secret is a code path, not a wish

`closedEarly(now, settings)` is true only in the gap between Saturday's real
close and the published one. Two member-facing messages consult it and DROP
their hours clause in that hour:

- the approval text (`lib/moderation.ts`) — otherwise "It goes out Monday at
  7am — texts only go out between 7am and 6pm, Monday through Saturday",
  sent at 5:30pm on a Saturday, argues with itself;
- the ad-received text (`lib/engine.ts`) — same sentence, same problem.

Both still say WHEN the ad goes. The promise is kept, it just isn't recited.
**If you add copy that quotes the window, check `closedEarly` first.**

### Where the truth is told, and where it isn't

- **Never**: any member-facing page, the welcome text, the compliance copy.
  Nine public pages moved 9pm → 6pm this session (`/`, `/sms`, `/email`,
  `/account`, `/faq`, `/how-it-works`, `/privacy`,
  `/terms-and-conditions`, and the footer in `app/layout.tsx`).
- **Always**: the admin surfaces, via `operatorWindowLabel(settings)` →
  "7am–6pm Mon–Fri · 7am–5pm Sat". It reads on the dashboard health panel,
  /admin/digests and the /admin/settings pause notice. An operator who does
  not know Saturday closes at five will file the quiet hour as a bug.

### The money books were reset (migration 9954)

`/admin/money` reads EVERY `credit_ledger` row, all time, with no date filter
— so pre-launch it was adding up the operator testing the service on himself
and calling it income. The user's decision, asked and answered: *"I want to
wipe to zero aside from the 40 dollar ad credit"*, and *"no real member money
is in the system yet"*.

**It WIPES AND RE-GRANTS — and the first draft, which kept the existing
welcome-credit rows and deleted the rest, was wrong.** The user checked the
result against the dashboard and it did not match: `$120 still unspent` is
three members' worth of $40, not four. Some members' welcome credit had been
partly spent, one never had a welcome row at all, so keeping-what-exists lands
on $120 across 3 members rather than the intended $160 across 4.

Reconstructing the intended state is the only way to hit it exactly. So 9954
deletes EVERY ledger row, then writes one fresh welcome grant per row in
`users` — amount from `config.starter_credit_cents` (default 4000), worded
exactly as `starterCreditNote()` writes it — and stamps
`users.starter_granted_at` so nobody is granted a second welcome credit and
the 200-member launch count stays honest. The end state is a function of the
users table, NOT of whatever the ledger happened to hold.

**The total is (number of users) × $40, so the migration header carries a
preview query and says to run it first.** If `users` holds more than the
expected members, the total will not be $160.

Verified against a throwaway Postgres 16 on a fixture matching the reported
shape — 4 members, only 3 holding welcome credit, plus a purchase, a cheque, a
payout and a legacy adjustment. Result: 4 members × $40 = $160, and the
surviving rows through the real `moneyPosition`/`incomeSummary` read $0
collected, $0 earned, $0 owed, $160 issued, $160 unspent.

**⚠️ It disarms itself, and that is load-bearing.** `credit_ledger` is
append-only by design (9966) and it is what every balance is MADE of. A wipe
that simply re-ran on every paste would be a loaded gun in the migrations
folder — a future session told to "paste the pending migrations" would destroy
real money. The marker `config.ledger_reset_at` records WHICH reset ran, as
`{"at": …, "shape": "wipe-and-grant-v2"}`; a run whose shape already matches
does nothing. A superseded v1 marker (a bare timestamp string) does NOT block
v2, so a database that got the wrong draft still reaches the right state.
Both paths tested: real rows added after a reset survive a re-paste untouched,
and a v1 marker lets v2 run exactly once. **To reset again you must delete
that config row first — an explicit act, which is the point.**

`getBooksOpenedAt` in `lib/income.ts` reads BOTH marker shapes for the same
reason.

`/admin/money` reads the same stamp (`getBooksOpenedAt`) and prints "Books
opened <date>" under the figures, so the totals' starting point is never a
mystery. Unreadable or absent = the line simply doesn't render.

**Not touched, deliberately:** ads (their spend rows are gone, so old test ads
stay live but unrecorded as paid — `/admin/purge` is the tool for removing a
test member and their ads together), `business_packages`, `users.free_ads`,
and Stripe itself.

⚠️ Stamping `starter_granted_at` for EVERY member means anyone who never
posted now counts as having had their welcome credit. That is what "everyone
has $40 in credit" requires, but it departs from the standing rule that the
grant lands on a member's FIRST post rather than at signup.

### No debt system — an empty balance sends you to the phone

A $50 "debt" allowance was proposed and **cancelled by the user before any of
it was built** (session 020): *"cancel the debt system entirely. If they don't
have enough money to post an ad, reply to them to call the number to add a
card to charge."* There is no debt code to find; do not go looking for it, and
do not reintroduce one without asking — the starter-credit rules exist because
a per-number float is the obvious abuse target (session 005).

`payInstructions()` in `lib/engine.ts` is the single sentence every
refusal-for-money reply ends with, on both the SMS and picture-upgrade paths.
It now leads with **call, press 1** — the same line the card IVR answers, and
pressing 1 is literally its first option, so the instruction and what the
caller hears agree word for word.

⚠️ **Saving a card by phone now switches automatic top-up ON, and that is
load-bearing.** `coverShortfallWithCard` returns early unless `getAutoTopUp` is
true, and saving a card never set it — so a member could call, press 1, add a
card, re-text their ad and be told AGAIN that they have no credit. The IVR's
own consent script had been promising the opposite the whole time ("you
authorize … to charge it for the ads you place, when your ad credit runs
short"), as does the confirmation text. Enabling it on save is what makes the
promise true and closes the loop the new reply sends people into. It is
best-effort — a pre-9973 column or a thrown error must not fail a call in
which the card WAS saved.

### An unfunded ad is HELD, not lost (migration 9953)

Second half of the same user decision that killed the debt system: *"if
someone has no card saved, and no balance for credit, reply to the user that
their ad is saved, but they need to call in and add a card to their account
before it gets sent out."*

An unfunded post used to be refused outright — the seller's text was gone and
they had to thumb the whole thing in again on a flip phone, which is the most
likely moment for someone to give up on the service. It is now written down in
a new `unpaid` status: out of the review queue, off the website, nothing
broadcast, nothing charged, with the **quoted price stored on the row**
(`ads.unpaid_cents`). The release charges THAT, not a recomputed price — an ad
held on Monday must not cost more on Wednesday because the price list moved.

`releaseUnpaidAds(phone)` in `lib/engine.ts` charges and posts everything
waiting. It is called from the two moments funding changes: **a card saved on
the IVR** (so the caller is told, on the line, that their ad is on its way) and
**a Stripe top-up** (in the webhook, deliberately OUTSIDE the `hasLedgerRef`
guard — a retry re-runs a harmless no-op, whereas a release skipped because the
first delivery raced the ledger write would strand a paid-for ad).

**Three things here are load-bearing:**

- **`markAdPaid` is the concurrency guard, not the caller.** It flips the
  status only from `unpaid` and reports whether THIS caller won, so the IVR and
  a web purchase landing in the same second cannot both charge for one ad.
  Never charge without a `true` from it.
- **Status flips BEFORE the charge**, with `setAdUnpaid` as the undo. A failed
  charge after the flip is recoverable; charging first and failing to flip
  takes the member's money and leaves the ad sitting unpaid, which is not.
- **A held ad does NOT emit `postSubmitted`.** The comment at the real submit
  site is explicit that counting ads before they clear the balance check
  inflates the one supply number the roadmap gets argued from. The event fires
  on release.

Ads are also held on a card DECLINE, though the user only asked about the
no-card case: keeping the seller's text costs nothing and losing it helps
nobody. The reply says which happened. Held ads are visible on /admin/ads
under the `unpaid` filter, and deleting one refunds nothing (it was never
charged) — pinned in `test/myads.test.mjs`.

### Scheduled ADMIN BROADCASTS (migration 9952)

The operator's own text, sent individually to every SMS subscriber. The user's
request, then their answer when asked how it should behave: *"it would send out
to all subscribers, in an individual message, and it would send only during
active hours."*

**It is NOT a line riding an ad batch** — that is what business sponsors are.
It is its own message, composed on /admin/digests, and it obeys the send window
exactly like an ad: nothing at nine at night, nothing on a Sunday, nothing
after five on a Saturday.

`sendAfter` is a FLOOR, not an appointment. The window, the cron tick and the
segment budget decide the real moment, so a message scheduled for 6am on a
Sunday goes out Monday morning rather than quietly missing its slot. Preserve
that if anyone ever adds a "send at exactly" mode — an operator who schedules
into a closed window must never lose the message.

**Things here that are load-bearing:**

- **`claimAdminMessage` is the concurrency guard.** It flips `scheduled` →
  `sent` and reports whether THIS caller won, so two overlapping cron ticks
  cannot both text four hundred people. Compose only on a true — and
  `releaseAdminMessage` hands the claim back when composing throws, because a
  broadcast marked sent that nobody received is the one failure with no way to
  notice.
- **Delivery reuses the digest outbox on purpose.** The blocklist, the rolling
  24h segment budget, paced release, retries and the resumable drain are all
  already there and already correct. A broadcast with its own sending path
  would have to re-earn every one of them, and would be the one path that
  forgets the blocklist.
- **Categories deliberately do NOT apply.** A category preference is about
  which ADS a member wants; a note from the operator about the service goes to
  everyone still subscribed. The blocklist DOES apply, at compose and at drain.
- **It runs after the ads in the cron**, so an ad someone PAID for goes out
  ahead of a note from us — and if the segment budget can only cover one of the
  two, that is the right order to find out in.
- The compose box shows the live subscriber count and warns that anything over
  160 characters costs TWO segments to every person on the list. `gsmSanitize`
  on save is not cosmetic: one smart quote pasted from a word processor flips
  the whole message to UCS-2 and doubles the bill.

### Things a future session must not get wrong here

- **The email edition is NOT affected, on purpose** (user decision this
  session, asked and answered). Email has never obeyed the send window — "an
  inbox has no bedtime" — and still composes at 7am, noon and 5pm every day,
  Saturday and Sunday included. The Saturday 5pm edition lands AT five, which
  is what "end the digests by 5" means. Texting is the thing that stops early.
- **The 10DLC campaign description still says 7am–9pm** wherever it was
  registered with the carrier. That is EXTERNAL to this repo and the code
  cannot fix it. The published window and the registered description have to
  agree — update it at Telnyx.
- `smsSaturdayEndHour` is optional in `WindowSettings` — but that fallback is
  about the OBJECT, not the database. A caller that passes a settings object
  without the key (a test, an old serialized blob) gets the published close on
  Saturday; a config table with no `sms_saturday_end_hour` ROW still gets 17,
  from `engineDefaults`. Two different fallbacks, opposite outcomes. Do not
  make the field required, and do not read a missing row as "no shortening".
- A Saturday hour at or below the open hour switches Saturday OFF entirely
  (`hour >= 7 && hour < 0` is never true). That is a legitimate setting, and
  `operatorWindowLabel` says "no Saturday sending" rather than printing
  "7am–12am Sat", which reads like the opposite.
- Setting the Saturday hour EQUAL to the published one is the documented way
  to switch the shortening off — not deleting the setting.

## Session 019 (2026-08-20) — THE ADMIN DASHBOARD, THE MEMBERS GRID, AND THE MONEY

**Version 1.1.7 → 1.2.8** (§6: nine features, so the SECOND digit moved; the
far-right digit had already moved mid-session when the work looked like two.
Full audit trail in the session log). Everything is on `main` — the user said
mid-session "commit directly to main".

Five commits: `2f1f230` (grid + dashboard) · `afd81ff` (pricing doc) ·
`139a924` (cash vs granted, the refund guard, the 5% fee) · `a2bf576`
(featured listings, event pricing) · `402581c` (one phone number,
self-service artwork, the slot timeline, the income report).

### `/admin` is now a DASHBOARD. The review queue moved to `/admin/review`.

Same page, new address. Every `redirect("/admin")` in `lib/admin-actions.ts`
(approve, reject, resolve a chat report, approve/decline an event) points at
`/admin/review` now, and the nav carries both. An old `/admin` bookmark lands
on the dashboard, which links straight through.

The dashboard shows four tiles — **SMS subscribers, Email subscribers, Active
ads, Waiting for review** — plus the system-health panel. The user asked for
the first three and the health status; **"Waiting for review" was added on top,
deliberately**, because moving the queue off the landing page would otherwise
mean an ad could sit for days unnoticed.

**System health** (`lib/system-health.ts`, pure + unit-pinned) says **"All
systems go"** when ads and messages are both on, nothing is paused and texting
is configured. Three levels, worst-wins:

- `stopped` — an ads pause, a messages pause, or **TELNYX_API_KEY missing**
  (which outranks the pauses in the headline: un-pausing wouldn't help).
- `attention` — under-attack mode, a delivery backlog INSIDE the send window,
  or Resend / Stripe / Supabase unconfigured.
- `go` — all clear.

⚠️ **Quiet hours are NOT a fault, on purpose.** Outside the send window ads
queue by design, so the panel stays green and the summary says when the next
batch goes; an overnight queue is likewise not a backlog. Both are pinned by
tests. Colouring a normal night red is how a health panel teaches its operator
to ignore it.

### The members table is a database-viewer grid now (/admin/users/table)

The user's complaint was a horizontal scrollbar. Two causes: `.admin` caps the
whole portal at **48rem**, and nothing ever fitted the columns to the space.

**The mechanism to remember: rendered widths are always refitted to the width
available (`fitColumnWidths` in lib/user-table.ts), so stored widths behave as
PROPORTIONS, not pixels.** Dragging a column wider takes the space from its
neighbour — the total never changes, so no scrollbar can appear. The grid
measures `clientWidth` (which excludes the vertical scrollbar; measuring the
border box instead puts the horizontal scrollbar straight back). The page
breaks out of the 48rem column with `.admin-wide`.

A horizontal scrollbar still appears in exactly one case — more columns ticked
on than fit at `MIN_COLUMN_WIDTH` (72px) each — and the page says so in red.

`components/UserGrid.tsx` is the client grid: sticky heading row + sticky
per-column filter row, frozen row-number gutter, ruled/zebra cells, ellipsis
with the full value on hover, drag-and-drop reorder (⠿ grip, or focus it and
press ← →), drag-to-resize, click-to-sort, a columns picker, rows-per-page and
Reset layout.

### Things a future session must not get wrong here

1. **`validColumns` preserves REQUEST order now**, not catalogue order — that
   is what carries a dragged column order. One array still drives both the
   headings and the cells.
2. **Filters ride one query parameter per column** (`f.email=yoder`). The old
   comma-joined `f=col:value,…` split any value containing a comma into two
   broken filters. It is still READ for old bookmarks; nothing writes it.
   Saved views post their filters as JSON for the same reason.
3. **Date filters are VALIDATED now.** They never were — any string went
   straight to `.gte(column, value)`, so "last tuesday" in a date box reached
   Postgres as a cast error and 500'd the page.
4. **A bare day against a timestamp column means the whole DAY.**
   `=2026-08-01` is `>= the 1st AND < the 2nd`; `<=2026-08-01` is `< the 2nd`.
5. Filter boxes take `>= <= > < =` on numbers/money/dates and `=exact` /
   `!not` on text. A bare value still means at-least / on-or-after / contains,
   so every saved view keeps its meaning.
6. `admin_saved_views.config` gained an optional `widths` key. It is jsonb and
   `normalizeView` tolerates its absence — old views open at default widths.
7. **Filtering and sorting stay in the DATABASE.** Doing either in the browser
   would filter only the 50 rows on screen: it would look right and be wrong.

Verified: tsc + build clean, unit **1153 → 1249** (new `system-health` 37;
`user-table` 50 → 101), abuse 17/17. Plus a real Chromium walk, **37/37** — no
scrollbar at 1440px or 900px, columns sum to the container exactly, resize
preserves the total, sort/filter/drag/keyboard-reorder all exercised. (The
grid can't render in dev — it is one database VIEW — so the walk ran against a
temporary `GRID_DEMO=1` fixture branch that was removed before committing.)

### The money half of the same session

✅ **`9957_money_kinds.sql` and `9956_featured_requests.sql` are PASTED**
(user confirmed 2026-08-21), so the ledger kinds and the featured request
queue are fully on. The degrade paths below stay in the code as a safety net
but are no longer load-bearing.

**Free ad credit can never be refunded as cash, and now nothing relies on the
operator remembering that.** `lib/money.ts` splits a balance into CASH
(Stripe, cheques, phone orders) and GRANTED (starter credit, invites,
courtesy). **Spending consumes grants FIRST** — the member-friendly ordering
and the one the policy publishes. /admin/users shows Refundable beside the
balance and REFUSES a payout that exceeds it. Migration 9957 splits the old
catch-all `adjustment` into `payment` / `courtesy` / `payout`; rows written
before it are read conservatively in both directions, so an unclassified row
can never fund a refund.

**The refund fee, and the fact behind it:** Stripe does NOT return the
2.9% + $0.30 when you refund — it was taken at capture and stays taken. The
flat $0.30 makes the fee worst on the SMALLEST top-up (4.4% on the $20
preset, 3.2% on $100), so **5% is the smallest round number that covers every
preset** — cost recovery, not a penalty. Live on /refund-policy and the T&Cs,
with no fee when the fault is ours.

**/admin/money answers "what is my actual income"** — earned (split into the
part paid with real money and the part paid with credit given away) vs held
(cash collected, still owed to members, paid back out) vs given away. Read
per-member, because grants-first is a per-member rule.

**Featured listings are a product now.** $19.99 an event listing, $199 a
featured spot for 30 days, **four spots, two stacked on each side**.
`lib/featured-schedule.ts` is the rolling-30-day queue, pinned against the
user's worked example (four approved 8-17/8-20/8-24/8-30 → the fifth starts
9-16, the ninth waits on the FIFTH's run). `/featured` explains it, quotes it
from the same function the approval runs, takes a request with self-service
artwork, and offers call / email / checkout. `/admin/featured` draws the four
slots as rows with bars across dates; slot identity is DERIVED by replaying
the booking rule, so the picture can never drift from the schedule.

Things not to get wrong here:

1. **The homepage's left featured column renders even when empty**, unlike
   every other sidebar — before the first spot is sold it IS the advert for
   the product, and hiding it would leave /featured unreachable.
2. **`isPurchasableAmount` is the ONE rule** for what checkout accepts (the
   presets plus the two listing prices), shared by the checkout page and both
   purchase actions. They previously each had their own copy of the preset
   check.
3. **There is one phone number and one email now** (`site.supportPhone` /
   `site.supportEmail`, (330) 275-1603). The user confirmed support and sales
   are the same line; the separate sales fields were removed.

**The income report is at /admin/money** and answers the session-018 question
directly. Three groups: what you have EARNED (split into the part paid with
real money — the income figure — and the part paid with credit you gave), what
you are HOLDING (cash collected, still owed to members as a share of it, paid
back out), and what you have GIVEN away. It reads per-member on purpose:
grants-first spending is a per-member rule, so summing raw ledger kinds
service-wide would mis-split earned revenue the moment one member is on
starter credit while another spends their own money. It stops at 100,000
ledger rows and SAYS SO on the page when it does — a silently truncated money
total is the kind of confident wrong number that gets acted on.

### What is NOT built (deliberate, and the obvious next increment)

- **Approving a featured request does not create the spot row.** It books the
  start day and the timeline draws it, but the operator still adds the
  `featured_spots` row by hand, using the artwork attached to the request.
  Wiring approval → spot creation is the natural next step.
- **No dormancy nudge** ("you still have $50 on your account"). It was
  recommended and the user chose the 5% refund fee instead. Still the thing
  that turns a dead balance into an ad or a clean refund, and it needs no
  lawyer — worth revisiting once /admin/money shows a real "still owed"
  figure.
- **/admin/money reads all zeroes until there is real ledger activity.** That
  is correct, not broken; it was verified against an empty dev store.

Unit suite ended at **1369** (new this session: `system-health` 37, `money`
62, `featured-schedule` 58; `user-table` 50 → 101).

Full detail: `Session log/019_2026-08-20_admin-dashboard-users-table/session_log.md`.

## Session 018 (2026-08-20) — BATCHED ADS with the number burned into the picture

**Version 1.1.6 → 1.1.7** (§6: three features, so the far-right digit moves).

**Git state.** All of it is on `main` and deployed. The session ran alongside
session 017's analytics wrap, which landed its audit fixes on `main` the same
day; the two merged with one conflict, in this file's date line, nowhere in
the code. Session 018 developed on
`claude/batched-ads-numbered-images-aupcvh` and merged on the user's word.

**SMS is a digest again.** Session 016's one-text-per-ad instant send is
retired. A batch is ONE text listing several ads, each headed by its AD NUMBER
(`1022) Gazebo for sale…`), then ONE picture message per picture ad with
`AD 1022` burned into the picture's bottom-right corner. Only the FIRST
picture ever broadcasts; `PIC 1024` pulls up to two more; the rest are on the
website. Triggers: 3 ads waiting OR the oldest having waited 60 minutes,
whichever first, both settings, both only inside the send window. One batch
per pass, so a backlog trickles out as successive batches.

**✅ MIGRATIONS 9958, 9959 AND 9960 ARE PASTED** (user confirmed 2026-08-20),
so every part of this session is fully on rather than degrading: batches carry
a real `slot_key`, pictures ride, problem reports store who filed them, and a
feedback form teaches a member's name to their account. Each was written to
degrade safely until pasted; that safety net is no longer load-bearing but
stays in the code. `/api/health` (with CRON_SECRET) probes all twenty
migrations by name if you ever want to confirm the whole set at once.

### ⚠️ A LATENT PRODUCTION BUG, found and fixed here

`digests` has no slot-key column — the identity was squeezed into
`scheduled_for`. Session 016's per-ad key `ad#1022` therefore became
`adT1022:00:00Z`, which **Postgres rejects**: every instant-send compose threw
in prod while working perfectly in dev (the file store keys on the raw
string). Unnoticed because ads are paused for the pre-launch hold. Fixed with
a real `digests.slot_key` (9960) plus a valid synthetic fallback for any
non-calendar key. Pinned by a regression test.

### Things to know before touching this

- **`lib/ad-badge.ts` draws every glyph as a vector PATH, deliberately.**
  sharp renders SVG via librsvg; `<text>` needs a font fontconfig can find and
  the serverless runtime ships none — a `<text>` badge renders BLANK there
  while looking perfect locally. The unit suite renders one for real and
  probes pixels. Do not "simplify" it.
- **A picture costs 3 segment-equivalents** against
  `digestDailySegmentBudget`, which rose 12,000 → 40,000 to match. At the old
  ceiling the breaker would have halted sending most days. Watch this number
  as the list grows; it is what a busy day costs.
- **Paced release is now largely dormant** (it paces digests, and batching
  means there is rarely more than one undelivered). Batching IS the burst
  control now.
- **Admin re-runs work again** — bumps ride batches, which per-ad editions
  never picked up.
- Public copy swept to match: welcome sequence, FAQ, how-it-works, /sms
  program terms, T&Cs frequency disclosure, footer, the approval text.

### Also shipped (user asks, same session)

- **Problem report + feature suggestion now require a name and a way back**
  (first, last, and phone OR email — each optional alone). Shared pure rules
  in `lib/contact-details.ts`; signed-in members get the contact fields
  prefilled (fetched when the panel OPENS, and only into empty fields).
  "Suggest an idea" is renamed **Suggest a feature**; the question tab shares
  the rules. The problem report's NOTE stays optional — that was always the
  point of item 39.
- **Either form now teaches the member's name to their account** (migration
  9958) — this service otherwise never asks for one, so an operator working a
  report sees a person rather than ten digits, and a member is not asked
  twice. FILL-ONLY: a signed-in session wins, a typed phone is used only to
  fill a BLANK name, a form never creates an account, and an operator's
  correction can never be undone by the next submission. Read lazily, so the
  missing column can't break an account lookup.
- **Adjusting a balance was ALREADY silent** (the user asked). Nothing on
  /admin/users texts the member except "Text them the link" and the Add-a-
  member invite. The page and the handbook now say so.

### ⚠️ OPEN QUESTION THE USER RAISED — unused balances, and what income IS

Asked near the end of the session and NOT yet decided. Worth picking up first
next session, because the answer shapes both a policy page and a report.

**Their question, in two parts:** does the policy say anything about
forfeiting an unused balance after N days ("someone puts $50 on, never posts
an ad") — and how do they measure ACTUAL income, since fifty people prepaying
$50 and never posting is $2,500 collected but nothing earned.

**What the policy says today** (checked, both pages): nothing about
forfeiture, and the opposite is published in two places —
`/refund-policy` and the terms both read *"Ad credit has no cash value,
**doesn't expire**, and can't be transferred; refunds of money you added are
at our discretion, except where the law says otherwise."* Every refund rule
that exists is about one ad's charge (declined → back to balance, ran →
spent), never about the balance itself.

**Notes toward an answer, none of it acted on:**
- Retracting "doesn't expire" for money already taken is the shakiest version
  of this, legally and reputationally — in a community that runs on word of
  mouth, a forfeiture clause on a neighbour's $50 is an expensive way to save
  $50. Prepaid balances also touch state gift-card and unclaimed-funds law
  (Ohio has both); a real forfeiture rule wants an Ohio attorney or CPA
  first, not a code change.
- The safe version of the same idea: expire GRANTED credit (the starter
  credit — never the member's money) rather than purchased balance, and add a
  **dormancy nudge** — after N days, text "you still have $50 on your account"
  — which turns a dead balance into either an ad or a clean refund.
- The accounting answer is separate from the policy answer, and is the part
  that actually answers "what is my income": money in is a LIABILITY until an
  ad runs. Cash collected ≠ revenue earned. The ledger already has the
  material (`purchase` / `grant` / `spend` / `refund` / `adjustment` kinds) —
  what is missing is a report that separates:
  **cash collected** (purchases + check/cash adjustments) · **revenue earned**
  (spends − refunds) · **unearned balance still owed**, split cash-backed vs
  granted · **granted credit issued** (a marketing cost, never revenue).
  ⚠️ Two data gaps to fix if that report is built: Insights' "Money added"
  counts only `purchase`, so **checks and cash entered through Adjust balance
  are invisible in it today**, and `adjustment` is used for both real payments
  and courtesy credits, so the two need distinguishing before cash-collected
  can be computed honestly. Spending grants before cash is the fair default
  ordering, and it keeps the refundable liability as small as it truly is.

Verified: tsc + build clean, unit 1033 → **1153** (new suites `batch` 82,
`contact-details` 38), abuse unchanged (the two 🔴 are the annotated notes).

Full detail: `Session log/018_2026-08-20_batched-ads-numbered-images/session_log.md`.

## Session 017 (2026-08-20) — GOOGLE ANALYTICS, end to end and LIVE

Closed after session 018 merged, so this sits below it by number and above it
in time. Everything is on `main`; **version deliberately left at 1.1.7** — the
features shipped earlier in this session already moved it to 1.1.6, and
everything after the merge was FIXES, which §6 says do not bump.

The site now measures itself across every channel it actually uses: the
website, SMS, the voice line, email editions and Stripe. `analytics/` holds the
reasoning, the code, the audit and the worklist — **`analytics/README.md` is
the way in, `analytics/00-todo.md` is the live tracker.**

### ✅ Live and confirmed collecting

- **Property `G-0P031ZCC9Z`**, Analytics account `derrickwengerd`, Eastern
  time, USD, 14-month retention, Google Signals OFF, reporting identity
  Blended, Stripe unwanted-referral set.
- **18 custom dimensions + 10 metrics** registered and checked against the
  parameters the code actually sends.
- **Both pipelines verified in production**: `page_view`/`first_visit`/`scroll`
  from real visitors, and `sms_inbound` from the Measurement Protocol — which
  proves the whole server chain, API secret through salted hashing to GA
  accepting the payload.
- **Migration `9961_analytics_upgrade.sql` PASTED.** `visit_stats_v2()` returns
  views and unique people; `visit_days` records referring host and campaign.

### ⚠️ Things a future session must not get wrong

1. **A classified ad is a "listing" in GA.** GA4 RESERVES `ad_click`,
   `ad_impression`, `ad_exposure`, `ad_query` and discards events using them
   behind a `204` that looks like success. Enforced by a test.
2. **`analytics/src/after.ts` takes `after()` by INJECTION.** `lib/engine.ts`,
   `lib/moderation.ts` and `lib/digest-engine.ts` must never import
   `next/server` — the test harness loads them under plain node. Every other
   emitting file must import `@/analytics/src/register-after`. A static test
   enforces both halves; it was added because the first version registered only
   in the four API routes and silently degraded twelve events.
3. **Never emit `purchase` from a success page.** It is webhook-only, inside
   the ledger-ref guard.
4. **`ANALYTICS_SALT` is a real secret** and rotating it resets every member's
   GA identity.
5. **The `/privacy` sentence "we do not track you around the internet" is
   load-bearing.** It is true only while Google Signals stays off; there is a
   comment above it in the code saying it must come out the same day anyone
   turns Signals on.

### The audit, and the three defects it found (all fixed, `52a1e91`)

`analytics/07-audit.md` is the full review. The two worth remembering:

- **Twelve events were on the lossy path** because the `after()` injection was
  registered only in the API routes. No error — an undercount of unknown size
  that still looked plausible.
- **Web ad posting emitted NOTHING.** `post_submit` fired only from the SMS
  engine, so every ad carried `channel: "sms"` and the report would have read
  100% SMS with total confidence. Not a gap: **a missing number gets
  investigated, a confident wrong one gets acted on** — and this one feeds
  pricing, the welcome copy and the roadmap.

Also found in production by walking four pages and counting: **page views were
double-counted**, because Enhanced Measurement's "Page changes based on browser
history events" fires on every App Router navigation on top of ours. Fixed in
the console. **Not retroactive — page-view figures before 2026-08-20 are ~2×.**

### Open, none of it urgent (full list in `analytics/00-todo.md`)

- Star the key events as they appear in Admin → Events → Recent events. Only
  `purchase` is starred, by GA's default.
- `chat_message_sent` and `categories_changed` are in the catalogue but not
  emitted; `listing_expired` is deliberately skipped.
- The four explorations and three alerts in `06-operating-the-numbers.md`.
- Search Console link; a second Analytics Administrator.
- UTM tags on email-edition links — SMS and email carry no `Referer`, so every
  visitor our own messages drive lands as "direct". Email is free to tag; SMS
  costs ~15 characters per send, which is the operator's call.
- **DECLINED, deliberately:** the internal-traffic IP filter. The code-level
  admin exclusion is sturdier. Consequence: the operator's signed-out and
  incognito browsing IS counted.

### ⚠️ Still the operator's, carried forward

- **The Telnyx HELP auto-response is now the service's ONLY answer to HELP**,
  and carriers require one. The app stopped replying this session (it was
  double-replying, and the carrier copy still advertises BUMP and CREDITS, both
  removed in session 016). It is not in version control and no test can reach
  it — check it whenever the messaging profile is touched.
- **The 10DLC campaign description still says "up to 4 digests/day."** Carried
  since session 016 addendum 3.

### Environment note

The container's clone was **shallow**, which made `main` and the working branch
look like unrelated histories — `git merge-base` failing, wildly wrong
ahead/behind counts. `git fetch --unshallow` is the one-command diagnosis.
Expect it again in future web sessions.

Full detail: `Session log/017_2026-08-20_google-analytics/session_log.md`.


## Session 016 addendum 5 (2026-08-20) — the feature-list batch, and a launch-day fix

Features 36-41 from the user's list, plus three that came out of building
them. All on `main`.

**39 · "I need help!"** (⚠️ migration 9965). A button fixed to the corner of
every page; one press files a report carrying the page, who they were signed
in as, whether we hold an email for them, referrer, browser, screen size,
timezone and the last error the page threw. **The typed note is optional and
that is the feature** — a stuck member usually cannot describe what went
wrong, so the diagnostics describe it for them; requiring a sentence first
would lose exactly the reports worth having. Emails the operator immediately
AND queues at /admin/help-reports (user decision): the email is how you find
out, the queue is how you spot patterns. Identity is read server-side from the
session, never from the form.

**41 · The members table** (⚠️ migration 9962). /admin/users/table — 24
columns, per-column filters, click-to-sort, saved layouts per operator. It is
one database VIEW, so filtering and sorting happen in the database rather than
by pulling everything into the page; this is the admin screen that would get
slow first. Column names from a request are checked against a catalogue before
they can reach PostgREST — that is a security boundary, and most of the 50 new
tests are on it.

**37/38 · Purge, not "reset"** (⚠️ migration 9966, addendum 4 covers the
build). Worth restating why: Insights stores no numbers, so there was nothing
to edit. **36** turned out to be a labelling problem — both sender figures
already existed.

**40 · Version in the footer.** One constant in lib/config.ts, read by the
footer and /api/health. Currently **1.0.3**, the value the user specified.
The bump rule is now §6 of new_session_instructions.md and applies from the
NEXT session — it was deliberately not applied in the same session that
introduced the number, or 1.0.3 would never have shipped as 1.0.3.

**42 · Pausing is now silent unless you tick "tell subscribers."** The notice
used to be automatic, which is right for an outage and wrong for a planned
hold — pausing ads before launch would have told everyone the service was in
technical trouble.

**43 · Paced release** (⚠️ migration 9963). Past a threshold (default: more
than 4 waiting) each ad gets its own release time, spaced by a RANDOM gap
(12-18 min default, both settings). Random because a fixed interval is itself
a machine signature. Stamped in the DRAIN, not when a pause lifts, so every
way a queue backs up is covered; idempotent, so overlapping cron ticks cannot
re-roll a part-sent schedule.

**44 · Archive + restore** (⚠️ migration 9964). The reversible counterpart to
the purge. Changes nothing the member owns — no refund, no text, ledger
untouched — so restoring returns them exactly as they were. The user page
pushes you toward archive for anyone real; delete is for test data.

### ⚠️ A LAUNCH-DAY BUG, found and fixed

The user's plan was to pause ads and resume at **6am on Aug 31**. The send
window (7am-9pm) was enforced when an ad is COMPOSED but **not when the queue
is DRAINED** — so a backlog held through a pause would have emptied the
instant it lifted, whatever the hour, breaking the window the compliance copy
promises every subscriber. Resuming at 6am would have texted everyone at 6am.
Held SMS now waits for the window; email is exempt (an inbox has no bedtime).
The pause panel also now states which case you are in, so "Resume" is never a
guess.

Two things about that plan the operator still owns: a backlog goes out in one
burst unless paced (hence 43), and **sellers are charged when they post, not
when it sends** — anyone posting before the 31st pays and waits.

### Migrations: ALL PASTED (user confirmed 2026-08-20)

9962-9966 are live, so every feature above is fully on rather than degrading.

Each was written to degrade safely until pasted; that safety net is no longer
load-bearing but stays in the code.

**Version is 1.0.6** (`site.version` in lib/config.ts — set directly by the
user). The bump rule in new_session_instructions §6 applies from the NEXT
session.

Verified: tsc + build clean, unit 878 → **956** (new suites `paced-release` 28
and `user-table` 50), abuse 17/17.

## Session 016 addendum 4 (2026-08-19) — the upload outage, the word-filter tab, settings honesty

**1. PROD BUG, now fixed: every upload over ~4.5 MB was a blank error page.**
The user hit it adding a Featured spot ("This page couldn't load";
Vercel logged `FUNCTION_PAYLOAD_TOO_LARGE`). It was never a Featured bug —
every upload path declared an 8 MB per-file cap and next.config.ts allowed
an 80 MB action body, but **Vercel rejects request bodies over ~4.5 MB at
the edge, before any of our code runs**. So a normal phone photo (3–6 MB)
never reached our friendly validation: the POST died at the platform and
nothing appeared in our logs. It was live on the seller-facing web ad post,
extra pictures, profile photos and chat photos — not just admin.

- **The browser now shrinks pictures before upload** —
  `components/ImageUpload.tsx`, a drop-in for all eight file inputs. 1600px
  longest edge, JPEG q0.82, EXIF rotation baked into pixels. A phone photo
  becomes 200–400 KB, which also turns a slow rural upload into a second.
  Every failure path (no canvas, undecodable HEIC, encode comes out bigger,
  no DataTransfer) falls back to the original rather than blocking the post;
  animated GIFs ride untouched so a canvas pass can't flatten them.
- **`lib/upload-limits.ts` is now the single source** for the ceilings,
  replacing four copies of `8 * 1024 * 1024`, all set BELOW the platform cap.
  New: a whole-POST ceiling, because eight individually-legal files can still
  bust one request — a per-file check alone cannot see that. `bodySizeLimit`
  80mb → 4mb so dev and prod fail the same way.
- The unit suite pins **"our caps stay under the platform cap"** as an
  invariant, so this cannot silently regress.

**2. The word filter moved to its own tab** (`/admin/words`, user request).
Two comma-separated boxes — auto-reject and flag-for-review — replacing the
one-word-at-a-time widget on Settings, which made a real list unmanageable.
The boxes ARE the state. Parsing details that matter: newlines and semicolons
split too (paste from a spreadsheet works), punctuation becomes a SEPARATOR
so `gun/rifle` is two entries rather than the phrase "gun rifle" that would
match neither, spaces are kept so `free money` stays one phrase, and a word
in both boxes resolves to auto-reject exactly once. **Saving applies a diff,
never wipe-and-reinsert** — a wipe dying halfway would leave the filter empty
and every banned word suddenly allowed. Clearing both boxes needs an explicit
tick. Pure arithmetic in `lib/word-filter.ts`, unit-tested.

**3. Settings now describes the post-digest world.** Six items the user
flagged:

- "Picture ad price" was one field against a three-rung price sheet — now
  three (`photoPrice1/2/3Cents`), editing `photoPricesCents` directly. A rung
  left blank keeps its value, so a half-filled form can't zero a price; rung 1
  mirrors into `costPhotoCents`. All three now carry the $1000 ceiling the
  single field had (the price-sheet rework had missed it).
- **`digestCap` is NOT deprecated** — relabelled "Max ads per pass". It no
  longer shapes a single message; it bounds how many queued ads one drain
  handles, and is still the length control on email editions.
- **`expiryDays` → "Website listing length"**, because that is all it does.
  The text goes out once, at approval; nothing re-sends it.
- Two new Insights figures over a fixed 24h: **people who ran out of picture
  pulls** (counted from the outbound "out of pulls" replies — the only place
  the limit actually bites) and **number-look-up usage**.
- `smsGlobalPerHour` is unaffected by the digest retirement: it caps the
  `reply` class; ads are `bulk` via the outbox drain.
- **Email edition times ARE honored** — `runDueEmailDigests` iterates
  `settings.slots`. The user runs `7,12,16,20` (4 editions), not the `7,12,17`
  addendum 3 asked for. This is fine: `pickEmailSponsor` picks fewest-ridden,
  so the rotation self-balances at any edition count. **Addendum 3's request
  to set `7, 12, 17` is withdrawn.**

**4. Member copy stopped calling the texts "digests."** Four LIVE SMS replies
were wrong, two of them naming hours nothing texts at: the fallback welcome
("Ad digests go out daily at 7 AM, 12 PM, 4 PM and 8 PM ET") and the
already-subscribed reply ("Ads come up to 4 times a day") were both reading
`settings.slots`, which are now the EMAIL times. Plus STOP and HELP. All four
now describe the send window from Settings, so editing the hours moves the
copy. Public prose swept too (how-it-works, FAQ, terms, privacy) — the
compliance disclosures were already correct.

⚠️ **STILL THE OPERATOR'S: the 10DLC campaign description says "up to 4
digests/day".** The app no longer sends that, and a registered description
that doesn't match real traffic is what carrier audits look for. Carries over
from addendum 3, still open.

**Migrations: the user confirms ALL are pasted** (9968–9972 inclusive), which
closes addendum 3's open 9970 item. No new migration this addendum — the word
filter reuses the existing `word_filter` table and the upload fix is code only.

Verified: tsc + build clean, unit 706 → **781** (new suites `word-filter` 42
and `upload-limits` 32), abuse 17/17 (the two 🔴 are the pre-existing
annotated notes, not regressions).

## Session 016 addendum 3 (2026-08-19) — INSTANT SEND, and sponsorship by the week

Two overhauls, both user decisions, both live on `main`.

**1. SMS is no longer a digest.** An approved ad is texted at once, one text
per ad, 7am-9pm Mon-Sat (`sms_window_*` config, `smsWindowOpen` in
lib/digest-engine.ts). Outside the window it queues; every cron tick calls
`runQueuedBroadcasts`, which is what empties the overnight and Sunday queue
at 7am. Approval itself broadcasts and then drains for up to 10s, so
"approved" really means "on its way". **The digest survives for EMAIL only**
(3 editions: 7am, noon, 5pm), carrying the ads already texted but not yet
emailed (`ads.emailed_at`) — the user's reasoning: "if I send an email every
time an ad is listed, it'll get spammy."

- **Picture ads broadcast WITH the picture** (MMS, `digest_outbox.media`);
  "Reply PIC 12" is gone from broadcasts, PIC survives as a command.
- **A picture ad waits out of the review queue** until its pictures settle
  (10 quiet minutes) or it hits the 4-picture max (`ads.photos_settle_at`) —
  instant send made this necessary, because an early approval used to be
  harmless (the 6pm digest gave photos time) and now sends immediately.
  /admin shows a count of ads still collecting.
- **Sellers are told the timing** when it matters: an ad texted at 5am gets
  the hours and when it will actually send (`nextSendLabel`). Deliberately
  omitted while the window is open — every sentence is a billed segment.
- ⚠️ **The 10DLC campaign description still says "up to 4 digests a day".**
  Every page now says frequency varies with the window; the carrier filing
  is the user's to update.
- Migration **9971** (pasted): emailed_at, photos_settle_at, outbox media,
  window config.

**2. Sponsorship is sold by the WEEK, with a fair queue.** $199/$349/$479/$599
for 1-4 weeks (per-week price must fall as the term grows — unit-tested).
A running sponsor gets a line on ONE ad text a day ("a ride once a day,
throughout the day" — one sponsor per text, so they spread) plus a banner in
the email editions, one sponsor per edition, rotated fewest-first (~4 of 21
weekly editions at a full roster).

- **Only 5 sponsors run per week** (`sponsor_weekly_slots`). Unlimited
  businesses may BUY; approval books the earliest week with room in EVERY
  week of the term, so a 2-week buyer holds both weeks and later buyers wait.
  Pure arithmetic in **`lib/sponsor-schedule.ts`**, unit-tested against the
  user's own worked example. /admin/business shows which week a pending
  package would run BEFORE you approve it.
- A week = 6 sending days (Sunday is quiet); days remain the ride ledger, so
  a quiet day costs the sponsor nothing and the run extends.
- Migration **9970 — USER MUST PASTE** (weeks_purchased, start_week,
  email_rides, last_email_key, sponsor_weekly_slots). Until pasted,
  pre-existing packages keep their old always-on behaviour (`runsOn` treats a
  null weeksPurchased as legacy) rather than going dark.
- ⚠️ **USER: set /admin/settings → Email edition times to `7, 12, 17`** — the
  saved config still holds the old 2-slot schedule.

Verified across both: tsc + build clean, unit 629 → **658** (new suites
`send-window` 26 and `sponsor-schedule` 27), abuse 17/17.

## Session 016 addendum 2 (2026-08-19) — the call-in card line moved INTO the app

Stripe went live in production this day (user set both keys; a real $45
top-up + refund test passed — refunds are ledger-manual by design, see
users.credits). The user then bought a Twilio voice number (their Trust Hub
business profile had been REJECTED with error 18602 "Business ID could not be
verified" — the fix on record: legal name + EIN exactly per IRS CP-575, a
street address not the PO Box, sole-prop classification; they got a number
anyway) and asked how to set it up.

**Decision: the IVR is served by the main app at `/api/voice`, not by the
standalone `pay-by-phone/` service** (which is now reference-only, its README
flagged). Rationale, in order of weight: the app already holds
STRIPE_SECRET_KEY so the "both deployments must share ONE Stripe account"
hazard is structurally gone; the caller's member account is stamped with the
Stripe customer id at capture time (no ~1 min search-index lag); and
confirmation texts ride the REGISTERED Telnyx line instead of an
unregistered Twilio number. One deploy, one repo, one test suite.

- `lib/voice.ts` — Twilio request-signature check (HMAC-SHA1 over URL + sorted
  params; fail-CLOSED in production exactly like the Telnyx webhook) and pure
  TwiML builders. `app/api/voice/route.ts` — every stage on one URL via
  `?step=`: ring → whisper → after-ring → menu → pay → pay-result →
  voicemail. **User's asks, all built:** simultaneous ring to several phones
  (`VOICE_RING_TO`), auto-attendant ONLY when nobody answers
  (`VOICE_RING_SECONDS`, default 18 — must stay under the cells' voicemail
  delay), voicemail texted to `ADMIN_PHONES`.
- `savePhoneCapturedCard` (lib/payments.ts) find-or-creates the Stripe
  customer keyed by `metadata['phone']` E.164 (same key the standalone service
  used, so `adoptPhoneSavedCustomer` still works), attaches the token, sets
  the default, stamps `card_consent_at`, and calls `setStripeCustomerId`.
  A caller with no account gets one (`ensureAccount`).
- Setup guide: **`docs/call-in-card-line.md`** (PCI Mode, Pay Connector,
  the ONE webhook URL, the env vars, the Telnyx call-forward so the public
  number never changes, the test script). `/api/health` now reports
  `TWILIO_AUTH_TOKEN` and the `VOICE_RING_TO` count.
- `npm test` now runs under the abuse suite's alias loader, so lib modules
  with `@/` imports are unit-testable. Unit 543 → **592** (new `voice` suite:
  49 checks — Twilio's own documented signature vector passes, forged-param
  and missing-token rejections, and TwiML shape incl. "no `<Gather>` ever
  collects card digits").
- Also this day: admin phone orders take a **custom dollar amount** ($1–$5,000,
  `customAmountCents`) beside the presets; the signed-in header link reads
  **"My account"** instead of the member's phone number (user: the number was
  the only way in and nothing said it was clickable).

## Session 016 addendum (2026-08-19) — PROD OUTAGE: sharp 0.35 broke every route on Vercel (fixed; merge to deploy)

The user merged PR #3 (the overhaul) into `main`, pasted migration 9973, then
hit a site-wide 500. Their Vercel log export showed every route — pages,
`/_not-found`, even `/api/cron/digests` (the daily digest!) — dying at cold
start with `Failed to load external module sharp…ERR_DLOPEN_FAILED:
libvips-cpp.so.8.18.3: cannot open shared object file`. **Not the migration
and not the overhaul code:** the old `main` (3b430f3) had the identical
`sharp ^0.35.3` + lockfile and its deployment served fine the same morning —
the merge merely forced the first FRESH Vercel build, and Vercel's current
builder fails to bundle sharp 0.35's libvips layout (known upstream:
lovell/sharp#4567 — Next 16 + Turbopack + Vercel, runtime-only, "downgrade
to 0.34.x fixes it"). Two-part fix on the designated branch:

- **sharp `^0.34.5`** (package.json + lock) — dedupes with Next 16's own
  sharp dependency, i.e. the exact layout Vercel's tracing is tested with
  (`npm ls sharp` → one copy). No API changes needed; the 68 photo-collage
  compositing checks run the real binding and pass.
- **sharp is now lazy-loaded** (`lib/photo-collage.ts` inside
  `combineImageBuffers`; `app/admin/sms-diag/page.tsx` at its two use
  sites). The pure helpers in photo-collage.ts are imported by the store
  layer and hence by nearly every route — the old top-level `import sharp`
  put the native dlopen in the ROOT SERVER CHUNK of the whole site. Now a
  broken binding costs one collage (callers already fall back to the first
  picture) instead of the site. Proven by simulation: with `@img/` renamed
  away (`require("sharp")` throwing the exact prod error), `next start`
  serves / and /faq 200.
- Verified: tsc clean, build clean, unit 522/522. **Prod stays down until
  the user merges this branch into `main`.** After deploy, `/api/health`
  should go green and /admin/sms-diag's upload self-test exercises sharp.

### Outcome (same day): the card line is LIVE

Verified on a real call: ring-through → attendant → press 1 → keypad capture →
card attached to the member's account → confirmation text on the Telnyx line.
Two things had to be fixed to get there:

1. **A voicemail box answering counted as "a human took the call."** Found on
   the first live call (the tester dialed from a number on `VOICE_RING_TO`, so
   their own carrier mailbox picked up and asked the caller for a voicemail
   password). Fixed with answer confirmation — the whisper now gathers a
   keypress, and only a bridged conversation with non-zero duration counts as
   answered. Without this, any cell that is off or busy would swallow a real
   member's call.
2. **The Pay Connector could not be attached to the existing Stripe account.**
   Its OAuth screen only ever offered to CREATE accounts (six were created
   before we stopped). A payment method tokenized in one Stripe account cannot
   be attached to a customer in another — the symptom was a 404
   `No such PaymentMethod` after a call that otherwise went perfectly. The
   user chose to keep keypad capture ("the text-them-a-link path won't work
   for the majority of my users. They're on flip phones"), so **the app was
   moved to the connector's account `acct_1U6DyY3cJ9GPOvgC`**: new
   `sk_live_`/`whsec_` in Vercel, `update users set stripe_customer_id = null`
   in Supabase. Cheap because the original live account was one day old and
   held only a refunded test payment. Procedure recorded in
   `docs/call-in-card-line.md` — and note that Stripe now calls webhook
   endpoints "event destinations" (scope **Your account**, **Snapshot**
   payload, not thin).

Payments made before the move stay in the OLD Stripe account — refund them
there. Junk accounts from the OAuth loop should be closed.

## Session 016 (2026-08-18) — THE DOLLAR PRICING OVERHAUL (credits are gone)

Branch `claude/pricing-structure-overhaul-5ckcku` (designated; awaiting the
user's merge). The user found their competitor's pricing ($65/ad with up to
4 pictures, $45/text ad under 160 chars — print; name stays out of the repo
per the session-010 order) and overhauled pricing end to end. **FEATURES
item 35 built; the live sheet + rationale is `docs/pricing.md`.**

**The sheet (all user decisions this session):** text ad **$45**, picture ad
(up to 4 pictures) **$60**, website-listing add-on **+$15 but FREE at launch**
(`web_addon_cents` = 0; machinery built), **$150 starter credit** granted on a
member's FIRST post (replaces the 3 free-ad passes; same session-005
first-post-only anti-abuse rule), **BUMP removed completely** ("completely
gone, from everywhere, including the FAQ" — the ADMIN re-run tool on
/admin/ads was deliberately kept and flagged), business packages repriced
**$199/$349/$599**. Money is CENTS in the ledger; new config keys
(`ad_price_*_cents`, `starter_credit_cents`, `web_addon_cents`) replace the
credit-era keys so stale rows can't be misread; admin settings edits dollars.
Paying: add-money presets ($45/$60/$150/$300) via Stripe checkout, **auto
top-up** (saved card covers the posting shortfall; users.auto_topup,
FAIL-CLOSED pre-migration; toggles on /account + /admin/users) replaces
BUYCREDIT/YES and the saved-card discount; checks/cash via "Adjust balance"
on /admin/users. Refund matrix unchanged in shape, now dollars; ledger note
tokens (`Ad #<id> (<kind>)`) unchanged — they're an API.

- ⚠️ **NEW MIGRATION `9973_dollar_pricing.sql` — USER MUST PASTE** (re-runnable;
  ledger ×100 conversion guarded by a `money_unit` marker, remaining free
  passes → $60/pass grants, config key swap, `users.auto_topup` +
  `ads.web_listing`, drops the dead packs table). Until pasted: prices are
  correct from code defaults and everything degrades safely (auto top-up OFF
  fail-closed), but legacy balances DISPLAY 100× low. `/api/health` →
  `migration9973`.
- Verified: tsc + build clean, unit suite 532 → **522** (bump/BUYCREDIT tests
  removed with their features; dollar tests added), abuse suite **19/19**
  (BUMP vectors now prove removal: 0 queued, $0, 0 revivals), **37/37**
  Playwright walk checks. Walk gotchas recorded in the session log
  (SESSION_SECRET required under `next start`; dev codes rate-limited).
- Deferred seams (documented in docs/pricing.md): SMS self-serve purchase of
  the website add-on + an admin per-ad web toggle (build before flipping
  `web_addon_cents` above 0); event-listing + featured prices still unset;
  starter credit is a setting — $180 would cover "3 free ads of any kind"
  literally (at $150 it's 3 text or 2 picture ads).
- **Environment note:** the Workflow tool is STILL broken in this container
  class (session-015 permission-handler bug, reproduced 7/7 agents +
  critic). Everything was mined/built inline again.
- **Pay-by-phone bridge BUILT (same session, follow-up):** the session-012
  seam is closed — `resolveStripeCustomer` (lib/payments.ts) adopts an
  IVR-saved card by searching Stripe `metadata['phone']:'+1<ten>'` and
  stamping the member's `stripeCustomerId`; wired into engine auto top-up,
  web-post top-up, admin Bill-their-saved-card, and the admin user view
  (card shows as "on file" as soon as the call-in card lands). Requires the
  IVR service and the app to share ONE Stripe account. `/api/health` env now
  reports STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET presence. The IVR deploy
  itself (own Twilio number/subaccount + PCI Mode + Stripe Pay Connector,
  per pay-by-phone/README.md) is still on the user; its confirmation-SMS
  copy ("Text us what you need and we'll order it") predates this product —
  reword at deploy time.
- Ops queue: **Stripe prod config remains the launch blocker** (checklist
  re-delivered in chat this session); migration 9974 paste + 9980 re-paste
  still on the user (see Session 014), now joined by **9973**.

## Session 015 (2026-08-17/18) — the admin handbook: "?" tips on every admin feature

Branch `claude/admin-handbook-tooltips-q917kd` (designated task branch;
awaiting the user's merge). **FEATURES item 34 built** — the user's ask: a
comprehensive operator handbook "based off the prompt history and context
from the past," so future-them can "Remember" how features work and why
they exist, "through tooltips and little '?' boxes on the admin features."

- **`lib/admin-handbook.ts` is the handbook** — 80 entries in 13 groups
  (one per admin page + cross-cutting concepts), each: what the control
  does / WHY it exists (request, outage, abuse case, or decision — cited
  by session number, user quotes where they explain a why) / optional
  watch-out. Mined from the full corpus: every session log, the founding
  prompt histories, FEATURES.md, HANDOFF.md. Module header carries the
  writing rules (never invent history; tunables say "set on Settings";
  plain language). **When a future session changes an admin feature,
  update its entry** — `test/admin-handbook.test.mjs` guards wiring.
- **`components/Tip.tsx`** (server; key is tsc-checked, content stays in
  the admin-gated payload) + **`components/HelpTip.tsx`** (client "?" →
  small centered card; Escape/backdrop/× close). Placed across ALL 12
  admin pages — every Settings field has one — and `/admin/help` gained
  "The handbook — every '?' in one place" (all 80 entries, read straight
  through, grouped by page with links).
- Verified: unit suite 524 → **532** (new handbook suite), tsc + build
  clean, 19/19 Playwright walk checks (real login incl. set-password
  step; tips on every page; cards open/close; 80 entries render on help).
- **Environment note:** the Workflow tool was broken in this session's
  container — a harness permission-handler bug stripped the parameters
  from every workflow-subagent tool call, so a 14-agent mining fan-out
  died with zero file reads. Mined inline instead. If workflow agents ever
  fail en masse with "permission handler returned updatedInput … failed
  schema validation," it's that bug, not the script.
- Ops queue unchanged from 013/014: **Stripe prod config is still the
  launch blocker**; migration **9974** paste + **9980** re-paste still on
  the user (see Session 014 section).

## Session 014 (2026-08-17) — picture-pipeline day: coaching replies, combined-photo texts, Vercel upload corruption root-caused, scrapbook/grid collages, web shows originals

Started on the designated branch `claude/ad-photo-review-errors-a0t57t`
(`6df1e71`, `899b51f`, `54223d7`); the user merged it (PR #2) and said
"commit directly to main for the remainder of this session" — everything
after is on `main`: `d0ec4a1`+`7e57fdf` (log-noise), `9be119a` (corruption
fix), `6580ba3` (upload self-test), `338be72` (scrapbook), `5a3d769`
(web shows originals), `9c9864d` (4-up grid). Prod auto-deploys `main`.
Unit suite 464 → **524**; abuse 19/19; tsc + build clean at every push.

### ⚠️ OPERATOR ACTION QUEUE (start of next session: ask how far they got)
1. **Paste `9974_collage_confirmation.sql`** — until then the combined-photo
   confirmation texts are silently OFF (cron warns once; digests
   unaffected). `/api/health` → `migration9974`.
2. **RE-paste `9980_chat_upgrade.sql` (whole file, re-runnable)** — prod
   holds a PARTIAL 9980 (pasted mid-session-009, file amended later that
   session): `chat_messages.photo` is missing, so chat pictures + reporting
   are silently off (pages degrade fine). The health probe now checks both
   ends of the file, so `/api/health` → `migration9980` is authoritative.
3. **Run "Run upload self-test" on `/admin/sms-diag`** — the one-click
   verdict on whether the Vercel upload-corruption fix (`9be119a`) holds in
   prod. Green = uploads healthy. Red "readback mismatch" = Vercel still
   mangles even ArrayBuffer bodies — nothing corrupt gets stored anymore
   (guard deletes + fails loudly), but photo saving would be broken:
   next session switch the transport to Blob/FormData multipart and re-run.
4. **Size the corruption damage**: run "Check a stored photo" on one
   `parts/…` URL and one recent bare single. Objects uploaded while the
   Vercel mangle was live are corrupt AT REST forever (the old collage
   `collage/aa1625d1…` provably is — etag 861591c1…). Affected ads need
   pictures resent; a pending ad rebuilds its collage on the next texted
   picture.
5. **End-to-end 2-picture test** (after 1 + green 3): AD NEW + photo →
   coaching reply → second photo → scrapbook collage → combined-photo MMS
   10–15 min after the last picture; website ad page shows the two full
   originals, PIC sends the collage.

### Supabase error-log triage (user screenshot + CSV, 26 errors/hour)
All three families were handled-but-logged noise or the 9980 drift above;
none broke anything, all silenced in `d0ec4a1`:
- **digests 23505 ×2 every cron tick** — createDigestIfAbsent used
  insert-then-catch-conflict as its idempotency; now select-first (unique
  constraint kept as the race guard). Digests were sending fine throughout.
- **chat_messages.photo 42703** — the graceful retry's first attempt; real
  fix = the 9980 re-paste above.
- **buckets_pkey 23505** — ensureBucket create-on-exists per cold start;
  now getBucket-probe-first.

### Built: FEATURES item 33 (user request) — `6df1e71`
1. **Picture coaching replies:** AD NEW that saves a picture now replies
   "Got your ad! … If you have more pictures, please send them one at a
   time - up to 4 total. If we don't hear from you within 10 minutes, we'll
   assume this is the only picture." Multi-picture/follow-up confirmations
   say how many pictures fit and promise the combined photo.
2. **Combined-photo confirmation:** once a combined ad's pictures are quiet
   for 10 minutes, the 5-min cron MMS's the seller the finished collage
   (`lib/collage-notify.ts`; CAS claim on ads.collage_notified_at =
   at-most-once; 25 sends/tick cap; outbound choke point `pic` class; a
   later picture re-arms exactly one fresh send). DESIGN DECISION (flagged
   to user): the 24 h pending-ad attach window is UNCHANGED — "10 minutes"
   is when the set is announced complete, not when attaching closes.
3. **/admin/sms-diag "Check a stored photo":** paste any of our storage
   URLs → server-side fetch verifies HTTP status, served headers vs actual
   bytes, JPEG markers, and a full sharp decode; names the failing layer.
   Built for the user's "image contains errors" report (below).

### The collage "contains errors" — ✅ ROOT-CAUSED + FIXED (same session)
The user ran the new sms-diag checker: the stored collage's bytes are
`efbfbd…` = UTF-8 replacement characters — the JPEG went through a lossy
binary→string round trip **in Vercel's function runtime** (known bug
class: Node Buffer bodies re-encoded as UTF-8 on Vercel functions). NOT
reproducible locally (plain Node / next dev / next start all byte-faithful
with the prod-pinned versions). Fixed in `storeImageBytes` (the single
upload choke point): (1) upload body is an ArrayBuffer copy, never a Node
Buffer; (2) **post-upload read-back verification** — mismatch ⇒ delete the
corrupt object + clean failure into the existing photo fallbacks. Proven
end-to-end against a fake storage server incl. a simulated mangle.
Residue: collages uploaded before the fix stay corrupt until their ad gets
another picture (rebuild) or is reposted; spot-check a `parts/` and a
recent bare single with the checker to size the damage.

### Also built: scrapbook collage style (user request, competitor examples)
The cover-cropped grid was cutting off detail (worst at 3 pictures). New
layout by count in `lib/photo-collage.ts` (user decision after seeing it
live): **2–3 pictures = scrapbook** — never cropped, full frames, native
shapes, corner-anchored and staggered with slight overlap on a portrait
4:5 white page (1200×1500); **4 pictures = clean 2×2 grid** — cells filled
edge-to-edge (cover-cropped) with thin white gutters, same page. Pure
`collagePlacements()`/`gridCells()` are unit-pinned; sample renders were
approved-in-chat. **And (user request, same session): the WEBSITE now shows a
combined ad's full individual pictures, never the collage** — display-only
filter `websiteAdPhotos()` in both site-ad mappers; the collage stays at
position 0 for PIC MMS / the seller confirmation / the email embed / the
review queue.

### Hardening + notes
- An adversarial review workflow (3 lenses × find → refute, 21 agents) ran
  over the item-33 diff before push; 16 confirmed findings (8 distinct) all
  fixed in `54223d7` — headline: paused/throttled confirmation sends now
  CAS-restore their claim (a temporary PAUSE can't permanently swallow
  promised texts), a post-claim re-read stops a racing recompose from
  MMS'ing a deleted collage URL, and **every Telnyx send now has a 10 s
  timeout** (lib/sms.ts — benefits all SMS/MMS, not just this feature).
- Standing design decisions this session: the 24 h pending-ad attach window
  is UNCHANGED ("10 minutes" is when the set is ANNOUNCED complete, and a
  late picture re-arms one fresh combined-photo text); the 4-up grid
  cover-crops its cells (that's what makes it a grid — buyers see the full
  originals on the web); collage confirmations are at-most-once (a send
  failure after a claim is logged, not retried).
- New diagnostic surface on `/admin/sms-diag`: "Check a stored photo"
  (headers-vs-bytes + full decode on any of our storage URLs) and "Run
  upload self-test" — both built to be the fast path for any future "image
  looks broken" report.

Full detail: `Session log/014_2026-08-17/session_log.md`.

## Session 013 (2026-07-28) — multi-picture combine + pre-launch audit

**Git: back on the merge-to-main posture** (user: "Merge to main for this
session"). Developed on `claude/multi-image-combine-launch-review-8dbe4r`,
fast-forwarded onto `main` (`main` already had session 012's pay-by-phone
commit — the user had merged it). Prod auto-deploys `main`; **the next
deploy installs `sharp` (new npm dependency) — expected to be automatic.**

### Built: FEATURES item 32 — multi-picture combine (`c5a69c0` + `9f2c435`)

The user texted several pictures and nothing combined — the session-011 idea
is now built. 2–4 pictures in one MMS (or trickled as separate messages) are
composed into ONE collage JPEG that is the ad's photo (position 0); the
individual originals join the website gallery (positions 1+). Follow-up
photo-only or captioned-photo messages attach to the sender's PENDING ad
(<24 h) and rebuild the collage; approved ads never change. A photo landing
on a TEXT ad charges exactly costPhoto − costText (waived for free-pass
ads; ref-guarded so concurrent messages can't double-charge; refunded
ref-idempotently if the attach fails; benign-reject and member-delete
refunds now return base + upgrade via `adRefundableTotal`). No migration —
provenance lives in storage folders (`collage/`, `parts/`, bare). `sharp`
does the compositing (no external AI service needed). Unit suite 428 → 464;
two dev walks 17/17 + 14/14; abuse 19/19. Details: FEATURES.md item 32,
`Session log/013_2026-07-28/session_log.md`.

Also shipped from the audit (in `9f2c435`): **CTIA/FCC opt-out keywords**
(STOPALL joins STOP; END / REVOKE / OPTOUT / OPT-OUT / OPT OUT unsubscribe
as sole keywords — "End table for sale" stays an ad-shaped message);
pending-only `attachAdPhotos`; captioned pictures attach instead of being
silently dropped; 64MP sharp decode cap; `maxDuration=60` on
`/api/telnyx/inbound`.

### Pre-launch audit (8-dimension adversarial workflow, 23 agents; all
### blocker/high findings independently re-verified against the code)

User context given: all migrations pasted, 10DLC registration complete.
What's genuinely solid: schema-vs-code parity is CLEAN (no 42804-class enum
bugs left), money plumbing is idempotent/atomic where it matters, all three
webhooks fail closed, the retry-swallow inbound trap IS fixed for all
paths, the choke-point outbound architecture holds, and the digest happy
path is well-engineered.

**⚠️ OPERATOR ACTION QUEUE (blockers/ops first — nothing here is code):**
1. **BLOCKER: Stripe was never configured in prod.** STRIPE_SECRET_KEY +
   STRIPE_WEBHOOK_SECRET unset (LAUNCH A2/A6 unchecked since session 003).
   Every payment surface is a dead end — checkout shows "Development mode",
   BUYCREDIT/YES refuses, business packages refuse. With prices at 2/10, a
   seller is broke after 3 free passes and CANNOT PAY YOU. Set live keys +
   the live webhook endpoint, run one real $5 purchase, check LAUNCH §A6.
   (When configuring: card-only payment methods — the webhook credits only
   synchronous `paid` checkouts; async methods would take money and grant
   nothing.)
2. ~~Verify migration 9975~~ **✅ user re-confirmed applied 2026-07-28**
   (same session, after the audit). Belt-and-suspenders check remains
   worthwhile: burn a member's free passes and post one credit-charged ad
   in prod — that's the only path that exercises the fixed RPC.
3. ~~Fix the CAN-SPAM address~~ **✅ fixed 2026-07-28: "PO Box 216 ·
   Beach City, OH 44608"** (user-supplied box + city; ZIP is Beach City's
   standard 44608 — user should flag if their box uses a different ZIP).
4. ~~Verify ADMIN_EMAIL~~ **✅ user reports fixed 2026-07-28.** Confirm
   delivery once: post a test ad and check the review-alert email arrives.
5. ~~Confirm what pings the digest cron~~ **✅ IDENTIFIED 2026-07-28: it's
   Vercel's native cron** (user's logs: 200 every 5 min at :34s, hitting
   the deployment-specific hosts; kept firing on the fresh deployment hash
   right after the session-013 merge). LAUNCH §A5 checked off with the
   external-pinger fallback documented in case the Vercel plan ever
   changes.
6. **Verify ads@ + subscribe@ inbound end-to-end** (RESEND_WEBHOOK_SECRET
   set? domain verified? MX added?). Fail-closed means: if unset, emailed-in
   photos silently do nothing. **Renamed 2026-07-28 (user request):
   `ads@theplainexchange.com` is now the pictures-in address** (photos@
   stays accepted as a legacy alias; Resend inbound is domain-wide, so the
   rename needs NO Resend config change — routing is by local part).
7. www vs apex + SITE_URL alignment (LAUNCH A1 second box).

**Code backlog from the audit (launch-relevant first, none built — need
prioritization/decisions):**
- **STOP'd numbers still get app-initiated reply-class texts** (chat
  nudges, rating invites, admin invites) — STOP only clears the digest
  subscription; no opt-out state gates dispatchSms. Verifier downgraded to
  medium (volumes are tiny + carrier-level blocks apply), but it's the
  biggest remaining 10DLC-posture gap. Fix shape: an opted_out flag checked
  in dispatchSms for non-transactional classes.
- **Password sign-in has no throttle/lockout** (OTP lane is capped; the
  password lane isn't) — online brute-force of the known admin phone.
- **Email-signup lane** sends confirm emails to any address, unlimited —
  email-bombing / Resend-domain-reputation risk. Needs a per-address +
  per-IP cap.
- **Digest failure paths** (two confirmed highs): (a) crash-recovery redo
  recomposes from the live queue so finalize can consume ads whose text was
  never enqueued (ad "broadcast" nobody received); (b) failed outbox sends
  requeue instantly claimable — a Resend 429 burst burns all 3 attempts in
  seconds and parks the email edition silently. Fix shapes: redo from the
  digest's recorded items; add a not-before backoff column/logic.
- **No MMS budget breaker** (PIC MMS outside digestDailySegmentBudget) and
  **nothing clamps the registered "up to 4 digests/day"** (slots setting +
  extra editions are unbounded) — both carried from session 011.
- /api/health probes columns only — no RPC probes (the exact class that hid
  the 9975 outage); extend health with side-effect-free RPC calls.
- Telnyx DLR persistence (carried since 007); web-lane rate limiter
  (contact form → operator-class email is unbounded); bumpCost still 0
  (session-005 decision never made); HELP/FAQ don't mention category
  commands; web unsubscribe doesn't purge queued digest rows (SMS STOP
  does); concurrent attaches can duplicate ad_photos positions (cosmetic;
  real fix = unique index migration); older degrade guards match 42P01 only
  (PGRST205 is what PostgREST actually returns — business/featured guards
  have it, chat/ratings/photo-submission guards don't); dead seeded config
  (packs table, support_number, digest_slots_email are never read — edits
  to them silently do nothing; seeded support_number contradicts
  lib/config.ts).

Full per-finding evidence with file:line cites: the workflow transcript is
session-local, so the durable copy is this list + the session log; anything
being fixed should be re-verified against the code first anyway.

## Session 012 (2026-07-23) — pay-by-phone card capture added (standalone service)

The user uploaded a new feature (`plainexchangepaybyphone.zip`); it's added
**unmodified** under `pay-by-phone/` at the repo root — a standalone
Node/Express service implementing a **Twilio `<Pay>` IVR → Stripe card-on-file**
flow. Four files (`server.js` ~231 lines, `README.md` full console/ops setup,
`package.json` with its own express/twilio/stripe deps, `.env.example`).

**What it does:** `POST /voice` reads a stored-credential consent script then
runs TwiML `<Pay>` in tokenize-only mode (`chargeAmount "0"`,
`tokenType "payment-method"`) — the caller keys card/expiry/CVC/ZIP on the
phone keypad and the digits flow carrier → Twilio → Stripe, **never touching
the operator, this server, or a log**. `POST /pay-result` attaches the
returned `pm_…` to a Stripe customer keyed by caller phone, sets it default,
stamps `card_consent_at`, texts a "card saved" confirmation. `POST /charge`
(bearer `INTERNAL_API_KEY`, called by your order workflow) makes an
off-session PaymentIntent against the saved card.

**Product-wise it's the PCI-safe upgrade to FEATURES item 29** (call-in card
checkout). Item 29 today has the OPERATOR key the card into Stripe's page
while the caller reads it aloud — the exact thing this README warns against.
This removes the operator from the card path.

**Kept as a SEPARATE deployable, by design:**
- Twilio **PCI Mode is irreversible and redacts logs account-wide** → it wants
  its own Twilio account/subaccount (don't put that on the classifieds SMS
  account). And the main app is on **Telnyx**, not Twilio — there's no shared
  number to fold into anyway.
- Build guards so it can't touch prod: `.vercelignore` now excludes
  `pay-by-phone/` from the Next build/deploy; its `package.json` is not a
  workspace (the root install ignores it); `tsconfig` globs only `**/*.ts(x)`
  so `server.js` is never typechecked. The Next app build is untouched.

**NOT wired into member accounts (deliberately deferred — it needs a user
decision and it touches the production app):** as written the service is an
island. It finds Stripe customers by `customers.search` on `metadata['phone']`;
the app charges saved cards via the member account's stored `stripeCustomerId`
(`chargeSavedCard` → item 29 "Bill their saved card"). So an IVR-saved card is
**not chargeable from `/admin/users` or by BUYCREDIT** until: (1) the service
and the app share the **same Stripe account/key**, and (2) a reconciliation
bridge stamps the IVR-created customer onto that member's `stripeCustomerId`.
Minimal bridge (recommended next step, when greenlit) — either:
  a. `/pay-result`, after attaching the card, POSTs `{phone, customerId}` to a
     new authenticated main-app endpoint that sets `account.stripeCustomerId`; or
  b. add a phone-based fallback to the app's `firstSavedCard` (search Stripe by
     `metadata['phone']`) when the account has no stored customer id.
Either makes the whole item-29 + BUYCREDIT surface work for call-in cards
automatically. Confirm phone formats line up (app `normalizePhone` E.164 vs
Twilio `From`/`Caller` E.164 — they should, but verify at build). I offered to
build this bridge now; the user declined to spec it this turn, so it stays a
documented seam, not built.

**Review notes (added as-is; flagged for when it's relied on in prod):**
- Consent/PCI is sound: the spoken script covers saving the card AND future
  off-session charges + cancellation — a proper stored-credential mandate.
- `/charge` auth is a shared bearer token; the README's own hardening checklist
  is the pre-reliance punch list (enforce prod webhook signatures, keep your
  own phone→customer table instead of Stripe search which lags ~1 min, log
  `PayErrorCode`, optional PIN before `<Pay>` for shared shanty numbers). No
  rate limit on `/charge` and a non-constant-time token compare — low risk
  behind a private caller, worth tightening if the endpoint is ever exposed.
- Twilio webhook signature validation is enforced only when
  `NODE_ENV=production` (dev-open for ngrok testing, by design).

**Ops to go live (from the README):** Stripe account → Twilio voice number →
enable PCI Mode → install the Stripe Pay Connector (name it `Default`) → point
the number's voice webhook at `https://<host>/voice` → fill `.env` → deploy →
test with card `4242…`. Costs ≈ $0.20 to save a card, ≈ 3% + $0.45 per charge.

**Git:** developed on the designated task branch
`claude/new-feature-upload-zh3y9p` (NOT `main` this session). Committed + pushed
there. Full detail: `Session log/012_2026-07-23/session_log.md`.

## Session 011 (2026-07-20) — digest decision + location-specific direction

On branch `claude/ad-sending-strategy-eeiwe0`. Three outcomes:

1. **DIGESTS STAY (user decision).** The user weighed per-ad
   send-on-approval (5 min after approval, 7am–8pm window); a full
   code-grounded analysis (segment cost ≈ wash; the blocker is the
   registered "up to 4 digests/day" 10DLC frequency promise + complaint
   mechanics; build itself tractable) is in
   `Session log/011_2026-07-20/session_log.md`. Standing offer if faster
   delivery is wanted: slots `[7, 12, 16, 20]` on /admin/settings is
   zero-code and matches every registered word.
2. **New direction: location-specific areas under ONE brand.** "The Plain
   Exchange" stays the whole brand (user: keep the brand); it gains
   location-specific AREAS people browse from the web — Holmes County
   first, then Lancaster PA / northern Indiana / Harrisonburg VA / Big
   Valley PA + request-a-new-area. Immediate slice = **FEATURES item 26**
   (not started); the rollout/WhatsApp/request-flow live in the NEW
   **`LONG_TERM_VISION.md`** (user-instructed convention: long-range list,
   separate from FEATURES, not to be built unless greenlit).
   **North Star (user, this session):** an Amish/Mennonite-ONLY marketplace
   — "facebook, sms based and craigslist mashed into one" — recorded at the
   top of `LONG_TERM_VISION.md`. Plain-only membership would lean on the
   verified-member gate (item 7); the flagged hard question is enforcing it
   without excluding flip-phone members. Directional, not a build order.

   **Git:** as of session 011 the user re-authorized committing **directly
   to `main`** ("merge to main and keep merging to main") — same posture as
   sessions 007–009. Session-011 work was developed on
   `claude/ad-sending-strategy-eeiwe0` then fast-forwarded onto `main`.

4. **Build work shipped (all on `main`):** town-hall month/day/year date
   pickers + "Address (optional)" (`cfac15b`); areas backend + HIDDEN
   location selector (`ca1a808`, FEATURES 26 — `lib/areas.ts`,
   `AREAS_SELECTOR_ENABLED=false`; Indiana = one Elkhart–LaGrange area;
   each area needs its own SMS number + campaign to go live); "Ask a
   question / Suggest an idea" feedback buttons emailing the operator
   (`ca1a808`, FEATURES 27); "NEW AD"→"AD NEW" leniency (`b6e487b`,
   FEATURES 28). Unit suite 401 → **428**.

5. ✅ **PROD AD-POSTING OUTAGE — ROOT-CAUSED + FIXED** (web → raw crash
   "ERROR …@E394"; SMS "AD NEW …" → no reply). The graceful-error hardening
   (`b6e487b` inbound, `a0dd2d8` web) surfaced the real error in the Vercel
   log: **42804 — `column "kind" is of type ledger_kind but expression is of
   type text`.** The `spend_credits` RPC (9995) inserts its `p_kind` TEXT
   parameter into `credit_ledger.kind` (the `ledger_kind` ENUM) with no cast;
   Postgres won't coerce a text *variable* to an enum. Free-ad-pass posts use
   a PostgREST insert (`addLedgerEntry`) which DOES coerce, so this was latent
   until a seller's free passes ran out and the first real **credit charge**
   hit the RPC. **Fix: ⚠️ NEW MIGRATION `9975_fix_spend_credits_ledger_kind.sql`
   — USER MUST PASTE IT** (Supabase SQL Editor; re-runnable create-or-replace,
   only change is `p_kind::ledger_kind`). Until pasted, credit-charged posts
   keep failing — but now GRACEFULLY (friendly reply/redirect, logged), not
   silently/crashing. **The retry-swallow trap — a standing backlog item since
   session 007 — is now fixed for the inbound path.** Note: unit/abuse suites
   run on the file store, so they can't catch a Supabase enum-cast bug — this
   class needs the migration to be right.
3. **Session-010 cleanup CONFIRMED DONE:** redaction is on `main` (grep
   clean) and both old branches are deleted on GitHub. A Holmes County
   competitor scan was delivered in chat only (names stay out of the repo
   per the 010 order); headline: all competition is print/mail/auctions —
   no SMS or WhatsApp classifieds service found.

## Session 010 (2026-07-17) — competitor-reference redaction on `main`

A 10DLC compliance question about a competitor became a repo-wide order to
**remove every reference to that competitor**. Key finding at re-eval: the
redaction (done earlier on a feature branch) had **never reached `main`** —
`main` had advanced independently with session 009's fuller work and still
exposed the competitor name in 5 files (incl. two new session-009 files:
`app/admin/featured/page.tsx` placeholder + `test/featured.test.mjs`
domain). Fixed on a fresh branch **`claude/session-010-compliance`** cut from
current `main`: all 5 redacted (log text + fixture/seed surname →
"Yoder family" + featured placeholder → "Miller's Harness Shop" + test
domain → `millersharness.com`), `Session log/010/` added. `git grep` clean,
`npm test` 401/401. ⚠️ **USER: merge this branch, then delete BOTH old
branches on GitHub** (the old competitor-named branch (suffix `…-l1pj8m`) and, after
merge, this one) — the session's git proxy 403s deletion pushes. Only after
the merge does `main` lose the name. Detail:
`Session log/010_2026-07-17/session_log.md`.

⚠️ **MIGRATION NUMBERS RENAMED (session 009, user decision):** the repo now
uses the descending scheme from `new_session_instructions.md` §4 —
`9999_init.sql` counts down, lowest number = newest, **next migration =
(lowest − 1)** — after this session that means `9975_*`. Old ascending names
`0001`–`0019` were renamed with **new = 10000 − old** (0013 → 9987, etc.;
full table in `supabase/migrations/README.md`); `/api/health` probe keys
renamed to match. All 18 were applied to prod BEFORE the rename — nothing
needs re-running. History sections below and `Session log/` keep the old
numbers; decode with 10000 − old. Never `supabase db push` (CLI order is
ascending = newest-first under this scheme); hand-paste only.

## What shipped in session 009 (2026-07-17, committed DIRECTLY to `main`, per user)

**THE ENTIRE FEATURES LIST RAN TO COMPLETION** — items 9, 11–25 all built
(item 10 stays on hold by user decision), via parallel worktree lanes each
verified (unit tests, tsc, build, Playwright walk) before merge. Unit suite
181 → 391 → **401 checks** (last +10 from the adversarial-review fixes, see
below). Full detail: `Session log/009_2026-07-17/session_log.md`.
Headlines:

- **Migrations renumbered descending** (see the note above). 9980 (chat
  upgrade) was pasted by the user mid-session.
- ⚠️ **FOUR MIGRATIONS WRITTEN, NOT YET APPLIED at wrap: 9979 (reveal
  metering), 9978 (business packages), 9977 (town hall + featured), 9976
  (categories).** Independent — paste in any order; `/api/health` probes
  each. Everything degrades gracefully until pasted (reveal unmetered,
  business purchases refuse, sidebars hidden, categories dormant — never a
  500).
- **Item 9** web ad posting (SMS-exact pricing) · **11/12** strip hiding +
  header unread badge (`/api/unread`) · **13/14/15** chat rebuild: bubbles,
  report queue, link block, full audit logging (stance reversal documented
  on /admin/help), pictures (30/thread, never on SMS), one-RPC send +
  optimistic UI + `chat_nudged_at` · **16** My ads tab with the delete
  refund matrix (pending → refund; approved-never-broadcast → refund; ever
  digested → none; idempotent ledger refs) · **23** metered click-to-reveal
  (numbers never in HTML, 10/day + bank 30, insights flags + block) ·
  **17** business advertising ($39.99/59.99/89.99 wk/2wk/mo, Stripe
  self-serve, review-gated, labeled Sponsor line OUTSIDE the cap-10,
  missed days extend, declines = manual Stripe refund flow) · **18/19**
  homepage featured-left/ads-center/townhall-right; free events board with
  review + auto-expiry; two rotating Featured slots (operator-only, image
  ads, external links rel=sponsored) · **22/24/25** category system:
  approved SUBSCRIBE menu, toggle replies with exact user copy + 5/hr
  confirmation throttle, ONE combined filtered digest per subscriber
  (composed once per distinct category set; ALL byte-identical to before;
  uncategorized rides everything; sponsors ride all groups), operator
  categorizes at review, /account checkboxes, homepage ?category browser.
- **Site/policy batch:** privacy + terms competitor audits (ours kept
  stronger stances; real gaps filled); accessibility statement + refund
  policy footer pages; © 2026 footer line ("Powered and secured by
  CodeFuseSolutions"); **firearms banned** in the stated rules + post form;
  **support = (234) 301-0048 everywhere, (330) 960-7170 exclusively the
  ads line**.

**User ops queue:** paste 9979/9978/9977/9976 → check health; optionally add
firearm word-rule flags; set prices when ready (Featured slots, event
listing/blast — deliberately unwired); carried from 008: verify photos@
inbound + review-alert emails.

**Recommended-but-unbuilt (new + carried):** web-lane rate limiter (none on
posting/events/reveal-clicks beyond quotas); private bucket + signed URLs
for chat images (currently the public ad-photos bucket, unguessable URLs
only — user informed); abuse-suite pass over the new surfaces; HELP/FAQ
don't mention category commands yet; retry-swallow inbound trap; Telnyx DLR
badges.

**Adversarial review outcome (33 agents, find → refute):** 27 findings, 25
confirmed, ALL FIXED in `5557007` (hotfix: degrade guards had to match
PostgREST schema-cache codes PGRST205/204 — without this the homepage
sidebars + /advertising could 500 pre-paste; hasRevealed now fails closed)
and `835d45a` (batch: Stripe webhook 503s an unstorable paid package so
Stripe retries until 9978 lands; member-delete refunds crash-safe + CAS'd
against admin-reject races; dropped-paid-bump refund; web charge undo;
grantFreeAd CAS; per-GROUP STOP footer; finalize consumes only DELIVERED
ads; empty category set truly dark; stranger category/LIST texts no longer
mint accounts; emptied-warning exempt from throttle; dispatchSms
GSM-sanitizes at the choke point; chat nudge is an atomic claim; town-hall
+ photo-alt phone masking; sold-ad reveals allowed; search keeps the
category filter; privacy copy matches the reveal reality). Unit suite ends
at **401 checks**. ONE finding deliberately deferred: chat pictures live in
the PUBLIC ad-photos bucket (unguessable URLs) — the private-bucket +
authed-serving rework is the top backlog item.

## What shipped in session 008 (committed DIRECTLY to `main`, per user)

**The 007 handoff items, then the new `FEATURES.md` list — items 0–5 ALL
BUILT, each dev-walked (75 Playwright checks across 6 walks) and pushed
separately.** Unit suite 129 → **181 checks**.

⚠️ **SIX MIGRATIONS WRITTEN, NONE APPLIED at session end: 0013–0018.**
Prod auto-deploys `main`, so the code is live NOW with every new feature
**dormant-but-safe** until its paste: this session every schema-dependent
feature degrades gracefully (hides / reports "paste migration X" / omits
itself — never a 500) and `/api/health` (CRON_SECRET) probes
`migration0013`…`migration0018` individually. **User: paste
0013_ad_delete, 0014_user_ids, 0015_ad_photo_submissions, 0016_ratings,
0017_profiles_chat, 0018_digest_numbers in file order, then check health.**

- **Email digest subject** (user request): now led by the standout ad —
  `The Plain Exchange : 07-16-26 - Tractor trailer +3 more ads`. Standout =
  highest-priced ad (fallback: digest order); pure + unit-tested
  (`lib/ad-display.ts`), applies to scheduled AND early/extra editions.
- **Admin ad deletion (0013)** — the 007 request. "Delete this ad…" on
  /admin/ads, any status: two-step confirm shows the seller's charge and
  warns no-refund/no-notice. SOFT delete (new `deleted` status — broadcast
  history/digest_items never rewritten): hidden from site/digests/MYADS,
  PIC/STATUS no-ad-found, SOLD/BUMP refuse, queued bumps dropped, photos
  removed from storage too. `deleted` filter on the Ads tab; /admin/help
  documents it.
- **FEATURES.md created** — the running feature list (user convention: when
  they add a feature, append it there). Items 0–5 all **built**:
  - **0 · USER_ID (0014):** unique random 6-digit member ids, backfilled by
    the migration, lazily assigned after; merged-away ids not reusable for a
    YEAR (`retired_user_ids` tombstones). On /account + /admin/users.
  - **1 · Email-in extra pictures (0015):** photos@ + "Ad 1042" in the
    subject → sniffed + re-hosted → `ad_photo_submissions` awaiting review
    on /admin/ads → approved extras join the WEBSITE gallery at position 1+
    (position 0 = the paid MMS picture; SMS/PIC/digest costs untouchable).
    **Ops: add the photos@ inbound address in Resend → same webhook.**
  - **2 · Confirmed ratings (0016):** SOLD → "what was the buyer's phone
    number?" → sale recorded → RATE 1–5 both directions (buyer gets one SMS
    invite). Store-enforced: only the recorded sale's parties, right
    direction, once per ad. Averages on the ad page + /admin/users. New
    `sms_contexts` conversation-state (48 h / 7 d windows; SKIP opts out).
  - **3 · Profile (0017):** picture (re-hosted) + pickup address that is
    STRICTLY private — leaves only via the explicit "Share my pickup
    address" button inside a chat.
  - **4 · Chat (0017):** "Message the seller" on ad pages → threads under
    /account/messages keyed on member ids (phones never shown; non-members
    404). One "message waiting" SMS nudge / number / 3 h, reply-class.
  - **5 · Digest numbers (0018):** every sent digest numbers itself from 1
    (reset now, per user): "Plain Exchange No. 3 Jul 16 morning:"; email
    edition mirrors it; /admin/digests history shows it.

**Post-wrap additions (Jul 17, same session):**
- **User applied migrations 0013–0018** ✓ (0019 came after — see below).
- `b605caf` **inbound-photos fix:** Resend's `email.received` webhook carries
  attachment METADATA only — the handler now pulls the real files via
  `GET api.resend.com/emails/receiving/{email_id}/attachments`
  (RESEND_API_KEY; short-lived download_urls). Without this every live photo
  email saved nothing. Resend setup fact: inbound is DOMAIN-wide (one MX +
  one email.received webhook — photos@ needs NO separate config; our handler
  routes by recipient local part).
- `be80bab` **Verified members (FEATURES item 7) — ⚠️ NEW MIGRATION 0019**
  (users.verified_at): operator-granted green check, grant/revoke on
  /admin/users only (no self-serve, by design); ✓ shows on the ad page
  ("✓ Verified seller"), the member's account page, and in chat. Perks
  deliberately later, off `getVerifiedAt`. **User must paste 0019.**
- `4e37400` **Admin add-a-member (FEATURES item 8, built, no migration):**
  "Add a member" on /admin/users creates the account, grants optional
  starting credits (ledger `grant`), and texts a one-time compliant invite
  ("To sign up, reply START" + rates/HELP/STOP/  /sms link). Deduped 1/number
  /24 h; already-subscribed refused; reply-class gates apply. 9/9 walk checks.
- `1abaa7d` **Chat nudge once per DAY (item 6 built; user decision)** — and
  **item 10 (mixed SMS+chat) ON HOLD**: chat stays web-only for now.
- **FEATURES queue grew to items 9–15** (all not started unless noted):
  9 web ad posting (decision recorded: same `maxChars` cap as SMS, price
  shown before posting, one listing picture vs web-only extras); 11 hide the
  SMS signup strip for signed-in members; 12 header messages icon + red
  unread badge/alerts; 13 modern chat threads (right/left bubbles, report-a-
  message, no links, audit-log ALL chat messages — note: reverses this
  session's chat-privacy default, stance to be documented when built);
  14 pictures in chat (media NEVER doubled onto SMS — text pointer instead);
  15 messaging performance overhaul (send-lag diagnosis written into the
  item: no optimistic UI + ~8 sequential Supabase queries on send + ~6 on
  re-render; ILIKE nudge-dedup scan the likely worst offender; fix menu
  listed). FEATURES.md item notes carry the build guidance for each.

**VERIFY EARLY NEXT SESSION (couldn't reach prod from the session
container):** (1) health shows `migration0012`–`migration0019` all applied
(**0019 is the one the user may not have pasted yet**) + digests composing
(carried from 007); (2) review-alert emails arrive post-ADMIN_EMAIL-fix
(carried); (3) a real photo email to photos@ lands as a submission on
/admin/ads (needs the b605caf deploy + MX/webhook verified in Resend);
(4) the admin invite button live (needs nothing but the deploy).

**NEXT SESSION default work order (unless the user redirects):** FEATURES
items 9 (web ad posting), 11–15 — plus the standing hardening backlog
(retry-swallow trap, DLR badges, abuse-suite pass over the conversational
flows).

**Recommended-but-unbuilt (carried + new):** (1) the retry-swallow inbound
trap (any throw after `recordInboundOnce` still permanently eats that
message); (2) persist Telnyx DLRs as delivered/failed badges in
/admin/messages; (3) graceful-degradation retrofit for PRE-0013 features;
(4) extend the abuse suite to the new conversational flows (RATE hammering,
buyer-phone spoofing, chat-nudge abuse) — none of it is brutally tested yet.

Full session detail: `Session log/008_2026-07-16/session_log.md`.

## What shipped in session 007 (committed DIRECTLY to `main`, per user)

**The "texting the number does nothing" outage — root-caused (two stacked
causes), fixed, and REAL SMS CONFIRMED LIVE end-to-end 2026-07-16** (SUBSCRIBE,
AD NEW, approve/reject notices, PIC all exercised on the user's real phone).

1. **Migration 0011 wasn't applied** while `main` (auto-deploys) read
   `users.pic_balance` on every account lookup → every inbound command 500'd
   → Telnyx's retry was swallowed by the inbound dedup → texts permanently
   eaten. **User applied 0011 (2026-07-16) — now ALL migrations 0001–0011 are
   applied.** ⚠️ The retry-swallow design trap remains (any throw after
   `recordInboundOnce` permanently loses that message; the fix — a
   processing-state column + idempotent handlers — was offered, not built).
2. **TELNYX_API_KEY was missing from the prod deployment** (the user had the
   PUBLIC key and thought it was "the key"; the API key is a separate `KEY…`
   credential). With it absent, `smsDevEcho` silently flipped the transport
   to console-log — /admin/messages showed replies "sent" while nothing real
   existed; the only genuine texts were Telnyx's campaign-keyword
   auto-responses. **Key set + redeployed 2026-07-16 → outbound live.**
   (Number's 10DLC provisioning itself completed 8:05–8:24 AM that morning.)

Diagnostics now built into the product (all dev-verified + walked):
- `/admin/sms-diag` (admin-only, not in nav): send a test SMS through the
  app's exact payload, then fetch the message's LIVE Telnyx status + carrier
  error codes by id (catches sends stuck queued/held that portal reports
  never show).
- Reason-coded webhook-rejection logs; handleInbound failure logs;
  `[telnyx-dlr]` delivery-receipt logging; `[outbound]` logs for every
  suppressed (pause/blocklist/throttle) or failed send.
- `/api/health` (CRON_SECRET view): TELNYX_PUBLIC_KEY / TELNYX_FROM_NUMBER
  (E.164 check + last-4 echo) / TELNYX_MESSAGING_PROFILE_ID posture, and a
  `migration0011` probe.

Feature sprint (same day, all user-requested, each dev-walked before push):
- **MMS photo re-hosting** (`lib/photos.ts`): picture-ad media copied to
  Supabase Storage (public `ad-photos` bucket, lazily auto-created) at
  ingest. **Attachment security policy (user decision):** only byte-proven
  jpg/png/gif/webp accepted (`lib/image-sniff.ts`, unit-tested; headers/
  extensions never trusted; SVG/HEIC/BMP/TIFF rejected); NO raw-URL fallback
  in prod; if a photo can't be saved the ad posts as text AND the
  confirmation tells the seller. Telnyx-hosted media fetched with API-key
  auth (telnyx.com hosts only). **CONFIRMED WORKING LIVE** (user saw the
  badge; photos land in storage).
- **Admin Digests tab** (`/admin/digests`): the exact next-digest lineup
  (shares `selectDigestItems()` with the composer), next slot time, queued
  outbox count, inline editing, digest history — PLUS queue controls
  (move up/down = approval-order swap; **Skip next digest** = `ads.hold_until`
  hold, **migration 0012**; Back to review = revert to pending + clear queued
  bumps; Held section with Release) and **Send early / Send extra** buttons
  ('early' composes the upcoming slot NOW under its identity — scheduled run
  no-ops, queue consumed; 'extra' sends now consuming NOTHING so the queue
  rides again at the regular slot; both labeled in the SMS header + email
  subject, email mirror + immediate outbox drain included).
- **Email edition mirrors SMS 1:1** (user decision): same slots (emailSlots
  setting removed), each email carries exactly that slot's digest via
  `getSmsDigestAdIds`; email HTML handles absolute photo URLs.
- **Ads tab**: free admin Bump (expired relists first), inline editing,
  Picture badges, bump-queued indicator; review-queue Picture badge +
  full-size link; MMS attachment links in the messages log.
- **Subscribers tab** (`/admin/subscribers`): every SMS + email subscriber
  with the time their current subscription started, newest first.
- **Account merge + double subscription** (`/admin/users` detail → "Merge /
  link identities"): a PHONE does a FULL merge (ads, credit ledger, passes,
  strikes, PIC bank, saved card, subscription state move to the survivor;
  survivor wins conflicts; loser deleted; the message audit log is never
  rewritten). An EMAIL links the address + its subscription to the member
  (absorbs email-only signups) → subscribed to BOTH editions.
- **Engine/UX**: fresh SUBSCRIBE/START now gets a practical welcome (digest
  times from settings + AD NEW example — the compliance opt-in text is
  Telnyx's registered campaign auto-response, which fires on keywords);
  PIC on a pending ad tells the OWNER "not yet approved" (strangers still
  get no-ad-found); PIC media URLs absolutized; review-alert email embeds
  the ad photo inline; website price fix ("$10k OBO" rendered $10 — pure
  `lib/ad-display.ts`, unit-tested). Unit suite 107 → **129 checks**.

**Migrations:** 0011 applied (2026-07-16). **0012 (`ads.hold_until`) written
this session — the user was applying it at session end** after it caused the
day's second migration race: the deploy reached prod before the paste,
/admin/digests 500'd and the cron crashed at compose, so **the 4 PM ET
digest was missed; it self-heals on the first cron tick after 0012 lands**
(the slot's digest row exists un-finalized → the composer redoes it).
`/api/health` (CRON_SECRET) now probes 0011 AND 0012. **VERIFY EARLY NEXT
SESSION: health shows `migration0012: {applied: true}` and digests are
composing again** (Digests tab → Recent digests).

**Ops notes discovered:** the digest cron IS firing (slots composed on
schedule since Jul 14 — the LAUNCH §A5 "set up a pinger" item appears
already satisfied; confirm what's pinging, likely Vercel cron on a paid
plan). ADMIN_EMAIL had a typo (`prontonmail.com`) — user was told to fix the
Vercel env var + redeploy; **verify the review alerts actually arrive now**.

**NEXT SESSION (user request): add the ability to DELETE an ad from the Ads
list in the admin dashboard.** Design note: digest_items/bumps/ad_photos
reference ads — decide soft-delete vs cleanup vs forbidding deletion of
broadcast ads (see session log for details).

**Recommended-but-unbuilt follow-ups:** (1) schema-dependent features should
degrade gracefully instead of 500ing when their migration is missing (twice
bitten today); (2) the retry-swallow design trap (any throw after
`recordInboundOnce` permanently eats that inbound message); (3) persist
Telnyx delivery receipts ([telnyx-dlr] logs exist) into /admin/messages as
delivered/failed badges.

Full session detail: `Session log/007_2026-07-16/session_log.md`.

## What shipped in session 006 (branch `claude/stress-test-pic-limits-ki1jf0`)

Two asks: (1) brutal failure-case testing, and (2) a PIC request limit with an
admin control. **Both shipped, dev-verified; ⚠️ migration 0011 must be applied.**

- **PIC daily allowance + rolling/sinking bank — the real MMS cost control.**
  Every number gets `picDailyAllowance` photo pulls per ET calendar day (default
  **3**); unused pulls bank up to `picBankCap` (default **20**). Admin-tunable on
  `/admin/settings` ("Picture pulls per number per day" + "Most picture pulls a
  number can bank"); set the daily number to 0 to turn the quota off (falls back to
  the hourly cap alone). Pure accrual math in **`lib/pic-quota.ts`** (unit-tested,
  20 checks); atomic accrue-then-spend via **`reserve_pic_quota`** (advisory lock,
  **migration 0011**) in prod and a file-store equivalent in dev. Enforced in the
  engine's PIC handler only once a photo is actually about to send (a mistyped id
  never burns a pull); accountless pullers are `ensureAccount`'d first so the quota
  applies to everyone. Denial ("you're out of picture pulls") is a friendly SMS
  deduped to 1 / 3h / number. The hourly `smsPicsPerHour` cap stays as a burst
  limiter on top. **Documented on `/admin/help`.**
  - ⚠️ **Product-behavior heads-up:** with the default 3/day ON, a buyer can pull
    only 3 photos/day. Generous for a flip-phone audience, but if photo-browsing is
    core, raise the daily number (or the bank) on Settings, or set daily to 0. This
    is a live product decision — the control is there to tune.
- **Command re-route fix:** `AD SOLD 1325` (and `AD BUMP/STATUS/PIC <id>`) now parse
  as the owner command, not an ad whose body is "SOLD 1325". Before, a mistyped SOLD
  silently posted a junk pending ad and burned a credit/free pass. Narrowly scoped
  (only an exact `verb + number` body re-routes; a real ad that merely starts with
  the word is untouched). Parser unit tests added.
- **Brutal abuse suite extended to 19 vectors** (`npm run test:abuse`), all bounded.
  New: SOLD same ad ×20 (idempotent, tail silenced), `AD SOLD <id>` ×20 (0 junk ads,
  0 credits burned), PIC hammer 5 days with quota ON (**3 MMS/day**), PIC rolling bank
  (idle 2 weeks → burst delivers **20** = the cap, not infinity). `docs/abuse-test.md`
  rewritten. `npm test` now **107/107** (added the `pic-quota` + parser checks).
- **Migration numbering:** stayed ascending (`0011_pic_quota.sql`) to match the ten
  existing files, re-runnable per repo convention. (The descending `9999_` rule in
  `new_session_instructions.md` §4 is a different project — HANDOFF says ask before
  adopting it here; kept ascending, flagging for the user.)

## What shipped in session 005 (branch `claude/audit-continuation-qb7i83`)

Continued + finished the three-round audit. **Round 2 (function) COMPLETE, Round
3 (profitability) COMPLETE.** Plus the deferred starter-grant decision.

- **Starter free-ad grant deferred to first `AD NEW`** (user decision; **migration
  0010** — ⚠️ apply before merge to main; the code selects `starter_granted_at`).
  Accounts mint with 0 passes; `grantStarterAdsIfFirst` grants once on first post.
  A number that only subscribes/checks balance mints no passes. Dev-verified.
- **R2 correctness — 13 distinct bugs fixed** (65 raw findings → deduped),
  `npm test` now 79/79. Production-critical: (1) Supabase `listMessages` returned
  the OLDEST N → BUYCREDIT/YES purchase dead for any seller with >50 messages;
  (2) Supabase never expired ads → live-on-site-forever; added `expireDueAds()`
  in the digest cron. Plus: command parsing (`STOP.`/`YES.`/`/ help`), packMessages
  ceiling, settings blank→0 + midnight-slot, digest double-send on bookkeeping
  error, email exempt from the SMS budget, blocklist 500-cap, set-password ticket
  path, admin ad-# search, email body dup, expiry-date display. See
  `Session log/005_*/session_log.md` for the full list.
- **R3 profitability — `docs/profitability.md`** (code-grounded model). Bottom
  line: profitable to ~150 free subs at current pricing, then underwater as the
  free list grows. Inventories code-fixable leaks (free bumps/revive, uncapped
  PIC MMS, budget-invisible catch-up) + pricing levers + a staged scaling
  playbook. **Safety-valve code changes + pricing model await a user decision.**
- **MERGED to `main` 2026-07-09** (fast-forward `6d85c1f → ba3b9e5`); prod
  auto-deploys `main`. **Migration 0010 applied by the user** before/at merge, so
  the `starter_granted_at` reads are safe. `claude/audit-continuation-qb7i83` and
  `main` are identical at the merge. (Heads-up: a **stale local `main`** pointing
  at an ancient session-001 commit surfaced during the merge — realigned to
  `origin/main`; the FF push went via `branch:main`, not the local branch.)
- **Brutal abuse suite added** (`npm run test:abuse`, `test/abuse/brute.mjs`,
  `docs/abuse-test.md`): 15 attack vectors, all bounded. Empirically confirms
  `bumpCost>0` closes the free-rebroadcast/revival leak.
- **⚠️ Still open:** `bumpCost` is still `0` (the raise was discussed but never
  committed). R3 safety-valves + the pricing model still await a decision.

## What this project is

The Plain Exchange (repo codename **TheProductEngine**): an SMS-first
classifieds marketplace for the Plain community and people without
smartphones. Launch target: Holmes County, Ohio. Sellers text ads (with MMS
photos) to a number; a human approves each ad; approved ads broadcast in the
daily SMS digests (default 2/day, admin-set) and list on the website AFTER
they've gone out in a digest; buyers pull photos with `PIC ####`. Sellers fund
it via ad credits; subscribers are free. There is
also an email edition. Strategy/design context: `PRODUCT.md` (who/why),
`DESIGN.md` (visual system, "The Plain Ledger"), `initial plan.txt` (the
original seed).

## Current state (end of session 003 — 2026-07-08)

**`LAUNCH.md` is the live go-live checklist; `SECURITY-TODO.md` is the audit
+ remediation status. Read those two first.** The whole v1 surface is built
and dev-verified. Every code item on SECURITY-TODO is closed (session 003
shipped the digest outbox build + a verification-pass round of fixes — see
below); two items are deferred to a product decision. What remains is ops
(migrations 0006 + 0007 / keys / DNS) + one non-blocking build (photo
re-hosting).

**Deployment (resolved).** One Vercel project, `the-product-engine`. The
morning's `mkdir '/var/task/.data'` 500s and the "two deployments / example
ads" mystery were both **one bug: the Supabase key env var was typo'd
`SUPBABASE_…`.** Fixed → `/api/health` on both `www.theplainexchange.com` and
`the-product-engine.vercel.app` now read identically: `mode: supabase`,
`sb_secret (correct)`, `configTable.ok rows 16`, and all secrets `true`. The
app's built-in demo fixtures were the "example ads" (fixtures mode); gone now
that Supabase is connected.

**Env vars set in prod:** SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (sb_secret),
SESSION_SECRET, ADMIN_PHONES (3306001834), CRON_SECRET, SITE_URL
(`https://theplainexchange.com` — apex; make www primary in Vercel Domains and
keep SITE_URL matching), all TELNYX_* incl TELNYX_PUBLIC_KEY, RESEND_API_KEY.
**Not yet set:** STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET, ADMIN_EMAIL
(new-ad notifications). Admin account CLAIMED (password set for 3306001834).

**Migrations:** 0001 (init), 0002 (analytics), 0003 (credit_ledger.ref
unique), and 0005 (abuse hardening) all applied by the user (confirmed start
of session 003: "ran all the migrations"). `seed-production.sql` run (config
rows = 16). **⚠️ `0006_digest_outbox.sql` AND `0007_ad_broadcast_at.sql` NOT
yet applied** — both written in session 003 and REQUIRED before the
session-003 code deploys. 0006: every digest run writes `digests.item_count`
and delivers through the `digest_outbox` table + its RPCs
(`claim_digest_outbox`, `outbox_segments_since`) and inserts the
`digest_daily_segment_budget` config row (17th). 0007: adds `ads.broadcast_at`
(the digest builder reads it to find never-broadcast ads; backfilled). The
ad reads and the cron error until both are run.

**Telnyx 10DLC:** campaign **resubmitted 2026-07-08, now Pending Telnyx Review**
(Campaign ID `4b30019f-3dbf-6353-9dbf-2586aedd7f66`, TCR `CTSE7B5`, Marketing use
case). The prior **806** rejection ("needs compliant/accurate CTA info: opt-in
path, HELP, STOP, frequency, msg&data-rates disclosure, privacy link") was the
thing the session-004 `/sms` CTA build addressed — it is a HISTORICAL failure
reason shown on the record, not a new one. **Verified 2026-07-09 (session 005):
the CTA surface is fully compliant** — `/sms` (the submitted opt-in URL) carries
all six required elements, and the homepage subscribe-strip + footer repeat the
opt-in path / "up to 4/day, varies" / "msg & data rates may apply" / HELP / STOP
/ `/sms` link. Registration path: Telnyx review → TCR → MNO (carrier) review, then
active; typically hours to a few business days, T-Mobile slowest. Real A2P sending
stays blocked until approved → then text HELP as the go-signal. (Brand + campaign
were recreated after the Aug-2025 failure — brand-level "does not qualify," fixed
by a Standard EIN brand.) **HELP-number is NOT a mismatch** (session-004 note was
wrong): the registered HELP message lists (234) 301-0048, which is exactly what
the app sends via `site.supportPhone`. Number
**(330) 960-7170** (real number now everywhere; replaced the 555 placeholder).
User reports the dead Supabase webhook URL swapped → should be
`https://www.theplainexchange.com/api/telnyx/inbound` (v2), failover the
vercel.app one. **Production is in REAL-SMS mode** (TELNYX_API_KEY set); once
carriers approve, sign-in codes + inbound replies go live — verify by texting
HELP. Until then, on-screen sign-in codes are OFF in prod (dev tools gated
behind `ENABLE_DEV_TOOLS`, see security build below), so use the password.

**Domain:** theplainexchange.com at Namecheap, attached to Vercel. Make www
the primary domain (apex redirects), align SITE_URL. Legal pages
(`/privacy`, `/terms-and-conditions`) + `/faq` live for TCR compliance links.

## What shipped in session 002 (all merged to main)

- **Deploy + admin fixes:** CLAUDE.md wired so `new_session_instructions.md`
  loads every session; `isAdminPhone` normalizes ADMIN_PHONES.
- **Legal/help pages:** `/privacy`, `/terms-and-conditions`, `/faq`, and an
  admin `/admin/help` (why-it's-built-this-way doc, live tunable numbers).
- **Stripe payments (real):** hosted Checkout (`/account/checkout` →
  `startStripeCheckout`), signature-verified webhook `/api/stripe/webhook`
  (idempotent on `credit_ledger.ref`, amount check), order-complete page
  `/account/checkout/success`. Raw-fetch, no SDK. Saves card off-session +
  `stripe_customer_id` for future /BUYCREDIT.
- **Admin Reports** (`/admin/reports`): SMS/email subscriber counts, new-subs,
  ads posted, recent subscribers, + a cookieless server-side **visit counter**
  (`lib/analytics.ts`, migration 0002). **New-ad email alerts** to ADMIN_EMAIL
  (`lib/notify.ts`).
- **Security hardening** (SECURITY-TODO P0/P1.5/P2): fail-CLOSED secrets
  (SESSION_SECRET/Telnyx/CRON in prod); dev tools (on-screen codes, /dev/*,
  simulate-payment) gated behind `ENABLE_DEV_TOOLS` (`lib/env.ts`); Telnyx
  replay window; open-redirect fix; config clamps; SOLD-on-pending blocked;
  refund delimited-match; Stripe amount check; image host allowlist
  (`next.config.ts`).
- **Abuse & money-race hardening** (migration 0005): atomic `reserve_sms` +
  `spend_credits` RPCs (advisory locks) replace read-then-send/read-then-spend
  races; bump charging honors `bumpCost`; double-refund guard
  (`rejectAdRecord` returns whether it transitioned); race-safe inbound dedup
  (unique `provider_id` + `recordInboundOnce`); reservation moved BEFORE route
  (over-cap command dropped whole, never charged silently); STOP always
  unsubscribes, confirmation deduped; no account minted by STOP/gibberish.
  **Adversarially reviewed by parallel agents; 2 confirmed bugs found + fixed.**
- **SMS ad-packing composer** (`lib/sms-segments.ts`, `composeDigestMessages`):
  GSM-7 sanitize + pack whole ads into fewest single-SMS messages. **Cost
  reality learned:** the current one-concatenated-message digest is already
  near-minimal on billed *segments*; packing is ~segment-neutral. Real savings
  = emoji/Unicode containment (16 vs 22 seg) + no accidental MMS. NOT yet wired
  into the send path (that's the delivery rework below).

## What shipped in session 004 (branch `claude/app-audit-three-rounds-ypaa3e`, all on `main`)

A three-round audit (security → function → profitability). **Round 1 (security)
COMPLETE; Round 2 (function) IN PROGRESS; Round 3 (profitability) NOT STARTED.**
Session state at wrap:

- **10DLC MNO 806 fix (carrier rejection):** the campaign failed MNO review for
  an unverifiable opt-in CTA. Fixed: a canonical `/sms` "Text message program"
  page carrying all six required disclosures + homepage/how-it-works/footer
  disclosures + a marketing-disclosing opt-in confirmation (`OPT_IN_CONFIRMATION`
  in engine.ts, kept GSM-7). Full campaign-field copy (Description, Message
  Flow/CTA, opt-in/HELP/STOP messages) delivered in chat — Template #4 (keyword
  opt-in). **User ran the migrations + resubmitted the campaign 2026-07-08.**
  ⚠️ OPEN: registered HELP message had support # (330) 203-1031 but the app sends
  `site.supportPhone` (234) 301-0048 — must match; confirm which is real.
- **Operator controls** (migration 0008): two-level PAUSE (`bulk`/`all`), UNDER
  ATTACK mode (suppress-unknown + auto-tighten caps + per-minute throttle),
  number blocklist (one-click from `/admin/insights`). Single outbound choke
  point `lib/outbound.ts`.
- **Content filter** (`lib/content-filter.ts`): emoji stripped + links flagged
  for review at ad ingest.
- **Round 1 security: 16 of 17 confirmed findings fixed** (see next block).
- **Unit test suite added** (`npm test`, 69 checks green): segments/commands/
  dst/phone — the cost/launch/ownership-critical pure logic. `etParts` extracted
  to pure `lib/et.ts` so the DST test guards the real code.
- **Round 2 (function) audit LAUNCHED but not completed this session** — the
  adversarial workflow (11 correctness dimensions) was running in the background
  at wrap. Re-run it next session:
  `Workflow({scriptPath: ".../workflows/scripts/function-audit-r2-wf_8923b4d2-8d7.js"})`
  (script also under the session dir). A manual pass already cleared 4 pure
  areas (69/69) — those are now the committed test suite.
- **Round 3 (profitability): not started.** Break-even ≈ $1.65/credit @ 150 subs
  (from session 003's xlsx); the new test suite verifies the segment cost math
  the model rests on.

The operator-controls detail below (dev-verified 14/14 + `tsc`/`next build`):

- **Content filter at ad ingest** (`lib/content-filter.ts`): emoji/pictographic
  chars stripped from the stored+broadcast body (raw kept in the audit log);
  URLs/bare domains **flagged for manual review** (not stripped/auto-rejected)
  with a badge in the review queue. `mayPostLinks()` is the seam for a future
  verified-advertiser tier. Detector avoids false-flagging phones/prices.
- **PAUSE switch, two levels** (`lib/settings` `pauseMode`, `/admin/settings`
  System controls): `bulk` (PARTIAL — digests + catch-up off; replies, PIC,
  sign-in codes, STOP confirms on) and `all` (FULL — every subscriber/user
  outbound off; inbound still logged; operator alerts still send; admin signs
  in by password). Queued digests wait + resume on Resume.
- **UNDER ATTACK mode** (`underAttack`): suppress unknown/gibberish replies +
  skip catch-up, auto-tighten SMS caps (`effectiveSmsCaps`), global per-minute
  outbound throttle (`outboundThrottlePerMin`); the digest drain also caps
  sends/run.
- **Blocklist** (`lib/blocklist.ts`, **migration 0008**): blocked inbound
  logged for forensics then dropped before any account/reply/charge; excluded
  from digest recipients + all outbound. One-click block from `/admin/insights`
  (ranked worst senders), manage on `/admin/settings`.
- **The single outbound choke point** (`lib/outbound.ts` `dispatchSms` /
  `dispatchEmail`): all 10 non-digest send sites routed through it; the digest
  drain enforces pause/throttle at batch level so paused rows stay queued
  (never failed). Operator alert emails are class `operator` — never blocked.

**Security round-1 fixes (all on `main`, dev-verified, code-review batch):**
A 65-agent adversarial audit found 17 confirmed holes (4 P1, 4 P2, 9 P3);
fixed in three batches — (1) **consent enforced at send time** (STOP/block/unsub
purge queued digest rows via `cancelQueuedOutboxFor`; drain re-checks the
blocklist), **login-OTP routed through the global SMS breaker** (unauth `/login`
could pump unbounded SMS → 10DLC-suspension risk), email `eq` not `ilike`;
(2) **catch-up cost breaker + STOP/START dedup**, ad-title phone-PII masking;
(3) **OTP verify made atomic** (`verify_login_code` RPC — **migration 0009**),
**`/api/health` detail gated behind CRON_SECRET**, **email-in is now double
opt-in** (spoofable From no longer enrolls anyone; confirm/unsubscribe are POST
buttons, not GET side-effects). Blocklist/outbox reads fail safe if their table
is missing. **Deferred (need your call / low sev):** #9 login account-existence
oracle (inherent to password-vs-OTP UX). **Migrations 0006/0007/0008/0009 ALL
applied** (user confirmed 2026-07-08/09 — all migrations run; OTP verify is live).

## What shipped in session 003 (branch `claude/security-todos-noq7gf`)

**The digest columnar-delivery build — the last big SECURITY-TODO item.**
Migration `0006_digest_outbox.sql` (⚠️ run before deploying) + code:

- **Outbox delivery:** composing a due slot enqueues one `digest_outbox` row
  per (subscriber, message part); the cron drains bounded batches (50/claim,
  8 concurrent sends) in columnar order — every subscriber gets part 1 before
  anyone gets part 2 — with `maxDuration=60` and an internal ~45s budget, and
  RESUMES next tick. Timeouts can no longer half-send a digest; enqueue and
  claim are idempotent/race-safe (unique key + `FOR UPDATE SKIP LOCKED` RPC,
  10-min stale-claim reclaim). Failed sends retry ×3 then park as `failed`.
- **Packing composer wired in** (`composeDigestMessages` now feeds the real
  send path): GSM-sanitized, whole ads packed under a 612-septet ceiling —
  an emoji can't flip a broadcast to UCS-2 pricing.
- **Digest circuit breaker:** `digestDailySegmentBudget` (new admin setting,
  default 12,000 billed segments per rolling 24h, clamp 100k, 0 = pause).
  On trip: sending halts, rows wait, admin emailed once (alert fires only on
  the crossing run or a fresh enqueue — no 5-min spam). `/admin/help`
  documents it.
- **1000-row truncation fixes:** `listSubscriberPhones` / `listEmailRecipients`
  / `getCreditBalance` paged (subscribers past 1000 get digests; balances no
  longer summed from a 1000-row prefix).
- **Email edition** rides the same outbox (per-recipient signed unsub links,
  0 segments — exempt from the SMS budget).
- **Small fixes:** `digestsSentOnDay` parity (SMS-with-items in both stores —
  email/empty slots can't suppress the STOP footer); ad-id parser takes the
  full digit run (`SOLD 12345678` no longer truncates to #123456).
- **Verified:** 27/27 dev scenario checks (enqueue/drain, multi-part packing,
  footer rules, resume, breaker trip + recovery, email path, idempotent
  re-runs) + a breaker-trip alert walk. `tsc` + `next build` clean.

**Then a 7-agent adversarial re-audit** verified every SECURITY-TODO item
against the code (not the checkboxes) and caught gaps behind items marked
done — all fixed on `main` (commits `23446b2`, `f0cd97b`), 12/12 re-verified
in dev:
- **Digest ad starvation (Supabase):** new PAID ads could silently never
  broadcast (`getNewDigestAds` scanned the cap×3 oldest approved ads and
  Supabase never expires approved ads). Fixed with `ads.broadcast_at`
  (**migration 0007**).
- Open-redirect tab bypass (`/⇥/evil.com`); SOLD/revive store-level status
  guards (were engine-only); photo ingest host allowlist (scheme-only before,
  `//evil.com` passed); paged `getPendingAds`/`getSmsAdIdsSince`/`getLedger`
  (1000-row cap); dev-only echoes (email confirm link, plaintext OTP storage)
  now gated on `devToolsEnabled` not a missing key.
- **Two items deferred to a decision** (see SECURITY-TODO "Verification pass"):
  whether to defer the 3 starter free-ads from first contact to first post,
  and whether to rate-limit inbound audit logging (recommend NOT). Everything
  else on SECURITY-TODO is closed in code.

## Remaining work

**Ops (before/at launch — see LAUNCH.md):** ~~run migrations~~ **all migrations
0006–0009 applied 2026-07-08/09**;
set up the cron pinger (Vercel Hobby crons are daily-only — external GET
`/api/cron/digests` every 5 min with `Authorization: Bearer <CRON_SECRET>`);
Stripe test purchase → live keys; set ADMIN_EMAIL (also receives the new
digest-breaker alerts); Resend domain verify + real CAN-SPAM mailing address
in `lib/email-digest.ts` (`BUSINESS_ADDRESS`, still "PO Box 000"); make www
primary; wait for carrier approval → text HELP as the go-signal; then the
~15-min smoke walk in LAUNCH.md §B.

**Also shipped later in session 003 (on `main`):**
- **Email-in subscribe:** `subscribe@theplainexchange.com` → `/api/email/inbound`
  (Resend Inbound, Svix-verified, `RESEND_WEBHOOK_SECRET`, fail-closed) →
  direct-subscribe + welcome. Ops: add the inbound address in Resend + set the
  secret.
- **Admin insights** (`/admin/insights`): top advertisers, who-texts-most,
  excessive-PIC flags (`picAbusePerDay` setting, default 15/day), engagement
  leaderboard, ad funnel, most-bumped ads; 7/30/90-day window.
- **⚠️ Prod incident + hardening:** a `main` auto-deploy landed the broadcast_at
  code before migrations 0006/0007 ran → shared `AD_SELECT` hit a missing
  column → `/admin` 500'd. Fixed by not selecting broadcast_at in the shared
  reader (only the digest builder needs it). **Rule going forward: run additive
  migrations before/with merging schema-dependent code — prod auto-deploys
  `main`.**
- **Support phone `(234) 301-0048`** (`site.supportPhone`): the "call for
  help / to arrange payment" number, distinct from the SMS number people text.
- **BUYCREDIT by text + saved-card discount:** `BUYCREDIT <pack>` quotes a
  discounted price (new `savedCardDiscountPercent` setting, default 10%) and a
  `YES` charges the saved card off-session (`payments.chargeSavedCard`).
  Idempotent via a deterministic ledger ref (no new table); dev-simulated,
  gated on ENABLE_DEV_TOOLS. **The live off-session Stripe path needs a real
  test once Stripe keys are set.**
- **New-subscriber catch-up:** SUBSCRIBE/START sends the most recent digest's
  ads immediately (`sendRecentDigestTo`), best-effort, once per real
  (re)subscribe.
- **Digest default set to 2×/day** (`slots [7, 18]`). Note: slot count is a
  subscriber-frequency choice, NOT a cost lever — each ad broadcasts once/day
  regardless of slot count, so 2× and 4× cost about the same (more slots only
  repeat the short header). Prod DB still has the 4-slot value; change on
  `/admin/settings` if you want 2×.
- **Site shows ads only after they've run:** the public homepage + ad detail
  now require `broadcast_at` (an ad appears on the website only once it has
  gone out in a digest). ⚠️ Consequence: the public site is empty until the
  digest cron actually composes digests — so the external cron pinger
  (LAUNCH §A5) is now also what populates the website, not just SMS.
- **Ops artifact (not in repo):** a cost/pricing calculator xlsx was delivered
  to the user (break-even ≈ $1.65/credit at 150 subs / $0.008 SMS / $0.035 MMS;
  digest broadcast cost dominates and scales with free subscribers). Offer to
  commit it under `docs/` if they want it versioned.

**Build still pending (non-security):** **photo re-hosting to Supabase
Storage** on inbound MMS (reliability; the image-host allowlist already lets
Telnyx/Supabase photos render). Cost/throughput reality for scale, unchanged:
1500 subs × ~7 seg × 4 slots ≈ ~$5k/mo, and T-Mobile's 2000/day unvetted cap
arrives well before 1500 subs → external vetting (~$40) becomes mandatory;
the segment budget (default 12k/24h) must be raised deliberately as the list
grows.

## How the code is organized (the seams)

Everything externally-provided sits behind a swappable seam. Dev
implementations activate automatically when the provider env var is absent:

| Concern | Interface / switch | Dev implementation | Production |
|---|---|---|---|
| Data | `lib/db.ts` `supabaseConfigured` | JSON files in `.data/` (gitignored) | Supabase via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| SMS | `lib/sms.ts` (`smsDevEcho`) | console log + on-screen code echo + `/dev/sms` simulator | Telnyx via `TELNYX_API_KEY` etc. |
| Email | `lib/email.ts` (`emailDevEcho`) | audit-log capture + `/dev/email` viewer | Resend via `RESEND_API_KEY` |
| Payments | `lib/payments.ts` (`paymentsDevMode`) | simulated checkout page | Stripe hosted Checkout via `STRIPE_SECRET_KEY` + webhook `/api/stripe/webhook` via `STRIPE_WEBHOOK_SECRET` (BUILT session 002 — raw-fetch, no SDK; grants idempotent on `credit_ledger.ref`; card saved off-session + `stripe_customer_id` stored for the future /BUYCREDIT charge) |

Dual-mode modules pair as `lib/X.ts` (types + file impl + dispatch) and
`lib/X-supabase.ts`: `ads`, `store` (accounts/credits/codes),
`engine-store` (mutable ads/digests/bumps/messages). Engine logic:
`lib/engine.ts` (inbound commands), `lib/digest-engine.ts` (SMS slots),
`lib/email-digest.ts`, `lib/moderation.ts`, `lib/commands.ts` (parser).
Runtime-editable config: `lib/settings.ts` (admin `/admin/settings` edits it;
engine reads it live). Fixtures/seed data: `lib/fixtures.ts` ↔
`supabase/seed.sql` (keep in sync). Cron: `vercel.json` hits
`/api/cron/digests` every 5 min (SMS digests then email edition; idempotent).

**Dev-mode warning:** with no `TELNYX_API_KEY`, sign-in codes render
on-screen — anyone with the URL can log in as any number, and `/dev/sms` /
`/dev/email` are live. The deployment is not for public eyes until Telnyx is
configured (which disables all of it automatically).

## Product rules (grilled + confirmed 2026-07-06; do not relitigate)

> **⚠️ FROZEN — describes the CREDIT era.** Session 016 replaced credits with
> dollars, retired BUMP, and made SMS instant instead of a 4-slot digest. Read
> the session 016 addendums at the top of this file for what is true now; this
> section is kept as the record of what was decided when.

- One credit = one broadcast in the next digest; ad lists on site 30 days
  (config). Text ad 2 credits, picture 10 (defaults raised session 011; the user
  also set the live values on /admin/settings), starter grant 3 ads flat — all
  admin-config. `/PIC` pulls charge no credit but are rate-limited:
  `picDailyAllowance`/day (default 3) per number with a rolling bank up to
  `picBankCap` (default 20) — session 006, admin-tunable, 0 disables; also
  bounded by `smsPicsPerHour`. Digests: 4 ET slots, skip empty, cap 10
  FIFO; bumps free at the default `bumpCost` 0 but the engine now CHARGES
  `bumpCost` when an admin sets it > 0 (session 002); one queued per ad,
  after new ads.
- Manual review of every ad; admin can edit text; word filter flags (or
  auto-rejects per word). Benign rejection = full refund; violation = charge
  kept + strike; 3 strikes = posting-only ban (reversible in admin).
- Accounts keyed on internal id; phone and email nullable-unique (selling
  requires phone); auto-created on first inbound SMS with starter grant.
- Website: public browse; phone numbers masked until sign-in; posting is
  SMS-only in v1. Every message in/out is logged to the audit table.
- Future (bones exist, don't build unless asked): per-county subscriptions,
  premium ads, subscriber fees, website posting, `/CANCEL`.

## Testing conventions

Verification = scripted Playwright walks (chromium is installed as a dev
dep). Pattern: write `shoot.tmp.mjs` at repo root (module resolution needs
it inside the project), run against `npx next start -p 3311`, delete after.
Reset state with `Remove-Item .data -Recurse`. Gotchas learned the hard way:

- `innerText` returns CSS-transformed text — status chips are uppercase
  (`SOLD`, `FLAGGED`); match `/sold/i`, never `"Sold"`.
- Server-action redirects to the *same URL* make `waitForURL` resolve
  immediately with stale DOM; poll for content change instead.
- `textContent("body")` includes RSC bootstrap `<script>` payloads (stale
  page text); use `innerText`.

## Provisioning checklist

**Superseded by `LAUNCH.md`** — the ordered, checkbox go-live list (env,
migrations, cron, Stripe, Telnyx, the launch-day SMS smoke walk). Keep that
file as the single source of truth; don't maintain a second list here.
Reference notes that still matter: Vercel **Hobby crons are daily-only** (use
an external pinger); Telnyx unvetted T-Mobile cap ~2,000 msgs/day, ~$41.50
external vetting raises it; sole-prop-with-EIN registers PRIVATE_PROFIT, legal
name exactly per IRS CP-575, no LLC required.

## Repo & etiquette notes

- Remote: `github.com/RadioDinner/TheProductEngine`, branch `main`. The user
  owns all GitHub/visibility decisions — **do not raise repo visibility
  again**; it was flagged and acknowledged.
- `new_session_instructions.md` governs sessions (session log folder, live
  prompt history, this file). §5 (CoachAccountable API docs) is another
  project — no CA code here. §4 (descending migrations) **was adopted in
  session 009 by user decision**: files renamed to descend from `9999_init.sql`
  (map in `supabase/migrations/README.md`); the next migration takes
  (lowest existing − 1). Write every migration re-runnable (hand-pasted into
  the SQL editor; never `supabase db push`).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The `.agents/.claude/.codex` skills tooling is gitignored and reinstallable
  via `npx skills add mattpocock/skills` (`skills-lock.json` is committed).
