# Brutal abuse test — The Plain Exchange

Adversarial stress/abuse testing of the SMS engine. Started session 005; extended
session 006 (2026-07-09) with the SOLD-repeat / AD-parse cases and the new PIC
daily-allowance + rolling-bank control.
Run it: **`npm run test:abuse`** (harness: `test/abuse/brute.mjs`).

## Method

The harness drives the **real engine** (`handleInbound`, the same entry point the
Telnyx webhook calls) against the file store, with a **controllable clock** (both
`Date.now()` and `new Date()` overridden) so time-based attacks ("every 5 minutes
for a couple hours", "hammer PIC for 5 days") play out with the real rolling-window
rate caps and the ET-day PIC accrual. Cost is read from the actual outbound audit
log (segments × $0.008, MMS × $0.035). Each scenario resets state and reports
measured damage.

## Result: 19/19 attack vectors bounded

| # | Attack | Measured outcome |
|---|---|---|
| 1 | Compulsive `STATUS` ×500 (one hour) | 19 replies, **$0.18**; ~480 logged, no reply/cost |
| 1b | `STATUS` every 30s for 2h (×240) | 41 replies over 2h, **$0.34** — cap holds across the window |
| 2 | `BUMP` every 5 min for 2h (×24), free | 26 replies; only **1** bump queued per ad at a time |
| 3 | `BUMP` flood with `bumpCost=1` | Charged 1 credit/bump, **refused when broke** — leak closed |
| 4 | Expired-ad revival loop ×5, free | **5/5 free revivals** — a 1-credit ad kept alive 5 months for $0 |
| 5 | `PIC`/MMS flood ×500 (one hour, **quota OFF**) | **12 MMS** — hourly cap alone; scenario 18 tightens it |
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
| 16 | `SOLD` same ad ×20 in a row | **1** state transition; the rest idempotent no-ops, tail silenced by the cap |
| 17 | `AD SOLD <id>` ×20 (the parse case) | **0** junk ads, **0** credits burned — re-routes to the SOLD command |
| 18 | `PIC` hammer for 5 days, **quota ON** (3/day) | **[3,3,3,3,3] MMS** — daily allowance caps picture cost per day |
| 19 | `PIC` rolling bank: idle 2 weeks then burst | **20 MMS** (the bank cap) — unused pulls stack but stop at the ceiling |

## What holds up (the defenses that work)

- **PIC daily allowance + rolling bank (NEW, session 006)** — the real MMS cost
  control. Each number gets `picDailyAllowance` (default **3**) photo pulls per ET
  day; unused pulls bank up to `picBankCap` (default **20**). Scenario 18: a number
  hammering PIC is held to **3 MMS/day** no matter how hard it tries. Scenario 19:
  banked pulls stop accruing at the cap, so a saved-up user gets a cushion but not
  infinity. Atomic accrue-then-spend (advisory lock, `reserve_pic_quota`, migration
  9989) so a concurrent burst can't overspend the bank. Admin-tunable on Settings;
  set the daily number to 0 to turn it off.
- **Per-number reply cap (20/hr)** bounds any single-number command flood
  (STATUS, BUMP, SOLD, gibberish) to ~20 cheap replies/hr regardless of how hard
  they hammer.
- **Per-number hourly PIC cap (12/hr)** is now a burst limiter on top of the daily
  quota.
- **Service-wide cap (500/hr)** bounds total command-reply spend to **~$8/hr** even
  under a many-number swarm.
- **Dedup (1/number/day)** on STOP confirmations, new-subscriber catch-up, and the
  unknown-command redirect. The "you're out of picture pulls" note is deduped to
  once / 3h / number.
- **Idempotency**: inbound provider-id dedup blocks webhook replay double-posts/charges;
  `SOLD` on an already-sold ad is a no-op ("already marked sold").
- **Ownership checks** block cross-user griefing (marking/bumping someone else's ad).
- **Ingest guards**: `maxChars` rejects giant bodies; the content filter strips emoji.
- **Command re-route**: `AD SOLD 1325` (and `AD BUMP/STATUS/PIC <id>`) now parse as the
  owner command, not an ad body, so a mistyped SOLD can't silently post a junk ad and
  burn a credit.
- **Operator levers** are decisive: **UNDER ATTACK** tightens caps + suppresses unknowns;
  the **blocklist** drops a number entirely.
- **Starter-grant deferral** (session 005): a spoofed-number subscribe flood mints **zero**
  free-ad liability.

## Worst-case cost ceilings

- **One abusive number:** ~20 replies/hr + **3 MMS/day** (was 12/hr) ≈ **$0.16/hr +
  ~$0.11/day**, and the blocklist ends it in one click.
- **Whole service under saturation:** command replies capped at 500/hr = **$8/hr**, and
  the digest broadcaster is separately capped by `digestDailySegmentBudget` = **$96/day**.
  UNDER ATTACK cuts both hard.

## Residual leaks (known from Round 3)

- **Free bumps / free infinite revival** (`bumpCost=0`): scenario 4 kept a 1-credit ad
  alive 5 months for $0. **Setting `bumpCost` > 0 closes it** (scenario 3 proves it). Still
  open pending a pricing decision.
- **PIC/MMS per-ad and service-wide cap** — the daily allowance now bounds a single number
  to N/day (scenario 18), which is the dominant lever. A *many-number swarm* each pulling one
  popular photo is still bounded only by the hourly per-number cap and the global 500/hr
  reply cap (each fresh number gets its own first-day allowance). A per-ad or global daily MMS
  budget would close the swarm case fully; the per-number quota already closes the
  single-abuser case that scenario 5 flagged.
- **New-subscriber catch-up is invisible to the digest segment budget** (session 005 note),
  bounded by the global 500/hr cap + per-day dedup but not by the cost breaker.

## Caveat

Concurrency races (scenario 7) are shown against the file store only, which has no atomic
guard. **Production uses Supabase RPCs** (`spend_credits`, `consumeFreeAd`, `reserveSms`, and
now `reserve_pic_quota`) with advisory locks — that is the path that runs in prod.
