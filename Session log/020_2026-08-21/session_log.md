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

**Migration `9955_saturday_close.sql`** (NOT yet pasted): updates
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
- **Version 1.2.9** (§6): three features — the new published window, the
  Saturday close, the copy rule that protects it — so the FAR-RIGHT digit
  moved. It is arguably a "major change" (it rewrites the public promise on
  nine pages), but by the letter of the rule that is a feature count of three.
  Say the word and the second digit moves instead.

## Open questions / next step

1. **Paste `9955_saturday_close.sql` first.** Until it goes in, production
   still texts until **9pm** while every public page now says 6pm — the stored
   `sms_window_end_hour` row (21, from migration 9971) overrides the code
   default. The Saturday half degrades safely on its own; the end-hour half
   does not. `9957_money_kinds.sql` and `9956_featured_requests.sql` are still
   waiting from session 019.
2. **The 10DLC campaign description still says 7am–9pm** wherever it was
   registered with the carrier. That is external to this repo and no code
   change can fix it — the published window and the registered description
   have to agree. Update it at Telnyx.
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
