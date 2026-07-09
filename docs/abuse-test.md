# Brutal abuse test — The Plain Exchange

Adversarial stress/abuse testing of the SMS engine, session 005, 2026-07-09.
Run it: **`npm run test:abuse`** (harness: `test/abuse/brute.mjs`).

## Method

The harness drives the **real engine** (`handleInbound`, the same entry point the
Telnyx webhook calls) against the file store, with a **controllable clock** (both
`Date.now()` and `new Date()` overridden) so time-based attacks ("every 5 minutes
for a couple hours") play out with the real rolling-window rate caps. Cost is read
from the actual outbound audit log (segments × $0.008, MMS × $0.035). Each scenario
resets state and reports measured damage.

## Result: 15/15 attack vectors bounded

| # | Attack | Measured outcome |
|---|---|---|
| 1 | Compulsive `STATUS` ×500 (one hour) | 19 replies, **$0.18**; ~480 logged, no reply/cost |
| 1b | `STATUS` every 30s for 2h (×240) | 41 replies over 2h, **$0.34** — cap holds across the window |
| 2 | `BUMP` every 5 min for 2h (×24), free | 26 replies; only **1** bump queued per ad at a time |
| 3 | `BUMP` flood with `bumpCost=1` | Charged 1 credit/bump, **refused when broke** — leak closed |
| 4 | Expired-ad revival loop ×5, free | **5/5 free revivals** — a 1-credit ad kept alive 5 months for $0 |
| 5 | `PIC`/MMS flood ×500 (one hour) | **12 MMS**, $0.42; ~488 pulls get nothing |
| 6 | `AD NEW` flood ×50 | Stops when credits+free-ads spent; **balance never negative** |
| 7 | Concurrent `AD NEW` ×10 on 1 credit | 1 posted (file store); **prod uses advisory-lock RPCs** |
| 8 | `STOP`/`START` loop ×50 (3.3h) | STOP conf + catch-up deduped to 1/day; only cheap START confs |
| 9 | Subscribe flood ×300 spoofed numbers | **Zero** free-ad liability minted (starter grant deferred) |
| 10 | Gibberish flood ×500 | 1 reply normal / **0 under UNDER ATTACK** |
| 11 | Adversarial ad bodies | 10k-char **rejected**; emoji **stripped** (no UCS-2 cost flip) |
| 12 | 600 numbers × `HELP` (one hour) | **Exactly 500** replies — service-wide cap holds ($8/hr ceiling) |
| 13 | Cross-user griefing (`SOLD`/`BUMP` victim's ad) | **Refused** — ownership check, no state change, no charge |
| 14 | Webhook replay (same provider-id ×5) | **1** post, charged once — inbound idempotency holds |
| 15 | Blocklisted number floods | **0** SMS / **0** MMS — dropped after logging |

## What holds up (the defenses that work)

- **Per-number reply cap (20/hr)** bounds any single-number command flood
  (STATUS, BUMP, gibberish) to ~20 cheap replies/hr regardless of how hard they hammer.
- **Per-number PIC cap (12/hr)** bounds MMS.
- **Service-wide cap (500/hr)** bounds total command-reply spend to **~$8/hr** even
  under a many-number swarm.
- **Dedup (1/number/day)** on STOP confirmations, new-subscriber catch-up, and the
  unknown-command redirect, so toggle/loop attacks can't pump the expensive messages.
- **Idempotency**: inbound provider-id dedup blocks webhook replay double-posts/charges.
- **Ownership checks** block cross-user griefing (marking/bumping someone else's ad).
- **Ingest guards**: `maxChars` rejects giant bodies; the content filter strips emoji so
  a broadcast can't be flipped to costly UCS-2.
- **Operator levers** are decisive: **UNDER ATTACK** tightens caps to 5/hr per number +
  120/hr global and suppresses unknowns; the **blocklist** drops a number entirely
  (no account/reply/charge/MMS).
- **Starter-grant deferral** (session 005): a spoofed-number subscribe flood mints
  **zero** free-ad liability.

## Worst-case cost ceilings

- **One abusive number:** ~20 replies/hr + 12 MMS/hr ≈ **$0.58/hr**, and the blocklist
  ends it in one click.
- **Whole service under saturation:** command replies capped at 500/hr = **$8/hr**
  (~$192/day if sustained; higher only if replies average >1 segment), and the digest
  broadcaster is separately capped by `digestDailySegmentBudget` = **$96/day**. UNDER
  ATTACK cuts both hard.

## Residual leaks (known from Round 3, empirically confirmed here)

None are catastrophic, all are cost — not integrity — and all are the R3 items:

- **Free bumps / free infinite revival** (`bumpCost=0`): scenario 4 kept a 1-credit ad
  alive 5 months for $0. **Setting `bumpCost` > 0 closes it** (scenario 3 proves it).
- **PIC/MMS has no per-ad or global cap** (only the 12/hr per-number cap): a swarm of
  numbers pulling one popular photo ad is unbounded across numbers. (R3 fix: a daily
  MMS budget.)
- **New-subscriber catch-up is invisible to the digest segment budget**: scenario 9 =
  $4.83 for 300 spoofed subscribes; bounded by the global 500/hr cap + per-day dedup,
  but not by the cost breaker. (R3 fix: count catch-up toward the budget.)

## Minor observation (new)

- **`START` (resubscribe) is not deduped** the way `STOP` is, so a resubscribe-spam
  sends a cheap 1-segment confirmation each time — bounded by the 20/hr reply cap
  (~$0.16/hr/number max). Low priority; a 1/day dedup would close it.

## Caveat

Concurrency races (scenario 7) are shown against the file store only, which has no
atomic guard. **Production uses Supabase RPCs** (`spend_credits`, `consumeFreeAd`,
`reserveSms`) with advisory locks (migration 0005), verified race-safe in Round 1 —
that is the path that runs in prod.
