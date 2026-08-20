# Operating the numbers

Measurement that nobody reads on a schedule is not measurement. This is the
routine, the four reports worth building once, and — the part usually left
out — how to avoid making decisions on noise.

---

## First, the thing that will mislead you most

**This service is small, and small numbers wobble.**

At a few hundred subscribers, a week with 18 ads and a week with 24 ads are the
same week. Nothing happened. If you treat that 33% "increase" as a result, you
will conclude that whatever you did last Tuesday worked, and you will do more of
it for months on no evidence.

A working rule of thumb: **for a count under about 30, ignore a change smaller
than roughly the square root of the count.** Twenty-five ads a week? Changes
under ±5 are noise. Four sponsorships a month? Almost any month-to-month change
is noise.

What to do instead:

- **Compare four weeks to the previous four**, never a week to a week.
- **Watch rates, not counts.** "Ads posted" moves with how many people happened
  to be around. "Of people who viewed a listing, what share pressed Show
  number" holds steady and moves for real reasons.
- **Write down the prediction before the change.** "This should lift the
  view-to-look-up rate above 20%." A number you interpret after the fact will
  always confirm whatever you already believed.

---

## Monday morning, fifteen minutes

Five numbers, four weeks against the four before.

| # | Number | Where | What a move means |
| --- | --- | --- | --- |
| 1 | New members, split by `sign_up.method` | GA → Reports → Engagement → Events, or Explore | The only read on whether marketing is working. A `method` mix that shifts is more informative than the total. |
| 2 | Ads posted, split by `post_submit.channel` | same | Supply. If `web` grows and `sms` falls, the product is quietly becoming a website, and everything from pricing to the welcome message needs rethinking. |
| 3 | View → look-up rate | Exploration 1 below | The health of the listings themselves. Falling means the ads are getting worse or the allowance is too tight. |
| 4 | Money in | GA Monetization, reconciled against Stripe | GA is the trend; **Stripe is the truth.** If they diverge by more than a rounding error, the wiring is wrong — go and find out why before trusting either. |
| 5 | `sms_inbound` where `command = unknown` | GA → Events, filtered | People who tried to use the service and were not understood. Read the top few every week; each one is a wording fix worth more than most features. |

If only one of these can be looked at, make it **number 5**. It is the only one
that tells you what to *do* rather than how you did.

---

## Once a month

- **Sell-through and days-to-sell**, by category (`listing_sold`). The proof the
  service works, and the number to put in front of a business advertiser.
- **Seller retention** (Exploration 3). Do people post a second ad? Nothing
  matters more to whether this compounds.
- **Review latency** (`listing_approved.wait_minutes`, the median, not the
  mean — one ad approved after a weekend away drags an average badly). This is
  entirely under the operator's control and directly shapes the seller's
  experience.
- **Delivery cost against revenue** — segments and MMS from the Telnyx bill
  against `purchase` value. Stays in Supabase and a spreadsheet; GA never sees a
  carrier invoice.
- **Starter-credit burn** against `starterCreditLimit` (200). It is a launch
  offer with an end, and it should be watched approaching it, not discovered
  after.

---

## Four explorations, built once

**Explore → Blank**, in GA4. Building these once is the difference between GA4
being useful and GA4 being a page of charts nobody opens.

### 1. The buyer funnel — *Funnel exploration*

```
Step 1  page_view
Step 2  view_item
Step 3  listing_reveal
Step 4  chat_start
```

Open funnel, breakdown by `listing_category`. Read the **step 2 → 3** rate: that
is whether the listings are worth acting on. Read **3 → 4** to see whether
people prefer to phone (invisible to us, and fine — most will) or to message.

### 2. Acquisition to money — *Free-form*

Rows: `Session source / medium`. Columns: nothing. Metrics: `Total users`,
`Key events`, `Total revenue`.

This is the report that decides where the marketing money goes. **It is only
correct if step 4 of `04-wiring.md` is done** — without the `_ga` client id
carried into Stripe, every payment lands under `(direct)` and this exploration
quietly reports nonsense while looking perfectly normal.

### 3. Do sellers come back? — *Cohort exploration*

Inclusion: `post_submit`. Return criterion: `post_submit`. Granularity: weekly,
six weeks.

The single most important chart in the property. A service where sellers post
once and never return needs a different product, not more marketing.

### 4. The seller funnel — *Funnel exploration*

```
Step 1  post_start
Step 2  post_submit
Step 3  listing_approved
Step 4  listing_sold
```

Where 1 → 2 leaks, the posting form is the problem. Where 3 → 4 leaks, the
pricing or the reach is.

---

## Alerts worth setting

**Admin → Custom insights → Create.** GA emails when a condition is met. Three,
and no more — an alert that fires every week is training to ignore alerts.

1. **`post_submit` count drops more than 50% week over week.** Supply stopping
   is the emergency; everything else can wait a day.
2. **`purchase` count is zero for 3 days.** Either payments are broken or nobody
   is buying, and both need looking at immediately.
3. **`sign_up` anomaly detection.** GA's own model, useful in both directions —
   an unexplained *spike* is usually a bot or a bug.

Set the SMS-volume and cost alarms in the app, not in GA. GA does not know the
segment budget and does not see the carrier bill.

---

## What stays ours, permanently

GA is the behavioural layer. It is a modelled, sampled, 14-month-retained view
that a browser extension can block. It should never be the answer to:

- **Money.** The ledger and Stripe. Always.
- **Delivery.** Did the text send, was it delivered, what did it cost.
- **Quotas and abuse.** `/admin/insights` already does this well, and it reads
  the real rows rather than a sampled report.
- **Anything older than 14 months.** `sql/first-party-upgrade.sql` keeps the
  visit and source aggregates in our own database, forever, in a form that can
  be queried in three years.

When GA and Supabase disagree, **Supabase is right.** GA drops what ad blockers
block, models what consent denies, and samples what gets large. That is a fine
trade for understanding behaviour and an unacceptable one for counting dollars.

---

## Reading it honestly

Three failure modes, all of them common, all of them expensive:

- **Confirmation.** The number you go looking for is the number you find. Decide
  what would change your mind *before* opening the report.
- **The dashboard nobody questions.** A wired-wrong event produces a confident,
  plausible, wrong chart forever. Once a quarter, take one number and verify it
  by hand against the database. If the two disagree, everything built on that
  number was wrong too.
- **Measuring what is easy.** Page views are easy; days-to-sell is hard and
  matters more. The gravity of any analytics tool is towards the easy numbers.
  The list at the top of this file is the counterweight — it opens with the
  things that are hard to measure and worth measuring, on purpose.
