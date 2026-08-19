# Pricing — The Plain Exchange

Decided in session 016 (2026-08-18) after a competitor-pricing review. This
file is the durable spec for the DOLLAR pricing structure that replaced the
credit-pack system. The competitor is deliberately not named in the repo
(session 010 standing order); their sheet: $65 per ad with up to four
pictures, $45 per text ad under 160 characters, print distribution.

## The price sheet (user decisions, session 016)

| Product | Price | Where set |
|---|---|---|
| Text ad (up to 250 chars, one digest broadcast + website) | **$45** | `/admin/settings` (`ad_price_text_cents`) |
| Picture ad (up to 4 pictures, collage on SMS, originals on web) | **$60** | `/admin/settings` (`ad_price_photo_cents`) |
| Picture upgrade on a text ad (photo texted later) | price difference ($15) | derived |
| Website listing add-on | **+$15 — FREE at launch** (`web_addon_cents` = 0; flip to 1500 to charge) | `/admin/settings` |
| Starter credit (every new member, granted on FIRST post) | **$150** | `/admin/settings` (`starter_credit_cents`) |
| Re-runs (BUMP) | **REMOVED — feature gone** (user decision: "completely gone, from everywhere") | — |
| Business package: sponsor line in every daily digest, 1 week | **$199** | `lib/business-packages.ts` (code) |
| Business package, 2 weeks | **$349** | code |
| Business package, 1 month | **$599** | code |
| Subscribing (SMS + email), browsing, PIC pulls | free (unchanged) | — |

All money is stored in **cents** in the credit ledger (`credit_ledger.delta`);
the balance is dollar-denominated "ad credit". Migration `9973` converts
legacy credit-era rows (×100) and legacy free-ad passes ($60 each — a pass
covered any ad type).

## How sellers pay (user decision, session 016)

1. **$150 starter credit** — granted on the first real AD NEW / web post
   (NOT at account creation — the session-005 anti-abuse rule stands).
   $150 covers 3 text ads, or 2 picture ads with $30 left. (If the promise
   is "3 free ads of any kind," set starter credit to $180 on Settings —
   3 picture ads = $180.)
2. **Auto top-up** — a member with a saved card is topped up automatically
   at posting time: the shortfall is charged to the card, the confirmation
   text states the charge. Opt-out toggle on /account and /admin/users.
   Fail-closed: before migration 9973 (no `auto_topup` column) no card is
   ever auto-charged.
3. **Add money on the website** — preset amounts ($45 / $60 / $150 / $300)
   via Stripe Checkout; the card is saved for auto top-up.
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

From `docs/profitability.md` (SMS $0.008/segment, MMS $0.035/pull): a
medium ad costs ~0.61 segments × subscribers × $0.008 to broadcast — about
$0.73 at 150 subscribers, $4.88 at 1,000, $14.64 at 3,000. A $45 ad clears
its own delivery cost at ANY plausible list size; the structural risk is
the free subscriber list, which these prices fund. One paid picture ad per
day (~$1,800/mo) covers the broadcast cost of a 1,000+ subscriber list.
The real bet is conversion: will Holmes County sellers pay $45–60? The
$150 starter credit is the test instrument — watch the paid-ad conversion
rate after starter credit burns down.

## Coherence rules (keep these when repricing)

- The business package must always cost MORE than a single ad (user
  decision) — it buys 7/14/30 daily sponsor-line insertions.
- The website add-on price must stay below the text-ad price (it's an
  add-on, not a product). While `web_addon_cents` = 0 every ad lists on
  the website automatically; when > 0, web-posted ads buy it with a
  checkbox, SMS ads default to NOT listed (operator can toggle per ad —
  the SMS self-serve add-on flow is a documented seam, not yet built).
- Refund matrix (unchanged in shape, now in dollars): never ran → full
  refund; ever broadcast → no refund; violation → no refund + strike.
- Event listing ($19.99 idea) and Featured slots remain deliberately
  unpriced — decide before wiring.
