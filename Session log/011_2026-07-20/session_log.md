# Session 011 — 2026-07-20

## Topic

User is weighing abandoning digest sending in favor of: each ad sends
automatically ~5 minutes after approval, within a 7am–8pm sending window.
This session produced the decision analysis (no code changes yet — user is
deciding). Analysis ran as a 5-agent workflow (coupling map, segment-cost
math, compliance audit, minimal-build sketch, adversarial cross-check of all
32 load-bearing claims).

## Findings (verified against code)

**Cost is a wash — not the reason to keep digests.** Computed with
`lib/sms-segments.ts` against real seed ad bodies (~102-char bodies, 92–138
septet lines): per-ad sends are 25% CHEAPER at 3 ads/day (a 1-ad evening
digest wastes a 38-septet header + rounding), break even at 6–10 ads/day,
and only lose +15% at 15 ads/day. Monthly delta between −$36 and +$72 at 150
subs. EXCEPTION: if compliance forces brand + "Reply STOP" on EVERY
standalone message (vs today's first-per-day rule), per-ad jumps +50%
(~+$180/mo @150 subs, +$600 @500, at 10 ads/day). The footer policy is worth
more money than the send-model choice.

**The real blocker is the registered frequency promise.** "Up to 4
digests/day" appears on ~14 surfaces including the Telnyx-REGISTERED opt-in
auto-response and HELP copy (campaign 4b30019f…/TCR CTSE7B5). That campaign
was rejected once (MNO 806) explicitly over CTA/frequency disclosure and
was only fully carrier-provisioned 2026-07-16 — four days ago. Per-ad sends
are unbounded/day (15 approvals = 15 marketing texts vs a registered ceiling
of 4). Fixing it = re-registering campaign fields → Telnyx → TCR → MNO
re-review on a record with a prior rejection. Also: each message is a
discrete STOP/complaint opportunity (10DLC health metric), and T-Mobile's
2,000/day unvetted cap arrives at ~200 subscribers under per-ad (vs ~1,000
under 2 digests/day).

**Engineering is more tractable than it looks.** The cross-check downgraded
most "dies" ratings: outbox + segment-budget breaker + category machinery +
STOP-footer bookkeeping + `hold_until` + the `broadcast_at` latch all carry
over. Minimal build: one migration (`digests.ad_id` + unique, next number
9975), approval stamps `hold_until = now+5min` clamped to the window, sweep
reuses `getNewDigestAds` verbatim, per-ad digest row, `finalizeDigest`
stamps `broadcast_at` (website gating + refund matrix keep working free).
Genuine casualties needing product decisions: digest numbering, email 1:1
mirror, admin digest queue controls, sponsor-line carrier (paid packages are
SOLD as "rides the daily digest"), bump semantics (free instant re-blast =
the profitability leak), catch-up, ~30 copy surfaces + policy pages.
Latency honesty: with the 5-min cron, "5 min" is really 5–10 unless approval
kicks the drain inline (cheap to add). Window must be enforced at DRAIN
time — no quiet-hour enforcement exists anywhere today.

**7am–8pm window:** 7am is 1h before TCPA's 8am–9pm presumed-safe window,
but the 7am slot already exists, is disclosed, and survived campaign review.
8pm end is conservative. Shape change: overnight approvals become an N-text
7am burst instead of one digest.

## Recommendation given to user

Don't do pure per-ad sends now. Free move first: set slots to
[7, 12, 16, 20] on /admin/settings — matches every registered word ("up to
4/day", "morning, noon, afternoon, evening", SLOT_LABELS already name those
hours), zero code, cuts worst-case wait from ~11h to ~4–5h. If more
immediacy needed: batch-on-approval-sitting micro-digests (send all ads 5
min after the LAST approval of a sitting) or an urgent-flag lane (normal ads
ride digests; "send now" checkbox / paid rush fee). Pure per-ad remains
buildable if the user still wants it after the campaign has some healthy
history — decision list captured above.

## Directional decisions

- (pending) User to decide: digest vs per-ad vs middle path.

## What shipped

- `d940120` Session 011: start session log + prompt history
- (this file) decision analysis record

## Open questions / next step

- User's call on the send model. If per-ad: the open product decisions are
  the per-subscriber daily cap, bump meaning + bumpCost, email edition
  shape, sponsor carrier, numbering, catch-up replacement, refund-window
  wording, and the 10DLC re-registration sequencing.
- Workflow artifacts: full agent outputs in the session scratchpad
  (coupling/cost/compliance/design/check JSON) — key numbers reproduced
  above.
