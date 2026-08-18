# Session 016 — 2026-08-18 — the dollar pricing overhaul

Branch `claude/pricing-structure-overhaul-5ckcku` (designated task branch).
The user opened with an "all out emergency": they discovered their
competitor's pricing ($65 per ad with up to four pictures, $45 per text ad
under 160 characters — print; name deliberately kept out of the repo per the
session-010 order) and asked to be grilled on a comprehensive pricing
overhaul.

## What shipped

- `215d7d3` Session 016: start log
- `7597647` **Dollar pricing overhaul** — the credit system replaced by
  dollar-denominated ad credit; 48 files, migration `9973_dollar_pricing.sql`,
  new `docs/pricing.md` (the durable price sheet + rationale).

## The grilling → the decisions (all user, this session)

Reality check delivered first: the code was charging **$1.60–$2.00 per text
ad and $7.20–$10 per picture ad** (2/10 credits at $0.72–$1.00/credit), not
the "$10/$20" the user believed; delivery cost per ad is cents at launch
scale (docs/profitability.md), so "run at a loss" really meant "the free-ad
promo period" — at the new prices a single ad clears its delivery cost at
any plausible list size, and the real bet is **conversion**.

Decisions (via AskUserQuestion + free-text answers, logged verbatim in
prompt_history.txt):

1. **Price sheet: $45 text / $60 picture** (up to 4 pictures). Website
   listing add-on **+$15, initially FREE** — the machinery is built and the
   charge turns on by setting "Website listing add-on" above 0 on
   /admin/settings (after pasting 9973).
2. **BUMP is REMOVED — "completely gone, from everywhere, including the
   FAQ."** Command, web button, FAQ/how-it-works/help copy, parser. The
   ADMIN re-run/relist tool on /admin/ads was deliberately KEPT (operator
   curation; flagged to the user — remove on request). Closes the
   session-005 free-rebroadcast/revival leak by removal.
3. **Business packages $199 / $349 / $599** (wk/2wk/mo) — every tier must
   cost more than a single ad (was $39.99/$59.99/$89.99, upside down against
   the new ad prices).
4. **Money model: "Every new account ships with $150 ad credit. People can
   add cards to automatically top up, or they can send a check after a
   phone conversation."** Implemented as: $150 starter credit granted on the
   FIRST post (session-005 anti-abuse rule kept — subscribing mints nothing);
   auto top-up charges the saved card for the exact posting shortfall
   (consent = users.auto_topup, default true post-migration, FAIL-CLOSED
   before it; toggles on /account and /admin/users); check/cash lands via
   "Adjust balance ($)" on /admin/users.
5. User also said "I will give 3 free ads of any kind still" — at $150, 3
   picture ads = $180 don't quite fit. $150 (the later, specific instruction)
   was implemented; the amount is a setting (`starter_credit_cents`) — set
   $180 for the literal "3 of any kind."

## Build highlights

- All money is CENTS in `credit_ledger.delta`; NEW config keys
  (`ad_price_text_cents` 4500, `ad_price_photo_cents` 6000,
  `web_addon_cents` 0, `starter_credit_cents` 15000) so a stale credit-era
  row can never be misread; admin settings edits them in dollars.
- BUYCREDIT/YES flow, credit packs, and the saved-card discount are gone;
  "Add money" presets ($45/$60/$150/$300) via Stripe checkout replace packs;
  webhook grants cents idempotently; admin phone orders bill preset amounts.
- Ledger note format `Ad #<id> (<kind>)` unchanged (refund matchers are an
  API); the website add-on charges as its own line `Ad #<id> (website
  listing)` so refunds return it too. Legacy free-pass-paid ads refund the
  CURRENT price of their kind on benign reject / never-ran delete.
- ads.web_listing gates the public site only when the add-on is priced;
  queries fall back gracefully pre-migration. SMS sellers have NO self-serve
  add-on purchase flow yet (deferred seam, documented in docs/pricing.md);
  when priced, SMS ads default to NOT listed.
- Admin handbook updated per the session-015 rule (new entries
  settings.webAddon / settings.starterCredit / users.starterCredit; costs,
  ledger, phone-order, bump entries rewritten with the session-016 story).
- `/api/health` → `migration9973` (auto_topup column + money_unit marker).

## Verification

tsc clean · next build clean · unit suite 522/522 (commands/post-ad/myads/
business suites rewritten for dollars; bump tests now prove REMOVAL) ·
abuse suite 19/19 bounded (BUMP scenarios reworked: 0 queued, $0 charged,
0 revivals; AD NEW flood = 4 ads on $200; webhook replay = $105 balance) ·
37/37 Playwright walk checks (dollar copy on FAQ/how-it-works/refund-policy/
advertising; engine charges $45 off the $150 welcome credit; CREDITS replies
in dollars; BUMP → unknown redirect; member account/post pages + admin
settings/help/users all in dollars). Walk gotcha for future sessions:
`next start` is production mode — set SESSION_SECRET (and ENABLE_DEV_TOOLS,
ADMIN_PHONES) or every login 500s with the fail-closed secrets guard; dev
sign-in codes are rate-limited 3/hour/number, so reset `.data` between runs.

## Environment note

The Workflow tool is STILL broken in this container class (the session-015
permission-handler bug: every workflow-subagent tool call has its parameters
stripped — 7/7 agents got zero file access, reproduced by the critic agent
too). Mined and built inline instead, same as session 015.

## Open questions / next steps

1. **USER: paste `9973_dollar_pricing.sql`** (Supabase SQL editor) — until
   then: prices are already correct (code defaults), auto top-up stays OFF
   (fail-closed), but any legacy balances display 100× low and the packs
   table lingers. `/api/health` → `migration9973`.
2. **Stripe prod config is STILL the launch blocker** (carried since 013) —
   the test checklist was delivered in chat this session; at $45–60 ads it's
   more urgent, not less.
3. Decide later: when to flip `web_addon_cents` to 1500 (needs the SMS
   self-serve add-on flow + admin per-ad web toggle built first), event
   listing price ($19.99 idea), featured-slot prices; whether the admin
   re-run tool should also be removed; whether starter credit should be $180.
4. FAQ's old "first 200 subscribers" cap was never enforced in code and was
   dropped from the copy — the starter credit now goes to every new member's
   first post. Flag if the 200-member cap should be real.
