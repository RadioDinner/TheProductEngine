# Profitability audit — The Plain Exchange

Round 3 of the three-round audit (security → function → profitability), session
005, 2026-07-09. Every figure below is computed from the **real** segmentation
and packing code (`lib/sms-segments.ts`, `lib/digest-engine.ts`), not estimated.
Unit costs are the operator's: **SMS $0.008/billed segment, MMS $0.035/pull.**

## Bottom line

The business is **profitable up to ~150 free subscribers** at current pricing and
a typical ad mix, then goes **increasingly underwater as the free list grows** —
because revenue is fixed by *ad volume* while cost scales with *subscriber count*.
This is structural, not a bug. Getting to sustainable break-even at scale needs a
pricing/monetization decision (below), plus a handful of code safety-valves that
stop specific zero-revenue broadcasts.

## The cost model

Each subscriber receives the whole digest, so:

```
cost / subscriber / day   = digest_segments_that_day × $0.008
break-even $ per credit    = subscribers × (avg_ad_septets / 153) × $0.008
```

The number of ads cancels out of the break-even price — it depends only on **how
many subscribers** and **how long the average ad is**. Real ad-line sizes:

| Ad | Example | Septets | Marginal seg/ad |
|---|---|---:|---:|
| short | "Laying hens, $8 each. Berlin. 330-555-0142" | 48 | 0.31 |
| medium | "Oak table w/ 6 chairs… $400 OBO… call…" | 94 | 0.61 |
| long (~250c) | full 250-char ad | 220 | 1.44 |

**Break-even $/credit** (rows: avg ad length, cols: subscribers):

| ad \ subs | 50 | 100 | 150 | 300 | 500 | 1000 |
|---|---:|---:|---:|---:|---:|---:|
| short | $0.13 | $0.25 | $0.38 | $0.75 | $1.25 | $2.51 |
| medium | $0.25 | $0.49 | $0.74 | $1.47 | $2.46 | $4.92 |
| long | $0.58 | $1.15 | $1.73 | $3.45 | $5.75 | $11.50 |

Current sale price is **$0.72** (25-pack + saved-card discount) to **$1.00**
(5-pack). So at 150 subscribers short/medium ads still clear; long ads are
already underwater. Past ~300 subscribers every ad type loses money at these
prices.

**Daily margin, concrete** — 8 medium ads/day (a real packed digest = **6
billed segments/subscriber/day**, 2 parts), sold at $0.90/credit:

| Subs | Revenue/day | Broadcast cost/day | Margin |
|---:|---:|---:|---:|
| 50 | $7.20 | $2.40 | **+$4.80** |
| 100 | $7.20 | $4.80 | +$2.40 |
| **150** | $7.20 | $7.20 | **$0.00 (crossover)** |
| 300 | $7.20 | $14.40 | −$7.20 |
| 500 | $7.20 | $24.00 | −$16.80 |
| 1000 | $7.20 | $48.00 | −$40.80 |

Monthly broadcast cost for that digest: **$216/mo at 150 subs, $720 at 500,
$1,440 at 1,000.** (This corrects the older "$5k/mo at 1,500 subs" note, which
assumed 4 slots × 7 seg; each ad broadcasts once/day regardless of slot count,
so 2 slots × 6 seg is ~$2,160/mo at 1,500.)

## Where the money goes (cost drivers, ranked)

1. **Digest broadcast** — dominant, ~95% of cost. Scales with subscribers.
2. **PIC/MMS pulls** — $0.035 each, free + repeatable to buyers, uncapped per ad.
3. **New-subscriber catch-up SMS** — one recent-digest send per opt-in, free.
4. **Command replies** (OTP, HELP, confirmations) — small; ~$38/mo at 150 subs.

## Revenue leaks — code-fixable (recommended)

These deliver value at **zero revenue** and are fixable without a pricing change.
Dollar figures at 150 / 1,000 subscribers.

1. **Free bumps re-broadcast to the whole list** (`bumpCost` default 0). A paid
   ad can be BUMPed to the entire list, unlimited, for free — only guard is one
   queued bump per ad. Cost ≈ ad_segments × subs × $0.008 = **~$2.40/bump at
   150 subs, ~$16 at 1,000.** *Fix: set a default `bumpCost` > 0, and/or a
   per-ad bump quota/cooldown.*
2. **Free infinite revival of expired ads** (`engine.ts:247` → `reviveAd`). At
   `bumpCost=0`, BUMP on an expired ad relists it with a **fresh 30-day TTL** for
   free, forever — a 1-credit ad broadcasts indefinitely. *Fix: charge for
   revive (independent of bumpCost) or add a revival cooldown/quota.*
3. **PIC/MMS has no cost cap and is outside the daily breaker** (`outbound.ts`).
   Per-number worst case for ONE ad = 12/hr × 24 × 30d × $0.035 = **$302 of MMS**
   against a $3.60–5.00 photo ad. *Fix: a per-ad and/or global daily MMS budget,
   parallel to the SMS segment budget.*
4. **Catch-up SMS is invisible to the digest budget** (`digest-engine.ts:143`).
   Onboarding is $0.056/subscriber (raw send, not counted against the segment
   budget). At 1,000 opt-ins = **$56**, uncapped by the cost breaker. *Fix: count
   catch-up segments toward the rolling budget.*
5. **Starter free ads cover the photo tier** (3 free ads, either type). A new
   seller can spend all 3 on 5-credit photo ads → 3 full broadcasts + free PIC
   MMS at $0 revenue. (Session 005 already deferred the grant to first `AD NEW`,
   closing the spoofed-number version.) *Optional: restrict starter passes to the
   text tier, or grant fewer.*

## Pricing levers — your decision

These aren't bugs; they're the monetization model.

- **Credit price vs break-even.** At scale you need price ≈ subs × seg/ad ×
  $0.008. Options: raise the flat price; **tier price to list size** (a live
  break-even readout on `/admin` so price never sits below marginal cost);
  **length-based pricing** (a 250-char ad costs more segments than an 80-char
  one but both cost 1 credit today); or accept broadcast cost as customer
  acquisition and monetize elsewhere.
- **Volume-discount packs invert the economics** — the 25-pack ($0.80) and the
  saved-card stack ($0.72) give the *biggest* buyers the *lowest* price for
  identical-cost broadcasts. Consider flattening or removing the discount.
- **Monetize the free side.** The cost is the free subscriber list. Options
  already scaffolded in the code: subscriber fees, per-county subscriptions,
  premium ads.

## Scaling playbook (staged)

| Subscribers | What binds | Action |
|---|---|---|
| 0–150 | Nothing | Profitable at current pricing. Launch as-is. |
| ~150–300 | Margin crosses zero for medium/long ads | Decide the pricing model before you cross ~200. |
| ~500 | Monthly cost ~$720; carrier throughput matters | Pay the ~$41.50 external carrier vetting (raises the T-Mobile cap). |
| ~1,400–2,000 | **T-Mobile 2,000/day unvetted cap** AND the 12k segment budget both bind | Vetting is mandatory well before here; raise `digestDailySegmentBudget` deliberately (it's ~8× launch spend today, so it gives no early warning). |

The **12,000-segment/24h budget** = a hard $96/day ceiling, but it *pauses*
delivery rather than repricing, and it trips at ~2,000 subs (above the carrier
cap). It's a runaway-cost backstop, not a margin tool. Consider lowering it to
something near real launch spend so a sudden list jump alerts you early.

## What I recommend

- **Launch now** — profitable at the Holmes County starting scale (<150 subs).
- **Before ~200 subscribers**, pick a monetization model (tiered price is the
  lowest-friction; a `/admin` break-even readout keeps you honest).
- **Ship the safety-valves** (leaks 1–4 above) whenever you're ready — they stop
  specific zero-revenue bleeds and are pure code, no pricing change.
