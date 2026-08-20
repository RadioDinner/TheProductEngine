# Pricing — The Plain Exchange

Decided in session 016 (2026-08-18) after a competitor-pricing review. This
file is the durable spec for the DOLLAR pricing structure that replaced the
credit-pack system. The competitor is deliberately not named in the repo
(session 010 standing order); their sheet: $65 per ad with up to four
pictures, $45 per text ad under 160 characters, print distribution.

## The price sheet (user decisions, session 016 — SECOND revision)

| Product | Price | Where set |
|---|---|---|
| Text ad (up to 250 chars) | **$20** | `/admin/settings` (`ad_price_text_cents`) |
| Picture ad, 1 picture | **$30** | `ad_price_photo_cents_by_count` |
| Picture ad, 2 pictures | **$40** | same |
| Picture ad, 3 pictures | **$50** | same |
| Starter credit — LAUNCH OFFER, first 200 members to post | **$40** | `starter_credit_cents` / `starter_credit_limit` |
| Website listing add-on | **+$15 — FREE at launch** (`web_addon_cents` = 0) | `/admin/settings` |
| Re-runs (BUMP) | **REMOVED — feature gone** | — |
| Sponsorship, 1 week | **$199** | `lib/business-packages.ts` (code) |
| Sponsorship, 2 weeks | **$349** | code |
| Sponsorship, 3 weeks | **$479** | code |
| Sponsorship, 4 weeks | **$599** | code |
| Subscribing (SMS + email), browsing, PIC pulls | free | — |

**Three pictures is the maximum** an ad can carry: the sheet stops there, so
an ad must never carry a picture nobody was charged for.

### Why it changed twice in one day

The first sheet ($45/$60) was priced against the PRINT competitor ($65 with
pictures, $45 text). Then a second competitor surfaced doing exactly what
this service does — classifieds by text — at **$15 text / $20 one picture /
$30 two-to-three, with $20 of free credit**. Being 3x a direct substitute in
a community that compares notes is not a position worth holding, so the sheet
was rebuilt around picture count and the starter credit became a bounded
launch offer. $150-then-$45 was the worst of both worlds: a generous trial
ending in a cliff exactly where a free user becomes a paying one.

### Pictures do NOT ride the broadcast

`photos_in_broadcast` is **false**. An ad says "Reply PIC 12" and the picture
goes only to those who ask. The arithmetic: MMS costs ~$0.035 per subscriber,
so auto-sending a $30 picture ad stops breaking even near **850
subscribers**, while an on-demand pull costs that only for the few who want
it. The website carries every picture, which is what makes the trade
comfortable — and the welcome text says so.

All money is stored in **cents** in the credit ledger (`credit_ledger.delta`).

## How sellers pay (user decision, session 016)

1. **$40 starter credit, for the first 200 members to post** — granted on the
   first real AD NEW / web post (NOT at account creation — the session-005
   anti-abuse rule stands), and only while `starter_credit_limit` has room.
   $40 covers two text ads, or one one-picture ad with $10 left. It is a
   GRANT, never the member's money: see "Granted credit is not refundable"
   below. Maximum exposure is `starter_credit_cents × starter_credit_limit`
   = **$8,000** at the launch values, and that is a marketing cost, not
   revenue foregone.
2. **Auto top-up** — a member with a saved card is topped up automatically
   at posting time: the shortfall is charged to the card, the confirmation
   text states the charge. Opt-out toggle on /account and /admin/users.
   Fail-closed: before migration 9973 (no `auto_topup` column) no card is
   ever auto-charged.
3. **Add money on the website** — preset amounts ($20 / $40 / $60 / $100)
   via Stripe Checkout (`TOP_UP_PRESETS_CENTS` in lib/config.ts); the card is
   saved for auto top-up. Sized to the sheet: one text ad, one two-picture
   ad, one three-picture ad with change, and a small bundle. Keeping the
   smallest preset AT the text-ad price is deliberate — it is what stops
   prepaid balances piling up, which is the liability discussed below.
4. **Check / phone** — the operator grants dollars from /admin/users after
   a phone conversation (Adjust balance), or bills the saved card, or texts
   a checkout link. BUYCREDIT/YES by text was REMOVED (auto top-up replaces
   it); the saved-card discount was removed with it.
5. **Call-in card capture** (FEATURES item 31, bridge built session 016) —
   the standalone pay-by-phone IVR (`pay-by-phone/`) saves a card the caller
   keys on their phone keypad; the app then ADOPTS that card automatically
   (`resolveStripeCustomer` searches Stripe by `metadata['phone']` = the
   E.164 caller id and stamps the member's `stripeCustomerId`) wherever a
   charge is attempted: auto top-up, admin "Bill their saved card", and the
   admin user view. Hard requirement: the IVR service and the app must use
   the SAME Stripe account/secret key. The IVR deploy itself (Twilio number,
   PCI Mode, Stripe Pay Connector) is ops — see pay-by-phone/README.md.

## Why these numbers hold up (delivery-cost reality)

From `docs/profitability.md` (SMS $0.008/segment, MMS $0.035/pull): a medium
ad costs ~0.61 segments × subscribers × $0.008 to broadcast — about **$0.73
at 150 subscribers, $4.88 at 1,000, $14.64 at 3,000**. Pictures do not ride
the broadcast, so a picture ad costs the same to send as a text one; the MMS
spend is the PIC pulls, which only the interested few request.

**The number to watch as the list grows: a $20 text ad stops covering its own
broadcast at about 4,100 subscribers** ($20 ÷ (0.61 × $0.008)). A $30
one-picture ad breaks even around 6,100, a $50 three-picture ad around
10,200. None of those are near today's list, but they are the reason the
sheet cannot simply stay put while the list triples — revisit the text price
when subscribers pass ~3,000, not after it goes underwater.

One paid one-picture ad per sending day (26 days) is about **$780/month**,
which covers the broadcast cost of a 1,000-subscriber list many times over.
The structural risk is the free subscriber list, which these prices fund.

The real bet is conversion: will Holmes County sellers pay $20–50 when the
direct substitute charges $15–30? The $40 starter credit is the test
instrument — watch the paid-ad conversion rate after it burns down, and note
that at 200 members it is capped at $8,000 of exposure.

## Sponsorship (reworked session 016)

Sold **by the week**, not by the day. A running sponsor gets:

- a labeled sponsor line on **one classified-ad text every day** — one
  sponsor per text, so the day's sponsors spread across the day's ads rather
  than stacking on the first one;
- their **banner in the email editions**, one sponsor per edition, rotated by
  fewest-banners-so-far, which works out to roughly 4 of the 21 weekly
  editions when all five slots are sold.

**Only five sponsors run in any one week** (`sponsor_weekly_slots`).
Unlimited businesses may buy; approval books the earliest week with room in
EVERY week of the term, so a two-week buyer holds both weeks at once and
later buyers wait for the first free week. The arithmetic lives in
`lib/sponsor-schedule.ts` and is unit-tested against the user's own worked
example (four one-week buyers, then a two-week buyer taking the fifth slot).

A "week" is **six sending days** — Sunday never sends, and a sponsor should
not pay for a silent day. Days are the ride ledger: a day with no ads costs
the sponsor nothing, so the run simply extends.

## Refunds, unused balances, and what a refund actually costs

**Stripe does not return the processing fee when you refund.** The 2.9% +
$0.30 was paid at capture and stays paid; refunding returns the full amount
to the member out of your balance. So a refund's real cost to you is the fee
already spent on that top-up, not a new charge:

| Top-up | Fee paid at capture | As a % of the top-up |
|---|---|---|
| $20 | $0.88 | 4.4% |
| $40 | $1.46 | 3.7% |
| $60 | $2.04 | 3.4% |
| $100 | $3.20 | 3.2% |

The flat $0.30 is why the percentage is worst on the smallest preset. Any
flat "we keep X%" rule has to clear 4.4% to cover the $20 preset, which is
what makes **5% a cost-recovery number rather than a penalty** — it
over-recovers by 0.6 to 1.8 points depending on the top-up size.

**Granted credit is not refundable as cash, ever.** A member who takes the
$40 starter credit and adds $20 has a $60 balance, but only $20 of it is
their money. Nothing in the code enforces this today — refunds are
operator-manual — so the income report's cash-backed vs granted split is what
the operator must read before sending money back. Spending grants BEFORE cash
is the fair default ordering and keeps the refundable liability as small as
it truly is.

**What the published policy says today** (`/refund-policy` and the T&Cs):
"Ad credit has no cash value, doesn't expire, and can't be transferred;
refunds of money you added are at our discretion, except where the law says
otherwise." Note that "at our discretion" is already weaker than a stated
percentage — moving to a published "95% back, we keep the card fee" is a
commitment to members, not a takeaway from them.

⚠️ **Still the user's decision** (raised session 018, discussed session 019):
whether to publish that percentage, and whether granted credit should expire.
Prepaid balances touch Ohio gift-card and unclaimed-funds law; a forfeiture
rule on money already taken wants an Ohio attorney or CPA first. A dormancy
nudge ("you still have $50 on your account") needs neither, and turns a dead
balance into either an ad or a clean refund.

## Coherence rules (keep these when repricing)

- A sponsorship must always cost MORE than a single ad (user decision), and
  the per-week price must FALL as the term lengthens (unit-tested) — a longer
  term is what makes locking one of five scarce weekly slots worth it.
- The website add-on price must stay below the text-ad price (it's an
  add-on, not a product). While `web_addon_cents` = 0 every ad lists on
  the website automatically; when > 0, web-posted ads buy it with a
  checkbox, SMS ads default to NOT listed (operator can toggle per ad —
  the SMS self-serve add-on flow is a documented seam, not yet built).
- Refund matrix (unchanged in shape, now in dollars): never ran → full
  refund; ever broadcast → no refund; violation → no refund + strike.
- Event listing ($19.99 idea) and Featured slots remain deliberately
  unpriced — decide before wiring.
