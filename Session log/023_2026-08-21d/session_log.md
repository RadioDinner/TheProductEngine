# Session 023 (2026-08-21d) — AN AD IS PAID FOR WHEN IT RUNS, and the copy became editable

**Version 1.5.11 → 1.6.11** (§6: six features and one of them changes how money
moves through the whole service, so the SECOND digit moved. Bumped from what
was on `origin/main` at MERGE time, per §8b — the value at session start was
1.4.9 and would have been wrong.)

## ⚠️ This session ran for three hours beside two others, and that shaped the end of it

The user said mid-session *"Dont commit anything until I tell you to,"* then,
when they came back: *"Take a look at main and see if you can commit. You took
almost 3 hours to run, so my main branch is ahead."* It was 17 commits ahead,
carrying two whole sessions (021 and 022) — and §8 of
`new_session_instructions.md`, the parallel-session protocol, had been WRITTEN
on main during those three hours by one of them.

**Every single counter §8 warns about had collided**, which is a fair
demonstration that the protocol is right:

| Counter | Collision | Resolution |
|---|---|---|
| Migration number | main took `9951` for `test_ads`; I had `9951_charge_on_run` and `9950_message_templates` | mine renumbered to **9950** and **9949**; `npm run check:migrations` clean |
| `Session log/NNN` | 021 AND 022 both claimed while I ran | mine became **023_2026-08-21d** |
| `FEATURES.md` item | main took 48 for Test mode; I had 48–51 | mine renumbered **49–52** |
| `version` | I bumped from 1.4.9; main was at 1.5.11 | rebumped **1.5.11 → 1.6.11** |
| `HANDOFF.md` | session 021 SPLIT the file (narrative → `HANDOFF-ARCHIVE.md`) while I was writing a long narrative section into the old shape | took main's structure wholesale; kept only what a future session needs on day one; the narrative is this file |

The lesson worth carrying beyond the mechanics: **the merge was easy and the
counters were hard.** Six files conflicted and every one was resolvable in
minutes. The damage would all have come from the four collisions that merged
CLEANLY — two migrations wearing the same number is the one that would have
gone unnoticed for weeks, exactly as §8c predicts.

One thing came back the other way. Session 022 found that PostgREST answers a
missing table with **PGRST205**, not Postgres's 42P01, and that every
table-level fallback written against 42P01 alone had silently failed. My
`message-template-store.ts` had exactly that bug; it is fixed here because of
their work.

## What the user asked for

Three asks, in the order they arrived:

1. *"When people create an ad, and have a card on file, I want the confirmation
   message to include that the card won't be charged until the ad is run. Make
   the system honor the truth of this message."*
2. *"Also, I want an admin tab where I can go in and edit the messages and add
   or remove variables from auto replies, rather than having a code/prompt
   session. Plus, I can see the messages."*
3. Mid-build, after hitting it live: they were shown the held-ad reply for ad
   #1024, then approved an ad and it texted the ordinary "it goes out with the
   next batch" — *"I approved the ad, but it wasn't paid, I want the status to
   go to 'approved, pending payment' but I want the message that the seller
   gets, to remind them to pay up."*

The third turned out to be the same feature as the first, seen from the
operator's chair, and building them together is what made the whole thing
coherent.

## 1 · The charge moved from POSTING to the RUN

**This is the change to understand before touching anything else.** Until now an
ad was charged the instant the text arrived. That meant the service took money
for ads it had not yet run and sometimes never would — an ad turned down at
review was charged and then refunded, a round trip through a member's balance
for a service that never happened.

Now: **posting QUOTES a price and RESERVES it; the batch that carries the ad
out to subscribers COLLECTS it.**

- `ads.owed_cents` (migration **9950**) is the frozen quote. Not null means "not
  paid for yet", whatever the status. An ad written on Monday costs Monday's
  price however long it waits.
- `lib/ad-funding.ts` is the arithmetic, pure and unit-pinned:
  `availableCents`, `shortfallCents`, `fundingState`, `postDecision`,
  `unfundedAdCount`, `runChargePlan`, `fundingLabel`.
- `lib/ad-billing.ts` is the part that touches money: `memberFunding`,
  `cardOnFile`, `collectForAd`, `collectForBatch`, `releaseHeldAds`,
  `releasedAdsMessage`.

### Reserving is not the same as charging, and both are needed

Not charging is not the same as not counting. A quoted-but-uncollected price
stays reserved against the balance, so **$40 of credit still buys exactly two
$20 ads however many are in flight**. Without that, a member with $20 could put
five ads into the review queue, have every one approved by hand, and then
discover four of them at the till. The operator's time is the scarce thing.

`BAL` says so now: *"You have $45 of ad credit. Your ads waiting to go out will
use $40 of it."*

### Where the money actually moves, and why it is exactly there

`composeSmsEdition` in `lib/digest-engine.ts`, and the placement took two
attempts — the first one was wrong and a real end-to-end walk caught it.

**First attempt (wrong):** collect in `runQueuedBroadcasts`, before composing.
With zero subscribers matching an ad's category, the ad was charged and reached
nobody. Verified by walking it.

**What is there now:** `buildCategorizedSmsRows` is pure, so it is run TWICE —
a dry run with no pictures to learn which ads would actually reach somebody
(plus any the email edition would carry), then the collection for exactly those
ads, then the real compose for the ads that paid. An ad that reaches nobody is
not charged; an ad that cannot pay never reaches a phone. Pictures are badged
only for the ads actually going out, so an unpaid ad does not even cost an
image render.

`sendDigestNow` (the operator's "send early"/"send extra") does the same two
steps, in the same order, after identifying its digest rows — the review showed
that collecting first meant taking the money before its own early returns, and
texting "your ad just went out" to sellers whose ads reached nobody.

### The concurrency guard: three states, not two

`owed_cents` set = owing. `charge_claimed_at` set = being collected for right
now. Both null = paid. `claimAdCharge` stamps the claim and **leaves the price
on the ad**, so only the winner collects and a second pass reading
mid-collection sees an ad that owes money rather than a freebie.
`settleAdCharge` clears both once the money has moved.

⚠️ The two-state version of this was a real bug (see the review section below):
clearing `owed_cents` at claim time made "nothing owing" mean both "already paid
for, run it free" and "being charged for this second". Never collapse those
states again.

`collectForBatch` also reports CONTENTION. A pass that loses any claim abandons
the whole batch rather than composing a second one from the leftovers — every
ad with nothing owing would be in both, and subscribers would get it twice.

⚠️ **The residual risk, stated in the file header so nobody has to rediscover
it:** a card charge that succeeds at Stripe with the response lost in flight
reads as a decline, the claim goes back, and the member is charged twice — the
extra sitting on their balance as credit rather than being lost. This is the
same exposure the posting-time charge always had (`lib/payments.ts` mints a
fresh idempotency ref per attempt on purpose, so a genuine retry after a genuine
decline really does retry). Not made worse; worth fixing with a per-attempt
reference stored on the ad the day anyone sees it happen.

### A failed collection holds the ad, it does not lose it

`ads.charge_hold_until` is pushed forward by `chargeRetryHours` (default 6) so a
declined card is not presented again every five minutes, and the seller gets ONE
text (`ad.charge-failed`). Any payment clears it — `releaseHeldAds` does.

⚠️ It is its OWN column, not `hold_until`. Sharing the operator's "skip the next
digest" hold meant money arriving silently cancelled a hold they had put on an
ad by hand — found by review.

## 2 · An unfunded ad is REVIEWED, and can be APPROVED

The user's third ask. An ad the member cannot pay for now goes into the review
queue like any other, gets read, and gets a yes or a no. Approving it is the
right move: **it holds its place and goes out on the next batch after the money
lands — nobody has to approve it twice.**

- `lib/moderation.ts approveAd` checks the money and sends
  `ad.approved.awaiting-payment` instead of the ordinary approval text, and
  returns early rather than attempting a broadcast that would only decline the
  ad and text the seller a second time about the same money.
- `/admin/review` shows `$20 — waiting for payment` or `$20 — pays when it
  runs` on each waiting ad. One pass per SELLER (not per ad), in parallel and
  capped at 40, using `purseForAd` so two $20 ads on a $20 balance do not both
  read as covered — and honouring a card on file, which pays for any number of
  them when they run.
- `/admin/ads` shows `approved · waiting for payment · $20.00 due when it runs`.

**The one guard:** `maxAdsAwaitingPayment` (default 3, 0 = off). Past that many
ads waiting on money from one number, further posts are HELD out of the queue —
the session-020 `unpaid` path, unchanged. It refuses VOLUME, not poverty: a
member with money or a card may post as many as they like, because each one
pays for itself as it runs.

## 3 · /admin/replies — the auto-reply tab

28 messages, editable, with their variables. The list is the "plus, I can see
the messages" half: every automatic message in the words it will actually use,
grouped by when it happens, with its cost in texts.

- `lib/message-templates.ts` — the catalogue: key, group, label, when, default
  body, declared variables (name + what it holds + a realistic example), and
  `requires` phrases. Pure, so all of it is unit-pinned.
- `lib/message-template-store.ts` — **only overrides are stored** (migration
  **9949**). A message nobody has rewritten has no row, so a later improvement
  to a default still reaches production instead of being shadowed by a copy of
  the old text taken the day the table was created. "Reset" is a DELETE.
- `lib/messages.ts` — `messageBook()`, cached 30s per process,
  `forgetMessageBook()` on save so the operator's own next look is current.
- `components/ReplyEditor.tsx` — click a variable to insert it AT THE CURSOR,
  live preview with example values, live segment count and a UCS-2 warning.

### Three rules in that code that are not style

1. **A variable the operator deletes is deleted; a variable they invent is
   refused.** `{ballance}` would render as nothing and they would never find
   out, so every `{token}` is checked against the message's declared list —
   flagged live in the box and refused on save.
2. **Some phrases are load-bearing.** Carrier words (STOP/HELP) and DEDUP
   MARKERS: several replies are suppressed to one per number per day by
   scanning the outbound log for a substring of their own text. Edit one of
   those without keeping the marker and the message is fine while the service
   starts texting somebody the same sentence every five minutes. `requires`
   refuses the save and names the phrase.
3. **Optional clauses are their own templates**, carried by the parent as
   variables, and `renderTemplate` closes the sentence up around one that does
   not apply — no double space, no trailing gap. Newlines survive, because the
   blank lines in the welcome texts ARE the layout on a flip-phone screen.

⚠️ **A real bug found by walking it in a browser:** saving or resetting
navigates to the same route with a different query, so React kept the editor
mounted and the textarea went on showing what the operator had typed. Press "go
back to the original wording", read "put back to the original wording", and
still be looking at your own edit — one Save away from writing it back. Fixed
with a `key` carrying the stored body, which remounts on a server change and
never during typing.

**Not on the page, and it says so:** HELP and the opt-in confirmation are
answered by the CARRIER from the Telnyx messaging profile and nothing here can
read or change them; and the batch itself, which is a per-subscriber layout
packed to a segment budget rather than a sentence.

## 4 · The receipt

`ad.ran` — sent as the ad goes out, which is the moment the money moves. It is
what makes "nothing is charged until your ad runs" checkable rather than merely
stated. On by default; `adRanReceipt` on Settings turns it off. One text per ad
that runs.

## Copy swept to match

Every place that promised a charge at posting time:

- `payInstructions()` — "we'll charge it **when your ad runs**".
- The IVR consent script (`lib/voice.ts payTwiml`) — "charge it for the ads you
  place, **when each ad goes out and your ad credit doesn't cover it**". ⚠️ This
  one is deliberately NOT editable from /admin/replies: it is the stored-
  credential authorization the card networks require, it is the legal record of
  what the caller agreed to, and it is pinned by `test/voice.test.mjs`. If the
  charging moment moves again, that sentence moves in the same commit.
- The card-saved confirmation SMS and the spoken close (voice route).
- The Stripe webhook release text — "covered and will go out with the next
  batch", not "paid for". Both it and the voice route now render the same
  `ad.funded` template through `releasedAdsMessage`, because they were two
  hand-written copies of one sentence and had already drifted.
- `/account` auto-top-up panel, `/account/checkout`, `/account/post`
  confirmation (`chargeNoteLine` in `lib/post-ad.ts` rewritten around the three
  cases), `/account/ads` delete preview.
- `/refund-policy` and `/terms-and-conditions` — both now lead with "you are
  not charged until your ad actually goes out", and the refund page keeps a
  bullet for ads posted before this changed, which really were charged at
  posting and really are owed their money.

## Migrations — TWO NEW, NEITHER PASTED

**`9950_charge_on_run.sql`** and **`9949_message_templates.sql`** (renumbered
down one during the merge — main had taken 9951 for `test_ads`). `9949` is now
the newest; the next migration takes **9948**.

⚠️ **9950 is not optional the way most of them are.** Every other migration in
this repo degrades to "the feature is off". This one degrades to **no ad being
charged for at all** — the code no longer charges at posting, and without
`owed_cents` nothing is quoted, reserved or collected. `/api/health` probes it
by name and says exactly that. The code will not lose an ad or fail a text
without it; it will run every ad free — which is why `collectForBatch` halts
the whole batch instead of sending, and says so in the log.

Everything from **9951** down is already applied (HANDOFF, user-confirmed
2026-08-21), so these two are the only ones waiting. 9950 back-fills
`owed_cents` from `unpaid_cents` — the column 9953 added — guarded on that
column existing at all, so it is safe on a database where it never did.

## The adversarial review, and the six real bugs it found

The whole change was put through a review pass with every finding
independently refuted or confirmed. Eighteen survived; these are the ones that
would have cost money or stalled the service, all fixed:

1. **An ad being collected for looked FREE to a concurrent batch.** The first
   version cleared `owed_cents` at claim time, so "nothing owing" meant both
   "already paid for, run it free" AND "being charged for this second". A cron
   tick reading an ad while an approval-triggered send sat inside its Stripe
   call carried it to the whole subscriber list as a freebie — and the losing
   pass's undo then found `broadcast_at` set and silently dropped the debt.
   Fixed with a third state: `ads.charge_claimed_at` is stamped while a
   collection runs and the price stays on the ad, so a second pass sees an ad
   that owes money, loses the claim, and leaves it alone. `collectForBatch`
   also reports CONTENTION now — a pass that loses any claim abandons the whole
   batch rather than composing a second one from the leftovers, which would
   have delivered every owed-nothing ad twice.
2. **A batch whose head ad could not be paid for burned that key forever.** The
   slot key named the head of the SELECTED queue, so the first batch composed
   the ads behind a stuck ad and finalized — and from then on every pass whose
   head was that same stuck ad computed the same finalized key and skipped.
   **Nothing would ever have sent again.** The key now names the head of what
   actually goes out.
3. **The picture-upgrade undo was dead code.** Raising an ad's price then
   failing to attach the picture (because the operator approved the ad during
   the upload — the commonest way that failure happens) called `bumpAdOwed` to
   put the price back, and `bumpAdOwed` refused because the ad was no longer
   pending. The seller was told "its price is unchanged" and then charged the
   picture price for a text ad. The undo takes `anyStatus` now.
4. **`approveAd` measured the shortfall against the raw balance**, ignoring the
   member's other waiting ads — so a member with $20 and two $20 ads was told
   BOTH were on their way, and got a "we couldn't collect" text an hour later.
   That is precisely the double-text the message exists to prevent. New pure
   helper `purseForAd` measures what is left for one ad once the ads ahead of
   it have taken their share; /admin/review uses it too, and honours a card on
   file rather than labelling a covered ad "waiting for payment".
5. **`sendDigestNow` took the money before it knew the edition could be
   composed at all** — both early returns ("no slots configured", "already
   sent") sit after it — and collected for ads no subscriber's categories
   match, texting their sellers "your ad just went out to subscribers". It now
   identifies the digest rows first and runs the same reach dry-run the
   scheduled batch does.
6. **`listOwedAds` named the `unpaid` enum value from the unpasted 9953**, so
   Postgres rejected the whole query with 22P02 and it was swallowed as "no
   owed ads" — silently emptying every RESERVATION on the service and letting
   one member commit the same money to any number of ads. It retries without
   the held status now.

Three smaller ones fixed alongside: `releaseHeldAds` was cancelling the
operator's own "skip the next digest" hold because both shared `hold_until`
(the charge back-off has its own column now); `createAd`'s two retry blocks
could not survive both optional columns being missing and threw the ad away
(it is a ladder now); and a textarea's CRLF line endings meant saving the
shipped wording back stored a permanent override instead of clearing it.

Two confirmed findings are **noted rather than fixed**, both pre-existing:

- **An "extra" edition delivers to everyone and records nothing as having
  run**, so the ad stays "never-ran" and a later member delete refunds it. That
  shape predates this session (`finalizeExtraDigest` consumes nothing by
  design); charging at the run does not widen it, and only the operator can
  trigger an extra edition.
- **The web post confirmation duplicates the three payment sentences in
  code**, so /admin/replies edits do not reach it. The two lanes have always
  had separate copy; worth unifying when the catalogue next grows.

## Verified

- `tsc --noEmit` clean, `npm run build` clean.
- Unit suite **1470 → 1561** (new: `ad-funding` 50, `message-templates` 41;
  `post-ad` 11 → 15, rewritten around the three payment sentences and pinned
  with "no note claims a past charge"). On the merged tree the whole suite runs
  **1641/1641**, main's own new suites included.
- **A real end-to-end walk of the engine** (file store, frozen clock, real
  subscribers): plenty of credit, no credit and no card, approve-then-pay, card
  on file, turned down before it ran, two ads against one balance, and BAL.
  Every message printed and read. This is what caught the charge-before-
  delivery bug.
- **A real Chromium walk of /admin/replies**, 23/23: sign in, list, open, insert
  a variable at the cursor, preview, live invalid-variable warning, refused
  save, good save, "reworded" badge, reset, and the three new Settings fields.
  This is what caught the stale-textarea bug.
- Both walks re-run after every review fix, including the two-ads-on-one-
  balance case: the first ad is told it goes out, the second is told what it
  still owes.

## Things a future session must not get wrong

1. **`pending` no longer implies "paid for".** That invariant is gone and the
   comments that asserted it are updated. `owed_cents is not null` is the new
   question, and `getAdsOwed` / `listOwedAds` are how you ask it (it is NOT in
   the shared `AD_SELECT`, like `broadcast_at` and `category`).
2. **Rejecting an ad refunds nothing now, because nothing was taken.** The
   refund code stays for ads posted before 9950 and still fires for them. The
   member-facing wording is "Nothing was charged."
3. **The picture upgrade raises `owed_cents`, it does not charge.** The old
   ref-guarded ledger debit and its failed-attach refund are gone; the undo is
   `bumpAdOwed(id, -delta)`. Legacy `(picture upgrade)` ledger rows on existing
   ads still match the refund matchers in `lib/myads.ts`, which look for
   `Ad #<id> (`.
4. **The collection ledger note must keep the `Ad #<id> (<kind>)` shape.** Every
   refund matcher keys on that delimited token.
5. **`ad-billing.ts` is on the analytics test-loaded list** (it emits, and
   digest-engine imports it, so it is loaded under plain node). It must never
   import `next/server`; its callers register `after()`.
6. **A collection has THREE states, not two.** `owed_cents` set = owing;
   `charge_claimed_at` set = being collected for right now; both null = paid.
   Never collapse the middle one away — see the review notes above for what
   that cost.
7. **`releaseUnpaidAds` is gone**, replaced by `releaseHeldAds`, which admits
   held ads into review and clears failed-collection holds — and charges
   nothing. Its two callers (the voice route, the Stripe webhook) had their copy
   changed to match, and that wording is now the point.

## Open, and deliberately not done

- **The 10DLC campaign description still says 7am–9pm** at Telnyx. Carried from
  session 020, still external to this repo, still open.
- **Only 28 of the ~121 member-facing messages are editable.** The catalogue
  covers the ad lifecycle, money, the welcome, joining/leaving and SOLD — the
  ones an operator would actually want. The rest (PIC replies, ratings, chat,
  email bodies, the voice prompts) are still in the code. Adding one is a
  catalogue entry plus a `book.render` at the send site; the test enforces that
  every declared variable is either used or explicitly listed as spare, so a
  half-wired entry cannot ship quietly.
- **No per-attempt idempotency reference on the run-time card charge.** See the
  residual risk above.

## How this landed on main

The user gave the word at the end: *"merge it to main and wrap this session."*
Done per §8d — **never `git checkout main`**. `origin/main` was merged INTO the
branch (twice, as main moved during the session), the merged tree was verified,
and only then was the branch pushed to `main` as a **fast-forward**, confirmed
with `git merge-base --is-ancestor origin/main HEAD` immediately before the
push. Nothing of 021's or 022's was replayed, rebased or dropped.

Commits, oldest first:

| Hash | What |
|---|---|
| `c8c31fd` | An ad is paid for when it RUNS, and the auto-reply copy is editable |
| `24d63aa` | Merge main: charge-on-run alongside sessions 021 and 022 (the six-file conflict resolution and all four counter renumbers) |
| `1dea63a` | Merge main again — picked up `8715048`, the admin error boundary |
| *(wrap)* | This log, the prompt history and the migration-number corrections |

Final check before the push: `tsc --noEmit` clean, `npm run build` clean,
**1641/1641** unit checks, `npm run check:migrations` clean (50 local files, no
duplicates, next number 9948), working tree clean.

**The one thing standing between this and production is `9950_charge_on_run.sql`
in the Supabase SQL Editor.** It is merged, it is deployed, and until it is
pasted no ad is charged for at all. That is at the top of `HANDOFF.md` too.
