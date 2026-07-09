# Session 005 log — 2026-07-08/09 (c)

"Continue the audit." Finished the three-round audit begun in session 004:
Round 1 (security) was already complete; this session completed **Round 2
(function/correctness)** and **Round 3 (profitability)**, plus a user-directed
product change and two campaign clarifications. All work on branch
`claude/audit-continuation-qb7i83` (NOT merged to main).

## What shipped (commits, oldest → newest)

- `Session 005: start folder + log prompt`
- `HANDOFF: campaign status + correct stale notes`
- `Session 005: log prompts`
- **`Defer starter free-ad grant to first AD NEW (migration 0010)`**
- **`R2 fixes (production-critical): listMessages ordering + Supabase ad expiry`**
- **`R2 fixes (correctness batch): commands, packing, settings, drain, blocklist, expiry display`**
- **`Round 3 profitability audit: cost/revenue model + scaling playbook`**
- (this log + HANDOFF update)

## Campaign clarifications (user)

- **HELP-number is NOT a mismatch** — registered HELP msg and `site.supportPhone`
  are both (234) 301-0048. Corrected the stale session-004 note in HANDOFF.
- **Migrations applied** (0006–0009). Verified the `/sms` CTA page + homepage +
  footer + `/privacy` carry all six 806-required elements → the *Pending Telnyx
  Review* resubmission (TCR CTSE7B5) should clear the CTA check. Added `/sms` to
  the sitemap.

## Starter-grant decision (user: grant on first AD NEW)

Accounts now mint with **0 free-ad passes** (no Welcome ledger row at creation);
`grantStarterAdsIfFirst` applies the 3-ad grant once on the first real `AD NEW`,
guarded by the new `users.starter_granted_at` (**migration 0010**, re-runnable).
Supabase path closes the double-grant race with a conditional update on
`starter_granted_at IS NULL`. Site copy → "your first 3 ads are free." Both
deferred SECURITY-TODO decisions resolved (audit-logging stays unlimited).
Dev-verified end to end via the file store.

## Round 2 — Function: COMPLETE

Adversarial workflow (16 correctness dimensions × reproduce+refute verify, 60
agents) → 22 raw → 21 confirmed. I re-verified each against the code and deduped
to **13 distinct bugs, all fixed**; `npm test` 69 → **79/79** (added command +
packing regression tests).

Production-critical: (1) Supabase `listMessages` returned the OLDEST N (file
store returns newest) → **BUYCREDIT/YES purchase dead for any seller with >50
messages**; fixed to newest-N chronological. (2) Supabase **never expired ads**
(no counterpart to the file-store sweep) → ads live on the public site forever,
stale "runs through" dates, dead SOLD/revive branches; added `expireDueAds()`
run from the digest cron.

Medium/low: command parsing (`STOP.`/`YES.`/`SUBSCRIBE,`/`/ help` now route);
`packMessages` force-appended a 2nd ad past the ceiling in headerless groups;
admin settings blank/absent field → 0 (silent disable) + empty slot token →
midnight digest; digest **double-send** when post-send bookkeeping threw; email
edition **exempted from the SMS segment budget** (defers SMS, flows email —
dev-verified); blocklist 500-row cap (blocked past 500 got digests); set-password
ticket deleted at wrong cookie path (reusable for TTL); admin ad-# search in
Supabase; email body duplicated for single-clause ads; file-store report
`newSubscribers7d` capped at 10; ad expiry display now uses the real stored
`expires_at` (honors a changed `expiryDays`).

## Round 3 — Profitability: COMPLETE

Adversarial workflow (7 cost/revenue dimensions × verify, 63 agents) → 28 raw →
23 confirmed. Synthesized into **`docs/profitability.md`**, with the model
computed from the REAL segmentation/packing code (not estimates).

**Bottom line:** break-even $/credit = subscribers × (avg_ad_septets/153) ×
$0.008. Profitable to **~150 free subscribers** at current pricing + a typical
ad mix (8 medium ads = 6 seg/subscriber/day); underwater beyond, because revenue
is fixed by ad volume while cost scales with the free list. Monthly broadcast
cost: $216 at 150 subs, $1,440 at 1,000.

Code-fixable revenue leaks (documented, **await a user decision**): free bumps
(`bumpCost=0`) + **free infinite revival of expired ads**; uncapped PIC/MMS
($302/ad worst case per number); catch-up SMS invisible to the segment budget;
starter passes cover the 5-credit photo tier. Pricing levers (decision): credit
price vs break-even, volume-discount inversion (biggest buyers pay least),
monetizing the free subscriber side.

## Open / next session

1. **⚠️ Run `supabase/migrations/0010_defer_starter_grant.sql`** before this
   branch merges to main (code selects `starter_granted_at`; account reads 500
   without it). All of 0006–0009 already applied.
2. **Decide the R3 items** — which safety-valves to ship (charge for bumps /
   revive cooldown; MMS daily budget; count catch-up toward the budget) and the
   pricing model (tiered price + `/admin` break-even readout is the low-friction
   pick). Then I implement.
3. Merge `claude/audit-continuation-qb7i83` → main once 0010 is applied.
4. Watch the resubmitted 10DLC campaign (Pending Telnyx Review).

## Prevalent notes

- `.claude`/skills tooling reinstall + fresh clone means workflow scripts from a
  prior session are gone; re-author audit workflows as needed.
- Verified engine/store behavior by importing the real modules under
  `node --experimental-strip-types` with a tiny `@/`-alias loader (scratchpad) —
  a lighter alternative to the Playwright walk for pure-logic engine paths.
- `npm test` is 79/79 (segments/commands/dst/phone).
