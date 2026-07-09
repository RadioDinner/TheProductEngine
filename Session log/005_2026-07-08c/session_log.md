# Session 005 log — 2026-07-08/09 (c)

"Continue the audit," then a product change, brutal abuse testing, and a merge to
production. Finished the three-round audit begun in session 004 (R1 security was
already done; this session completed **R2 function** and **R3 profitability**),
deferred the starter grant, brutally stress-tested the engine, and **merged
everything to `main`**.

## What shipped (merged to `main`, `6d85c1f → d77645f`)

Commits, oldest → newest:
- `ed33cf8` HANDOFF: campaign status + correct stale notes
- `f773ca6` log prompts
- `0bda90f` **Defer starter free-ad grant to first AD NEW** (migration 0010)
- `11f0e16` **R2 production-critical**: listMessages ordering + Supabase ad expiry
- `332e126` **R2 correctness batch**: commands, packing, settings, drain, blocklist, expiry display
- `11b922e` **R3 profitability audit** (`docs/profitability.md`)
- `97ff733` HANDOFF + session log (R2/R3 complete)
- `ba3b9e5` **Brutal abuse harness + report** (`test/abuse/`, `docs/abuse-test.md`)
- `d77645f` HANDOFF: record merge + log prompts

## Campaign clarifications (user)

- **HELP-number is NOT a mismatch** — registered HELP msg and `site.supportPhone`
  are both (234) 301-0048. Fixed the stale session-004 note.
- **Migrations 0006–0009 applied.** Verified the `/sms` CTA page + homepage +
  footer carry all six 806-required elements → the Pending-Telnyx-Review
  resubmission (TCR CTSE7B5) should clear the CTA check. Added `/sms` to sitemap.

## Starter-grant decision (user: grant on first AD NEW)

Accounts mint with **0** passes; `grantStarterAdsIfFirst` applies the 3-ad grant
once on first `AD NEW`, guarded by `users.starter_granted_at` (**migration 0010**).
Supabase path closes the double-grant race with a conditional update on
`starter_granted_at IS NULL`. A subscribe-only number mints zero liability.

## Round 2 — Function (COMPLETE)

Adversarial workflow (16 dimensions × reproduce+refute, 60 agents) → 22 raw → 21
confirmed; re-verified against code + deduped to **13 distinct bugs, all fixed**;
`npm test` 69 → **79/79**. Production-critical: (1) Supabase `listMessages`
returned the OLDEST N → BUYCREDIT/YES dead for sellers with >50 messages; fixed to
newest-N chronological. (2) Supabase **never expired ads** → live-on-site forever;
added `expireDueAds()` run from the digest cron. Plus: command parsing
(`STOP.`/`YES.`/`/ help`), packMessages ceiling, settings blank→0 + midnight-slot,
digest double-send on bookkeeping error, email exempt from the SMS budget (dev-
verified), blocklist 500-cap, set-password ticket path, admin ad-# search, email
body dup, dev report undercount, ad expiry display honoring `expiryDays`.

## Round 3 — Profitability (COMPLETE)

Adversarial workflow (7 dimensions, 63 agents) → 28 raw → 23 confirmed →
**`docs/profitability.md`**, model computed from the REAL segmentation code.
Bottom line: break-even $/credit = subscribers × (avg_ad_septets/153) × $0.008;
profitable to **~150 free subscribers** at current pricing + typical ad mix, then
underwater as the free list grows. Code-fixable leaks (await a decision): free
bumps/revive at `bumpCost=0`, uncapped PIC/MMS, catch-up invisible to the digest
budget. Pricing levers (decision): credit price vs break-even, volume-discount
inversion, monetizing the free side.

## Brutal abuse test (`npm run test:abuse`)

Harness drives the REAL engine (`handleInbound`) against the file store with a
controllable clock (both `Date.now()` and `new Date()`), so time-based attacks
exercise the real rolling-window caps; cost read from the audit log.
**15 attack vectors, ALL bounded** (`docs/abuse-test.md`): compulsive STATUS
(×500 + sustained 2h), BUMP-every-5-min, expired-ad revival loop, PIC/MMS flood,
AD NEW drain, concurrent-spend race, STOP/START loop, spoofed subscribe flood,
gibberish (normal + UNDER ATTACK), adversarial bodies, global breaker, cross-user
griefing, webhook replay, blocklist. Worst-case ceilings: one number ~$0.58/hr;
whole service $8/hr replies + $96/day digest budget; UNDER ATTACK + blocklist cut
both hard. Empirically **confirmed `bumpCost>0` closes the free-rebroadcast leak**
(a 1-credit ad was kept alive 5 months for $0 at bumpCost=0).

## Merge to production

User directed **merge everything to `main`** (fully informed of the migration-0010
dependency). Merged as a clean fast-forward `6d85c1f → d77645f`. **User applied
migration 0010** so the `starter_granted_at` reads are safe on auto-deploy. Could
not verify prod health from the sandbox (proxy blocks external domains); gave the
user the `/api/health` self-check + the `git push origin 6d85c1f:main
--force-with-lease` rollback.

**Gotcha:** the local `main` branch was stale (pointed at an ancient session-001
commit `a852509`, unrelated history) → the first `git checkout main && merge`
errored "unrelated histories" and reverted the working tree. No work lost (all
committed on the branch); recovered by checking the branch back out and pushing
`branch:main` via a verified fast-forward. Local `main` realigned to `origin/main`.

## Directional decisions

- Starter grant → first AD NEW (not account creation).
- Merge to main accepted with the 0010 dependency understood; 0010 applied.
- `bumpCost` raise discussed and **recommended** (abuse test backs it) but **NOT
  committed** — awaiting the number.

## Open / next session

1. **`bumpCost` is still `0`.** Ready-to-ship on request: `config.ts` +
   `seed.sql` + `seed-production.sql` = 1, plus prod SQL
   `update config set value='1' where key='bump_cost';`.
2. **R3 safety-valves** (opt-in): revive cooldown/charge, MMS daily budget, count
   catch-up toward the digest budget. **Pricing model**: a `/admin` break-even
   readout is the low-friction pick.
3. **Launch ops** (LAUNCH.md): external cron pinger (Vercel Hobby crons are
   daily-only), Stripe live keys, ADMIN_EMAIL, Resend domain + real CAN-SPAM
   address, watch the Telnyx campaign → text HELP as the go-signal.
4. Minor: `START` (resubscribe) is not deduped like `STOP` (cap-bounded; a 1/day
   dedup would close it).

## Prevalent notes

- **`main` auto-deploys prod** — run additive migrations before/with merging
  schema-dependent code. Watch for the **stale local `main`**; realign to
  `origin/main` before any main operation.
- `npm test` = 79/79 pure-logic regression; `npm run test:abuse` = the 15-vector
  abuse suite. Engine paths are drivable directly under
  `node --experimental-strip-types` with the `test/abuse/alias-loader.mjs`.
