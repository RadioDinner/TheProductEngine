# Session 006 — 2026-07-09

Branch: `claude/stress-test-pic-limits-ki1jf0`

## The ask

1. Comprehensively / brutally test the system for extreme failure cases (e.g.
   `AD SOLD 1325` ×20, incessant `PIC` requests).
2. Build a `/PIC` request limit: an admin control for how many pulls a number gets
   per day and how many they can bank in a rolling/sinking fund (e.g. 3/day, bank 20).

## What shipped

### PIC daily allowance + rolling bank (the feature)
- **`lib/pic-quota.ts`** — pure, import-free accrual core: `etDayDiff`,
  `accruePicQuota` (grants `dailyAllowance` per ET day elapsed, capped at
  `bankCap`; new account seeds one day; same-day clamps to a lowered cap),
  `picLimitMessage` + `PIC_LIMIT_MARKER`. 20 unit checks.
- **Settings/config:** `picDailyAllowance` (3) + `picBankCap` (20) added to
  `lib/config.ts`, `lib/settings.ts` (interface + CONFIG_KEYS + defaults),
  `supabase/seed.sql`. `picDailyAllowance <= 0` = quota OFF (repo's 0-means-off
  convention; safe reading of an accidental 0).
- **Stores:** `Account.picBalance` / `picAccrualDay`; `reservePicQuota` atomic
  accrue-then-spend — file store (dev) + Supabase RPC `reserve_pic_quota`
  (advisory lock) in **migration 0011** (ascending, re-runnable).
- **Engine (`lib/engine.ts`):** enforced in the `PIC` handler, only after the
  ad-exists / has-photo gates (a mistyped id never burns a pull). `ensureAccount`
  first so accountless pullers are covered. Friendly denial deduped 1 / 3h / number.
  Hourly `smsPicsPerHour` stays as a burst limiter on top.
- **Admin UI:** two fields on `/admin/settings` (+ `SETTING_MAX` ceilings + save
  loop in `lib/admin-actions.ts`); documented on `/admin/help`.

### Command re-route fix
- **`lib/commands.ts`:** `AD SOLD <id>` / `AD BUMP/STATUS/PIC <id>` now re-route to
  the owner command instead of posting an ad body "SOLD 1325" (which used to burn a
  credit/free pass). Narrow: only an exact `verb + number` body re-routes; a real ad
  starting with the word is untouched. Parser tests added.

### Brutal testing
- **`test/abuse/brute.mjs`** extended 15 → **19** vectors, all bounded:
  #16 SOLD ×20 (1 transition, rest idempotent, tail silenced by the 20/hr cap),
  #17 `AD SOLD <id>` ×20 (0 junk ads, 0 credits burned), #18 PIC hammer 5 days
  with quota ON (**3 MMS/day**), #19 PIC rolling bank (idle 2 wks → burst = **20**,
  the cap). #5 re-scoped to quota-OFF to isolate the hourly cap.
- **`docs/abuse-test.md`** rewritten (19/19).
- End-to-end dev walk confirmed a fresh **accountless** number gets minted on first
  PIC, receives exactly 3 MMS, one denial, then silence — state persisted.

## Verification
- `npm test` → **107/107** (added `pic-quota` suite + 8 parser checks).
- `npm run test:abuse` → **19/19 bounded**.
- Full `tsc` not runnable here (no `@types/node` install); relied on the runtime
  suites, which exercise the real engine. `next build` typecheck left for the user's
  normal deploy pipeline.

## Directional decisions
- **Migration numbering stayed ascending** (`0011`) to match the ten existing files
  — `new_session_instructions.md` §4's descending `9999_` rule is a different
  project; HANDOFF says ask before adopting it here. Flagged for the user.
- **Default quota is 3/day, bank 20 — ON.** This is exactly what the user asked for,
  but it means a buyer can pull only 3 photos/day. Called out in HANDOFF + summary as
  a live product decision (raise the number, or set daily to 0, to loosen/disable).
- Quota applies uniformly (owners not exempted from their own photos) for v1
  predictability.

## Open / next step
- ⚠️ **Apply migration 0011** in Supabase before this deploys (the code selects
  `pic_balance` / `pic_accrual_day` and calls `reserve_pic_quota`). Additive +
  re-runnable; run it before/with the merge (prod auto-deploys `main`).
- Decide whether 3/day is the right launch default (see above).
- Still open from prior sessions: `bumpCost` still 0 (free-revival leak); a per-ad /
  global daily MMS budget would close the many-number PIC-swarm case (the per-number
  quota closes the single-abuser case).
