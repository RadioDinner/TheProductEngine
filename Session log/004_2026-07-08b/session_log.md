# Session 004 log — 2026-07-08 (b)

A three-round audit (security → function → profitability) the user asked to run
"as close to bulletproof as possible," plus an urgent 10DLC carrier-rejection
fix that landed mid-session. Everything shipped to `main` (user directed
commit-to-main; prod auto-deploys `main`).

## What shipped (commits, oldest → newest)

- `0ea11a5` start round-4 audit (session bootstrap)
- `6702f8b` **Content filter** — strip emoji + flag links at ad ingest
- `5a34817` **Operator safety controls** — two-level PAUSE, UNDER ATTACK, blocklist (migration 0008)
- `3c9b5af` docs — admin/help emergency controls, LAUNCH (0008), HANDOFF
- `4cdf249` **10DLC 806 fix** — consolidated `/sms` CTA page + disclosures
- `3710bd8` 10DLC — opt-in confirmation discloses marketing + matches registration
- `af86a80` 10DLC — keep opt-in confirmation GSM-7 (hyphen not em-dash)
- `d0a5897` **Security R1 batch 1** — consent-at-send (STOP/block purge queued digests), login-OTP global breaker, email `eq`
- `ee670cf` **Security R1 batch 2** — catch-up cost breaker + STOP/START dedup, ad-title phone-PII masking
- `c148af8` fail-safe blocklist + outbox-cancel (protect `main` auto-deploy)
- `34d6fee` **Security R1 batch 3** — OTP atomic verify (migration 0009), `/api/health` gating, email double opt-in + POST confirm/unsub
- `4449489` **Unit test suite** — `npm test`, 69 checks (segments/commands/dst/phone); `etParts` → pure `lib/et.ts`
- (plus several `Session 004: log prompt …` commits)

## Round 1 — Security: COMPLETE

65-agent adversarial audit → 17 confirmed (4 P1, 4 P2, 9 P3). **16 fixed +
verified, 1 deferred** (`#9` submitPhone account-existence oracle — inherent to
password-vs-OTP UX, lowest severity). Highlights: unauth `/login` could pump
unbounded SMS to any number (10DLC-suspension risk) → now capped; STOP/blocklist
were only enforced at digest *compose* time (bypass window of hours) → now
enforced at *send* time via `cancelQueuedOutboxFor` + a drain re-check. Full
findings: `scratchpad/findings.md` (delivered to user).

## Round 2 — Function: IN PROGRESS (not finished this session)

- Adversarial workflow launched (`wf_8923b4d2-8d7`, 11 correctness dimensions),
  still running at wrap. **Re-run next session** via its saved scriptPath.
- Manual pass (Node `--experimental-strip-types`) cleared 4 pure areas 69/69 —
  now the committed test suite: segment/packing math, command parser, DST slot
  firing across both 2026 transitions, phone normalization.

## Round 3 — Profitability: NOT STARTED

Break-even ≈ $1.65/credit @ 150 subs (session 003 xlsx). The new segment-math
tests verify the cost basis the model rests on.

## Directional decisions

- **Threat model:** harden against all four adversary classes; **priority =
  trust & privacy** first, then money, then uptime. **Profit goal:** sustainable
  long-term break-even; willing to spend to get there if that's the route.
- **Links → flag for manual review** (not strip/reject); walled garden now,
  a future "verified advertiser" tier can post links (`mayPostLinks()` seam).
- **PAUSE = two levels** (full + partial). **UNDER ATTACK = all four levers.**
- **Email-in → double opt-in** (reverses session-003 "direct subscribe"; the
  spoofable From no longer enrolls anyone). **`/api/health` detail gated behind
  CRON_SECRET.** Both were my defaults after the AskUserQuestion tool errored;
  flagged as reversible.
- **Fail-safe over hard-fail** for new-table reads (blocklist/outbox) so a
  missing migration can't 500 the message path on `main` auto-deploy.

## Open / next session

1. **⚠️ Run `supabase/migrations/0009_verify_login_code.sql`** — sign-in-code
   verification errors until applied. (0006/0007/0008 already run 2026-07-08.)
2. **⚠️ 10DLC HELP-number mismatch:** registered (330) 203-1031 vs app-sent
   (234) 301-0048 — must match; user to confirm which is correct.
3. **Re-run Round 2 (function) audit**, triage findings, fix → verify → push.
4. **Round 3 (profitability):** build the cost/revenue model, hunt revenue
   leaks, dollarize, staged scaling playbook.
5. Watch the resubmitted 10DLC campaign; if it bounces, the rejection text
   pinpoints the remaining CTA element.

## Prevalent notes

- `main` auto-deploys prod → run additive migrations before/with merging
  schema-dependent code (0009 outstanding).
- `npm test` is the new lightweight regression suite (Node type-stripping, no
  framework). Verification convention is otherwise scripted Playwright walks
  (`shoot.tmp.mjs`, deleted after) — launch chromium with
  `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
