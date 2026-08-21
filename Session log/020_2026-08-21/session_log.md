# Session 020 — 2026-08-21

**The send window moves to 7am–6pm, and Saturday secretly stops at 5pm.**

## The ask

One prompt, three sentences, and the third is the one that shapes the build:

> "He said that 9pm is way too late to send ads on saturday nights and that 6
> would work for the week days. BUT I want to end the digests by 5 on saturday
> nights. I think I'll publish that the ads run 7am to 6pm Monday to Saturday
> but I want to secretly stop sending ads by 5pm on Saturdays."

Community advice, brought back by the user from a conversation with a local
Amish man. A 9pm text lands in the middle of a Plain household's Saturday
evening, which runs into the rest day.

The published hours and the real hours are DIFFERENT NUMBERS on purpose:

| | Mon–Fri | Sat | Sun |
|---|---|---|---|
| **Published** | 7am–6pm | 7am–6pm | — |
| **Actual** | 7am–6pm | **7am–5pm** | — |

Both ends are EXCLUSIVE, so the last weekday text leaves at 5:59pm and the last
Saturday text at 4:59pm.

## What shipped

**1. The published window moved 9pm → 6pm.** `smsWindowEndHour` 21 → 18 in
`engineDefaults`, and nine member-facing pages moved with it: `/`, `/sms`,
`/email`, `/account`, `/faq`, `/how-it-works`, `/privacy`,
`/terms-and-conditions`, and the compliance footer in `app/layout.tsx`. The
SMS copy (welcome text, ad-received, approval) reads the setting, so it
followed on its own.

**2. Saturday closes early, and the end hour is per-weekday now.**
`windowEndHourFor(weekday, settings)` in `lib/digest-engine.ts` returns
`smsWindowEndHour` for every day but Saturday, and `smsSaturdayEndHour` (17)
for Saturday. `smsWindowOpen` calls it — so every enforcement point inherited
Saturday without being touched: compose (`runQueuedBroadcasts`), the drain
(`drainDigestOutbox`, which is where a held backlog is stopped), the approval
reply, the paced-release stamping, the admin panels.

`Math.min(saturday, published)` is the safety rail. **The Saturday hour can
only ever pull the close EARLIER.** A fat-fingered 20 on /admin/settings would
otherwise text people past the hours the compliance copy promises every
subscriber. Under-delivering on a published window is a courtesy;
over-delivering is a broken promise.

**3. The secret is kept by a code path, not a wish.** `closedEarly(now,
settings)` is true only between Saturday's real close and the published one.
Two member-facing messages consult it and drop their hours clause in that hour
— the approval text (`lib/moderation.ts`) and the ad-received text
(`lib/engine.ts`). Without it, a seller who posts at 5:30pm on a Saturday gets
"It goes out Monday at 7am — texts only go out between 7am and 6pm, Monday
through Saturday", a sentence that argues with itself and hands over the exact
thing the shortening is meant to keep to ourselves. Both messages still say
WHEN the ad goes; the promise is kept, it just isn't recited.

**Supporting work:** `smsSaturdayEndHour` is a real operator setting (config
key `sms_saturday_end_hour`, a field on /admin/settings, a handbook entry at
`settings.saturdayClose`, `SETTING_MAX` 23). `operatorWindowLabel(settings)`
gives the admin surfaces the truth — "7am–6pm Mon–Fri · 7am–5pm Sat" — on the
dashboard health panel, /admin/digests and the /admin/settings pause notice,
because an operator who doesn't know Saturday closes at five will file the
quiet hour as a bug and go hunting for it.

**Migration `9955_saturday_close.sql`** (pasted and confirmed at session end): updates
`sms_window_end_hour` 21 → 18, guarded on the old value so a re-paste can't
stomp a later operator choice, and inserts `sms_saturday_end_hour` = 17.

## Directional decisions

- **The email edition is untouched — asked and answered.** "End the digests by
  5" could have meant the email editions (7am/noon/5pm), so it was put to the
  user directly. Answer: leave email alone. Email has never obeyed the send
  window ("an inbox has no bedtime") and still composes at all three times
  every day, Saturday and Sunday included. The Saturday 5pm edition lands AT
  five, which is what "by 5" means. **Texting is the thing that stops early.**
- **The Saturday hour shortens only.** Clamping was chosen over validation-
  on-save so a bad stored value (a hand-edited config row, an older migration)
  can never send past the published window either.
- **`smsSaturdayEndHour` is optional in `WindowSettings`.** Settings saved
  before this session then give Saturday the published close rather than a
  Saturday that never opens. Fail toward sending, not toward silence.
- **Version 1.2.8 → 1.4.9** (§6). The far-right digit moved mid-session at
  three features; the second digit moved at four; and the session then shipped
  a second wave — the call flow, error handling, voicemail-by-email, AD
  replacing AD NEW, held-unpaid ads and admin broadcasts — so the second digit
  moved again. Auditable count: twelve features. The FIRST digit has not moved
  and will not without the user saying so.
- (superseded) **Version 1.2.8 → 1.3.9** (§6). The far-right digit moved mid-session when
  the work looked like three features (published window, Saturday close, the
  copy rule). It then went past four — the operator-editable Saturday setting
  and operator label, the ledger reset, the books-opened line — so the SECOND
  digit moved as well, cumulatively, the same shape session 019 used
  (1.1.7 → 1.2.8). Auditable count: six features.
- **The money reset was put to the user before any SQL was written**, because
  the ledger is the balance. Two of the three options offered could not be
  walked back.

## Part two — the money books were reset

`/admin/money` reads EVERY `credit_ledger` row, all time, no date filter. Pre-
launch that meant it was adding up the operator testing the service on himself
and calling it income. The user's words: *"I want it reset since all the data
so far has been test data, so it's off in terms of accuracy."*

Asked before touching anything, because `credit_ledger` is append-only by
design (9966) and is what every member's balance is MADE of — deleting rows
moves real balances. Answers: **wipe to zero aside from the $40 ad credit**,
and **none of it is real money**.

`9954_reset_ledger.sql` keeps only `kind = 'grant' AND note LIKE 'Welcome %'`
(what `starterCreditNote()` writes, and what 9990 already uses to recognise a
starter grant) and deletes everything else — purchases, payments, spends,
refunds, payouts, admin invite credit, legacy adjustments. Everyone who has
had their welcome credit lands at exactly $40 granted, $0 cash.

**Verified rather than eyeballed.** Spun up a throwaway Postgres 16, built a
fixture with the ledger shapes that actually occur (welcome credit + Stripe
top-up + two spends + a refund; a cheque + a legacy adjustment + a payout; a
member with only admin invite credit), ran the migration, and fed the
surviving rows through the real `moneyPosition`/`incomeSummary`: $0 collected,
$0 earned, $0 owed, $80 credit issued across the two welcome-credit members.

**It disarms itself, and that was the main design decision.** A wipe that
re-ran on every paste would be a loaded gun in the migrations folder — a
future session told to "paste the pending migrations" would destroy real
money. First run writes `config.ledger_reset_at`; every run after does
nothing. Tested by adding "real" rows after the reset and re-pasting: they
survived untouched. Resetting again requires deleting that config row by hand.

`/admin/money` now prints "Books opened <date>" from the same stamp, so the
figures' starting point is visible rather than folklore.

### The first draft of the reset was wrong, and the user caught it

Shipped 9954 as "keep the welcome-credit rows, delete the rest". The user came
back with the live dashboard — $130 collected, $250 paid out, $256 issued, $16
earned, **$120 still unspent** — and the target: *"Everyone, all 4 users should
have paid nothing in, and have 40 in credit. My total credits given out should
be 160 total."*

$120 unspent is **three** members' worth of $40, not four. Keeping what exists
would have landed on $120 across 3 members: some members' welcome credit had
been partly spent, and at least one never had a welcome row at all. A reset
defined by what survives is only as good as what is there.

Rewritten to **wipe everything and re-grant**: delete every ledger row, then
write one fresh welcome grant per row in `users` (amount from
`config.starter_credit_cents`, worded exactly as `starterCreditNote()` does),
and stamp `starter_granted_at` so nobody gets a second one. The end state is
now a function of the users table rather than of the ledger's history, which
is the only way to hit an exact target.

Because the total is (users × $40), the migration header carries a preview
query and says to run it FIRST — if `users` holds more than 4 rows the total
will not be $160, and that is worth knowing before the wipe, not after.

The marker gained a shape (`{"at": …, "shape": "wipe-and-grant-v2"}`) so a
database that got the superseded draft is not blocked from reaching the right
state; `getBooksOpenedAt` reads both shapes.

Verified on a throwaway Postgres 16 against a fixture matching the reported
shape (4 members, only 3 with welcome credit, plus a purchase, a cheque, a
payout, a legacy adjustment): 4 × $40 = $160, dashboard $0/$0/$0/$160/$160,
re-paste disarmed with a later real payment untouched, v1 marker superseded
exactly once.

**The lesson worth keeping:** the user gave the end state in plain numbers.
A reset should be written to PRODUCE a stated end state, not to preserve a
subset of an unknown one — "delete all but X" silently inherits every gap in X.

## Part four — what the review pass caught

An adversarial review of the send-window diff (four lenses, refute-first
verification) surfaced three real defects, all fixed here:

1. **`drainDigestOutbox` snapshotted the send window once per run.** A drain
   gets up to 45 seconds, so a run starting at 4:59:55pm on a Saturday would
   have kept texting straight through the 5pm close on a stale reading. The
   gate now re-reads the clock per chunk; the start-of-run value survives only
   for the pacing decision it was actually for. Pre-existing, but the whole
   point of this session is that 5pm means 5pm.
2. **The migration and HANDOFF both asserted a false invariant** — that an
   absent `sms_saturday_end_hour` row means "no shortening". It does not:
   `getEngineSettings` falls back to `engineDefaults` (17) for any key with no
   row, so deleting the row leaves Saturday closing at 5pm. Two different
   fallbacks (object-level vs row-level) with opposite outcomes. Both docs
   corrected; the distinction is now called out in HANDOFF and the test.
3. **A Saturday hour of 0 switched Saturday off while the label said
   "7am–12am Sat"** — which reads like a midnight close, the exact opposite.
   `operatorWindowLabel` now says "no Saturday sending", and the settings hint
   explains both the off-switch and the run-full-hours value. Pinned by tests.

Findings it raised that were NOT bugs: the published-copy-vs-unpasted-9955 gap
(a documented operator step, already loud in HANDOFF and the commit message),
and the generic "ads go out 7am to 6pm Mon–Sat" line in the welcome text —
that is the published claim, the same sentence the website carries, and it
contradicts nothing. Only copy that pairs "your ad won't go until Monday" with
"we text until 6pm today" needed suppressing.

## Part five — the call line, AD, and everything after

The session kept going well past the send window work. In order:

**The call flow.** The menu answers immediately now instead of ringing the
operator's phones for eighteen seconds first, saying the user's own words:
"Thank you for calling The Plain Exchange. To add a card on file, press 1. To
leave a voicemail and receive a callback, press 2." Ring-first survives behind
`VOICE_RING_FIRST`, opt-in rather than keyed to `VOICE_RING_TO` — leaving it on
that variable would have silently kept the old order for the very deployment
that asked to change it.

**Error handling, where there had been none.** Every stage runs inside a catch
(a throw used to reach Twilio as a 500, which it answers with its own robot
apology before dropping the call). The menu could re-prompt forever on an
unrecognised key — every lap billed — and is now capped, then voicemail.
Silence takes a message instead of hanging up. `menuTwiml` degrades rather than
throwing when handed no voicemail URL: a TwiML builder that throws takes a live
call down with it.

**Voicemail by email.** The text stays — it is the one that reaches a phone in
a barn — and an email now goes to `ADMIN_EMAIL` with the recording ATTACHED as
an mp3. A Twilio media link needs account credentials to open and dies with the
recording; an attachment plays anywhere and is still there next year.

**AD replaces AD NEW**, and it exposed a live bug. Bare `AD` already parsed, so
this was mostly copy — but the parser stripped ANY leading "new", which ate a
word out of the seller's own text. In this market the words it ate were brand
names: New Holland, New Idea. Two passes were needed. The first tried a casing
heuristic (a shouted NEW is the keyword); the user rejected it with the exact
case that breaks it — "AD New holland tractor" — and the right answer turned
out to be simpler: keep the word unless it CANNOT be part of the ad (an
explicit separator, or nothing after it). A member still typing the old keyword
gets a leading "NEW " the operator trims in review. Cheap and visible beats
silent and wrong.

**No debt system.** A $50 allowance was proposed and cancelled before any of it
was built. `payInstructions()` now leads with "call and press 1" — the same
line the IVR answers. That exposed a dead end: saving a card never switched
auto-top-up on, so a member could call, add a card, re-text their ad and be
told again they had no credit. The IVR's own consent script had been promising
the opposite the whole time. Fixed.

**Held-unpaid ads (migration 9953).** An unfunded post used to be refused
outright — the seller's text gone, retype it on a flip phone. Now it is written
down in an `unpaid` status with the quoted price on the row, and adding a card
(or topping up on the web) charges and posts it.

**Scheduled admin broadcasts (migration 9952).** The operator's own message to
every subscriber, individually, during active hours only.

## Open questions / next step

**All migrations are run** — the user confirmed at session end, including
`9957` and `9956`, which had been outstanding since session 019. The queue is
clear for the first time in two sessions; the next migration takes **9953**.
`9954` has disarmed itself, so re-pasting it does nothing.

0. **Two migrations are waiting again**: `9953_unpaid_ads.sql` and
   `9952_admin_messages.sql`, written after the queue was confirmed clear. Both
   degrade safely. The next migration takes 9951.
1. **The 10DLC campaign description still says 7am–9pm** wherever it was
   registered with the carrier — the LAST piece of this session's change still
   outstanding. It is external to this repo and no code change can fix it; the
   published window and the registered description have to agree. Update it at
   Telnyx.
2. **Confirm the dashboard reads right.** `/admin/money` should show $0
   collected / $0 earned / $0 owed and $160 credit issued across 4 members,
   with "Books opened 21 August 2026" underneath once Vercel has the deploy.
   `/admin` should show the send window as **7am–6pm Mon–Fri · 7am–5pm Sat** —
   that label is the quickest proof 9955 landed.
3. **Watch the throughput.** The sending day lost three hours (14 → 11), and
   Saturday four. Batch capacity is unchanged (`digestCap` 10 per batch, a
   batch per cron tick), so nothing is stranded — the overflow rides the next
   tick and the overnight queue still leaves at 7am — but a genuinely busy
   Saturday now has one hour less to clear in. Worth a look at the delivery
   queue on the dashboard after the first few Saturdays.

## Anything prevalent to the project

**If you add copy that quotes the send window, check `closedEarly` first.**
That is the whole seam. The published hours live in `smsWindowEndHour` and may
be recited anywhere; Saturday's real close lives in `smsSaturdayEndHour` and
may be recited only on admin surfaces. A message that quotes the published
hours during Saturday's early close is the one way this quietly breaks.
