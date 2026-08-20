# What we measure today, and what it cannot tell us

Written by reading the code, not the intentions. Everything below cites the
file it came from, so it can be re-checked when it drifts.

## What exists

### 1. A page-view counter — `lib/analytics.ts`, migration `9998_analytics.sql`

Server-side and cookie-free, which is the right instinct for this audience: it
counts a visitor whose browser runs no JavaScript at all. One Supabase row per
(Eastern-time day, path), incremented through `bump_page_view`. `visit_stats()`
returns three numbers — today, last 7 days, all time — and they appear on the
admin dashboard through `lib/reports.ts`.

### 2. Operational insights — `lib/insights.ts`, shown on `/admin/insights`

A genuinely good piece of work, and the most useful measurement the service has
today. Over a rolling window (7, 30 or 90 days):

- inbound message count and unique senders
- ads all-time and in-window; the ad funnel as counts (pending, approved, sold,
  rejected, expired)
- money spent and money purchased in the window
- top advertisers, top senders, an engagement leaderboard with a weighted score
- abuse signals: picture-request-heavy numbers, number-look-up-heavy members
- two fixed-24-hour figures: people who ran out of picture pulls, and
  number-look-up usage

### 3. Roll-ups — `lib/reports.ts`

SMS subscribers, email subscribers, new subscribers in 7 days, ads total / 7-day
/ pending, the ten newest subscribers, and the visit stats above.

### 4. The call log — `lib/call-log.ts`

Who called, when, how long, and what came of it.

**Taken together: the service is not flying blind.** It knows its volumes, its
money, and its abusers. What follows is not a complaint about that work — it is
the list of questions those numbers were never built to answer.

---

## The eleven gaps

### 1. There is no attribution at all

Nothing anywhere records a referrer or a campaign tag. Not the page-view
counter, not the signup paths, not the ad-posting paths. So the single question
that decides where the next dollar of marketing goes — **where do members
actually come from?** — has no answer in this codebase, and no answer can be
reconstructed later from what is stored. A flyer, a Facebook post, a mention in
a print classified and a friend's recommendation are indistinguishable.

This is the most expensive gap on the list, and the only one that gets worse
with time: every week without it is a week of acquisition data that cannot be
recovered afterwards.

### 2. Page views cover four pages, and every ad is one bucket

`recordVisit` is called from exactly four places: `app/page.tsx` (`/`),
`app/ad/[id]/page.tsx`, `app/contact/page.tsx` and `app/town-hall/page.tsx`.
`/how-it-works`, `/faq`, `/advertising`, `/email`, `/sms`, `/login`, the whole
`/account` area and every policy page are uncounted.

And the ad page records the literal string `"/ad"`, not the ad's id. So "which
listings do people look at" — the question every seller asks and every pricing
decision depends on — is not answerable, even approximately.

### 3. "Visits" are views, not people

`visit_stats()` sums a counter. One person refreshing the homepage thirty times
is thirty visits. There is no unique-visitor figure, which means the traffic
number cannot be compared against the subscriber number in any meaningful way,
and a modest real audience can look like a large one.

### 4. There is no funnel, only totals

We know how many ads were posted and how many number look-ups happened. We do
not know what share of ad views became look-ups, or what share of look-ups
became conversations. Those *rates* are where the product decisions live: a
falling view-to-look-up rate means the listings are getting worse or the
allowance is too tight, and neither shows up in a count.

### 5. There is no history, only a rolling window

`getInsights(windowDays)` recomputes from scratch every time, and
`visit_stats()` returns today / last 7 / all time. Nothing stores what last
month looked like. So there is no trend line, no week-over-week comparison, and
no way to see whether a change helped — which is the entire purpose of
measuring. Ask "were we growing in June?" and the honest answer is that the
data to say so was never kept in a comparable form.

### 6. Nothing measures retention

`topAdvertisers` ranks by ads posted all-time. That flatters whoever joined
first and says nothing about whether anyone came back. The questions that
decide whether this business compounds — do sellers post a second ad, do
subscribers stay subscribed, does the starter credit buy a habit or just a
transaction — are all unanswered.

### 7. Sell-through and days-to-sell are missing

`adFunnel` counts ads with status `sold`. It does not give the **rate** (of ads
that ran, how many sold) or the **duration** (how long they took). Those two
numbers are the proof the service works. They belong on the front page of the
website and in every sales conversation with a business advertiser, and today
neither can be quoted.

### 8. Money is counted but not attributed

`creditsSpentInWindow` and `creditsPurchasedInWindow` are totals. Nothing ties a
payment to how that member found the service, which channel they post through,
or which category they sell in. Revenue per acquisition source — the number that
tells you which marketing to repeat — cannot be computed.

### 9. The SMS command surface is parsed but not studied

`computeInsights` runs `parseCommand` over inbound messages and counts `pic` and
`ad`. Everything else, including **`unknown`**, is discarded. Every `unknown` is
a person who tried to use the service and was not understood — the cheapest
product research available, thrown away at the moment it is generated.

### 10. Cost per outcome is not derived

The SMS segment budget (`digestDailySegmentBudget`) is enforced, and picture
pulls are metered. But nothing reports segments spent against ads sold, or MMS
cost against picture-ad revenue. The prices in `docs/pricing.md` were set from a
competitor's sheet; there is no measurement that says whether they clear the
delivery cost at the current subscriber count.

### 11. It is all one page, live, forever

Every figure is computed on demand for `/admin`, from the live tables. There is
no export, no snapshot, no alert. Nobody finds out that ad posting stopped on
Tuesday unless somebody happens to open the page and remember what normal looks
like. And `computeInsights` aggregates in the Node process over rows pulled from
the store — correct and fast at today's size, with a ceiling that arrives
quietly as the tables grow.

---

## What Google Analytics fixes, and what it does not

Worth being precise, because a third-party analytics product is very good at
making people believe the remaining gaps were filled.

**GA4 answers well:** gaps 1 (attribution), 2 (page and listing coverage),
3 (unique people), 4 (funnels), 5 (history and trend), 6 (retention and
cohorts) — and 8 partially, once purchases carry the browser's client id
through the Stripe webhook.

**GA4 does not answer:** gap 7 (sell-through needs our own ad lifecycle, though
`listing_sold` with `days_to_sell` gets most of the way), 9 (only if we send the
command events ourselves — that is the Measurement Protocol work), 10 (cost per
outcome needs carrier spend, which GA never sees), and 11 (GA has no idea what
"normal" is for this service; alerting on volumes stays ours).

**And GA4 cannot see:**

- anyone with JavaScript disabled or an ad blocker running
- anyone who never loads a web page at all — which on this service is most
  members, most days
- anything about money that is not explicitly sent to it

Which is why the plan in `02-measurement-plan.md` sends server-side events for
the whole SMS, voice and payment side, and why the first-party counters in
 `supabase/migrations/9961_analytics_upgrade.sql` stay: **GA is the behavioural layer; our own
tables remain the record.** Anything that has to be exactly right — money,
delivery, quotas — is answered from Supabase, not from Google.
