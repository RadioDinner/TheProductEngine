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

- **DIGESTS STAY (user decision, this session):** "Ok, I think we can keep
  the digest direction." The per-ad send-on-approval idea is dropped for
  now; the analysis above stands as the record if it resurfaces. The
  recommended free move (slots → [7, 12, 16, 20]) was offered, not
  ordered — still the user's call on /admin/settings.
- **Pivot: location-specific exchange.** The user wants the exchange to be
  location-specific — a Holmes County exchange — with a per-area WhatsApp
  chat (Telnyx WhatsApp Business API; heavy Mennonite WhatsApp use), and
  eventually the same system for Lancaster PA, northern Indiana,
  Harrisonburg VA, Big Valley PA, all plain communities, plus a
  request-a-new-area flow. Captured as **FEATURES item 26** (immediate
  slice: area identity) + **`LONG_TERM_VISION.md`** (everything else).
- **New convention: `LONG_TERM_VISION.md`** (user instruction) — long-range
  items tracked separately from the immediate FEATURES list; not to be
  built unless greenlit. Reflected in CLAUDE.md? No — kept in the doc's own
  header; add to standing orders only if the user asks.
- **Brand stays unified (user decision):** "I want to KEEP 'The Plain
  Exchange' brand. I want that to be the whole brand, with separate areas
  that people can browse from the web page." So areas are browsable
  sub-sections of ONE brand, not separately-branded exchanges. FEATURES
  item 26 + LONG_TERM_VISION V1 updated to match.
- **North Star (user vision, this session):** "I want this to be a
  mennonite/amish ONLY marketplace — think facebook, sms based and
  craigslist mashed into one." Recorded as the North Star at the top of
  `LONG_TERM_VISION.md` (craigslist = the classifieds core, already built;
  sms-based = the backbone; facebook = the social layer already boned out
  in items 2/3/4/7/12/13/14/18; plain-only membership leaning on the
  verified-member gate — with the flagged hard question of enforcing
  membership without excluding flip-phone users). Directional, NOT a build
  order — captured, not started.
- **Merging to main (user instruction):** "merge to main and keep merging
  to main for the remainder of this session." Prior sessions 007–009 also
  committed directly to main; this re-authorizes it. Session work now lands
  on `main` directly.

## Also this session

- **Competitor scan for Holmes County** (user question): researched and
  delivered **in chat only** — competitor names are deliberately kept out
  of repo files per the session-010 repo-wide redaction order (the prompt
  log carries an editor's-note redaction, same convention as 010).
  Headline: the county's classifieds competition is all print/weekly-mail
  (a dominant free weekly shopper + the long-standing Sugarcreek weekly +
  a farm weekly + two national plain-community mail publications) plus
  auctions; **no SMS-first or WhatsApp classifieds service was found
  anywhere** — the direct-model lane appears empty.
- Confirmed the session-010 redaction fully landed: `main` greps clean,
  both old branches deleted on GitHub. That ops item is CLOSED.
- Verified Telnyx WhatsApp Business API is real (same number does
  SMS + WhatsApp, ~$0.0035/msg + Meta passthrough, template-gated
  marketing sends) — facts recorded in LONG_TERM_VISION.md V2.

## Build work this session (all on `main`, per user)

- **Town hall add form** (`cfac15b`): the native date input (which only
  exposed month+year on the user's device) replaced with explicit Month /
  Day / Year `<select>` pickers; new pure `assembleEventDay()` assembles the
  strict YYYY-MM-DD server-side, unit-tested, guarded by the existing
  validity checks. "Place (optional)" → "Address (optional)".
- **Areas backend + HIDDEN selector** (`ca1a808`, FEATURES item 26 backend):
  `lib/areas.ts` registry — Holmes (live) + Lancaster PA, Elkhart–LaGrange IN
  (the northern-Indiana settlement, chosen as ONE area covering
  Shipshewana/Topeka/Middlebury — split it in the registry if you'd rather
  run Nappanee/Elkhart separately), Big Valley PA — each with its own
  SMS-number env (`TELNYX_FROM_NUMBER_*`) and `areaForNumber()` inbound
  routing. `components/LocationSelector.tsx` wired into the homepage LEFT
  column behind `AREAS_SELECTOR_ENABLED=false` → built but not shown, as
  instructed. **Each area needs its own number + 10DLC campaign when it goes
  live** (per-area env vars are the seam).
- **Feedback buttons** (`ca1a808`, FEATURES item 27): `/contact` "Ask a
  question" / "Suggest an idea" page → emails ADMIN_EMAIL (operator class)
  WITH the sender's contact info; two footer buttons on every page.
- **"NEW AD" leniency** (`b6e487b`, FEATURES item 28): reversed word order
  (and run-together "NEWAD") now posts as AD NEW — user decision, flip-phone
  typers. Bare listings with NO verb deliberately still return the "automated
  system" reply (auto-treating every unknown text as an ad would turn STOP /
  HELP / buyer messages / gibberish into pending ads and burn credits — told
  the user, offered as an explicit opt-in if they want it).

## Ad-posting bug — diagnosis + hardening (`b6e487b`, `a0dd2d8`)

User hit: web post → raw platform crash "ERROR 2613278069@E394"; and
"AD NEW 7x12 … Dump Trailer …" over SMS → **no reply**.

- **Reproduced the exact ad in dev — it posts fine** (creates the ad,
  replies). So the ad LOGIC is sound; the prod failure is
  **environment-specific**. This is the session-007 signature: a prod
  throw that the SMS pipeline SILENTLY EATS (the retry-swallow trap — the
  provider id is recorded, so the Telnyx retry finds it "handled" and
  replies nothing) and the website surfaces as a raw crash.
- **Hardened both paths so it can never fail silently again AND the real
  error gets logged:** `handleInbound` now wraps all post-dedup processing —
  a throw is logged (`[inbound] processing failed…`) and the sender gets one
  friendly, deduped heads-up instead of silence. `postAd` is wrapped — an
  unexpected throw is logged (`[post] web ad submission failed…`) and the
  member sees a friendly `error=server` note ("nothing was charged") instead
  of the crash. NEXT_REDIRECT is re-thrown so normal outcomes flow.
- ✅ **ROOT-CAUSED + FIXED.** The hardening surfaced the Vercel log:
  **42804 — `column "kind" is of type ledger_kind but expression is of type
  text`.** The `spend_credits` RPC (9995) inserts its `p_kind` TEXT param
  into `credit_ledger.kind` (the `ledger_kind` ENUM) with no cast; Postgres
  won't coerce a text *variable* to an enum. Free-pass posts use
  `addLedgerEntry` (a PostgREST insert, which coerces) so they worked — this
  stayed latent until the first **credit-charged** post hit the RPC.
  **Fix: `supabase/migrations/9975_fix_spend_credits_ledger_kind.sql`** —
  re-runnable `create or replace`, only change `p_kind::ledger_kind`.
  ⚠️ **USER MUST PASTE 9975** into the Supabase SQL Editor; then credit
  posting works. The test suites can't catch this (file store, not
  Supabase).

## What shipped

- `d940120` start session log + prompt history
- `1439220` digest-vs-immediate-send decision analysis
- `10723f9` keep digests; location direction + `LONG_TERM_VISION.md`
- `d6129e5` unified-brand areas + Amish/Mennonite marketplace North Star
- `cfac15b` town hall month/day/year pickers + optional address
- `ca1a808` areas backend (hidden selector) + Ask/Suggest feedback buttons
- `b6e487b` SMS: NEW AD leniency + retry-swallow safety net
- `a0dd2d8` web ad posting: graceful error instead of a raw crash

## Open questions / next step

- Item 26 (location-specific / Holmes County identity) is the newest
  not-started FEATURES item — scope its v1 with the user (naming/copy
  surfaces vs. deeper area plumbing) before building.
- If the user wants faster ad delivery within digests: slots
  [7, 12, 16, 20] is a zero-code settings change matching all registered
  copy.
- Session 009 ops queue still stands: paste migrations 9979/9978/9977/9976
  → check /api/health; carried photos@ + review-alert verification.

## Shortcode/pictures analysis (user request, later in session 011)

Question: pivot to the competitor's shortcode + MMS-picture-with-every-ad
model, or keep metered PIC pulls? Full 5-agent workflow (shortcode economics
w/ 2026 pricing, repo-grounded cost model, flip-phone MMS reality, option
space, adversarial number check). Verdict delivered in chat:
**DON'T pivot; formalize the user's own tiered instinct.**

Key verified numbers (all recomputed): shortcode lease ~$1,000/mo on Telnyx
(+$500 one-time MMS enablement, 8–12 wk carrier certification, ~$12k/yr
floor) and it does NOT make MMS cheaper (~$0.02–0.03 all-in vs the $0.035
long-code rate — the lease buys THROUGHPUT, not cheap media; it exists to
escape T-Mobile's 2,000/day 10DLC cap, which per-ad MMS hits at ~200–400
subs). Picture-with-every-ad = 3.2–6.1x today's total cost at every tier
($787/mo at 150 subs/5 ads vs $156 today; $5,250/mo at 500 subs/10 ads).
Underwater vs photo-ad revenue at 150 subs already ($5.25 cost/ad vs
$3.60–5.00 revenue). SURPRISE: ONE bundled MMS digest/day = $1.05/sub/mo,
CHEAPER than a 7-segment text day ($1.68) — the cost bomb is per-ad sends,
not MMS itself; but flip-phone multi-image rendering is unproven and MMS
silently fails on data-off/text-only-plan phones (the plainest segment —
delivery shows "delivered", handset never fetches). PIC pulls are
user-initiated → OUTSIDE the registered "up to 4 digests/day" promise; ≤1
MMS per existing slot stays inside it; per-ad MMS breaks it.

Recommended sequence (chat): (1) keep PIC default, get the ~$41.50 external
vetting now; (2) field-test MMS rendering on real community flip phones;
(3) build opt-in Picture Edition (keyword toggle, item-22 category machinery
is the proven template) delivered as a CAPPED picture-digest MMS ≤1/slot,
cost scales with opt-ins only, optionally $2–3/mo; (4) optional seller-
funded "Picture Blast" priced from live subscriber count (margin-positive by
construction, item-17 sponsor machinery is the template); (5) shortcode only
at multi-area scale. Flagged code gap: NO MMS budget breaker exists
(digestDailySegmentBudget counts SMS segments only; PIC MMS bypasses the
outbox) — any broadcast-MMS build needs its own budget knob. Second
competitor: nothing SMS-based found in the niche; asked user for number
type / who pays / how subscribers join (or forward one message).
