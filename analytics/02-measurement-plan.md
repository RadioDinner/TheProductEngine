# The measurement plan

The rule this plan is built on: **start from the question, not the event.**
Every event below exists because somebody will make a decision with it. An
event nobody reads still costs quota, still has to be maintained, and still
makes the property harder to trust — because the more numbers on a page, the
less anybody checks whether any of them are right.

The definitive list of events lives in code, in `analytics/src/events.ts`, with
the trigger and the question attached to each one. This document is the
reasoning; that file is the contract, and it is unit-tested.

---

## The nine questions

| # | Question | Answered by | Where |
| --- | --- | --- | --- |
| 1 | Where do members come from? | acquisition reports + `sign_up.method` | GA |
| 2 | Of the people who reach the site, how many become members? | `page_view` → `sign_up` funnel | GA |
| 3 | How many ads get posted, and by which channel? | `post_submit.channel` | GA |
| 4 | Which listings and categories get attention? | `view_item` + `listing_reveal` | GA |
| 5 | Does the service actually sell things? | `listing_sold.days_to_sell` | GA + Supabase |
| 6 | Do sellers come back? | cohorts on `user_id` | GA |
| 7 | What is a member worth, by source? | `purchase.value` + acquisition | GA |
| 8 | What do people text us that we do not understand? | `sms_inbound.command` = `unknown` | GA |
| 9 | What does delivery cost against what it earns? | `listing_broadcast.segments` + carrier bill | Supabase |

Question 9 stays ours on purpose. GA never sees the Telnyx invoice, and a cost
figure assembled from two systems that disagree is worse than no cost figure.

---

## The shape of it

Three streams into one GA4 property:

```
  Browser (gtag)          →  what people do on the website
  Our servers (MP)        →  what happens by text, by phone, and in cron
  Stripe webhook (MP)     →  what was actually paid for
                             ↓
                    one GA4 property
                             ↑
  Supabase (ours)         →  the record: money, delivery, quotas, history
```

The joins that make it one picture rather than three:

- **`user_id` is the same salted hash everywhere** (`analytics/src/ids.ts`). A
  member who texts on Monday and browses on Thursday is one person in GA.
- **Web-originated server events carry the browser's `_ga` client id**, so a
  Stripe purchase confirmed by webhook three minutes later still belongs to the
  visit — and the campaign — that produced it. Skip this and every payment on
  the service arrives from "(direct)" forever.
- **Off-web events use a client id derived from the member hash**, so a
  flip-phone seller is one consistent GA user across a year of texts instead of
  a fresh "user" per message.

---

## The naming decision you cannot skip

**GA4 reserves `ad_click`, `ad_impression`, `ad_exposure`, `ad_query`,
`ad_activeview` and `ad_reward`.** This business is about ads. Events sent under
a reserved name are discarded with no error, no warning and a `204 No Content`
reply that looks exactly like success.

So in GA, a classified ad is a **listing**: `listing_view`, `listing_reveal`,
`listing_approved`, `listing_sold`. It reads slightly against the grain of a
codebase that says "ad" everywhere, and that is the price of the collision.
`analytics/src/events.ts` enforces it in a test so it cannot come back.

Where Google's own recommended names genuinely fit — `sign_up`, `login`,
`purchase`, `refund`, `begin_checkout`, `search`, `view_item`, `select_item`,
`generate_lead` — we use them, because they light up GA4's built-in reports with
no configuration. Where they do not fit, we use our own and add a custom
dimension. Forcing a bad fit onto a recommended name is worse than a custom
event: it puts nonsense into a report somebody will later trust.

---

## Listings in `items[]`, and why

Ad detail views are sent as `view_item` with an `items[]` array
(`item_id: "ad_1234"`, `item_category`, `item_list_name`) rather than as a
custom event with an `ad_id` parameter.

The reason is cardinality. GA4 custom dimensions bucket high-cardinality values
into `(other)` once the daily limit is passed — with thousands of ads, an
`ad_id` dimension would degrade into exactly that, silently, at the moment the
service got big enough for the question to matter. The `items[]` reports are
built for high cardinality and do not.

**`item_name` is never sent.** An ad's name is member-written text, and members
put their phone numbers in ad bodies constantly — it is why the website masks
them. There is no safe way to send that field, so the type in `events.ts` does
not have it.

---

## Custom dimensions and metrics

GA4 will not report on a parameter until it is registered. Register these, and
nothing else until something is actually asked for — the ceilings are 50
event-scoped dimensions, 25 user-scoped, 50 custom metrics, and they are not
raised by asking.

### Event-scoped dimensions

| Parameter | Example | Why it earns a slot |
| --- | --- | --- |
| `channel` | `sms`, `web`, `email`, `voice` | The one cut that shapes the product. Every roadmap argument is really an argument about this number. |
| `listing_category` | `livestock`, `tools` | Which categories carry the service, and which never get browsed. |
| `command` | `ad`, `pic`, `unknown` | Question 8. |
| `reason` | `word_filter`, `no_balance` | Turns "posting is down" into a specific fix. |
| `method` | `sms`, `web`, `email` | Signup route, for question 1. |
| `outcome` | `granted`, `out_of_pulls` | Whether a limit is protecting the service or costing it. |
| `payment_channel` | `web`, `phone`, `auto_topup` | Whether the call-in card line pays for itself. |

### User-scoped dimensions

| Property | Values | Why |
| --- | --- | --- |
| `member_status` | `subscriber`, `seller`, `business` | Buyers and sellers behave nothing alike; one blended average describes neither. |
| `signup_channel` | `sms`, `web`, `email` | Lets every later metric be cut by how the member arrived. |
| `line_type` | `mobile`, `voip`, `landline` | Already known (`lib/number-lookup.ts`). Tells you whether VoIP restrictions are hitting real people. |
| `has_saved_card` | `yes`, `no` | The strongest predictor of a second purchase. |

### Custom metrics

`photo_count`, `segments`, `recipients`, `wait_minutes`, `days_to_sell`,
`reveals_left`, `duration_seconds`.

`wait_minutes` and `days_to_sell` are the two to watch. Review latency is
something the operator controls directly, and days-to-sell is the number that
proves the service works.

---

## Key events (conversions)

Six, and no more. Marking everything a conversion is the same as marking
nothing:

1. **`sign_up`** — a new member.
2. **`post_submit`** — supply. Without ads there is no service.
3. **`listing_reveal`** — the closest thing the website has to a sale, because
   the deal itself happens on a phone call we cannot see.
4. **`listing_sold`** — the outcome the whole service exists to produce.
5. **`purchase`** — money.
6. **`generate_lead`** — a business starting a sponsorship, the highest-value
   single action on the site.

`card_saved` is marked too if the call-in line is being evaluated; drop it once
that question is settled.

---

## What is deliberately NOT measured

- **Ad body text, titles, chat text, phone numbers, email addresses, names.**
  Google's terms forbid PII and `/privacy` promises members their number goes
  nowhere but delivery. `analytics/src/track.ts` scrubs anything phone- or
  email-shaped from every string parameter on the way out — not from a list of
  risky fields, from all of them, because the leak is always through the field
  nobody thought about.
- **Anything on `/admin`.** The operator's own clicks would be a meaningful
  share of traffic on a service this size and would corrupt every rate.
  Excluded at the wiring step, not filtered afterwards.
- **Scroll depth, rage clicks, session recordings.** Enhanced Measurement's
  extras are noise here: this is a text-first classifieds service for people who
  came to find a used harness, not a funnel to optimise by heatmap.
- **Individual email opens.** Tracking pixels are exactly what `/privacy`
  promises are absent from our emails. Edition-level sends
  (`email_edition_sent`) tell us what we need without a pixel.

---

## Rollout order

Do it in this order. Each step is useful on its own, and each one is a chance to
stop.

1. **The GA4 property, correctly configured** (`03-ga4-console-setup.md`) —
   including data retention and the advertising switches, which are painful to
   fix retroactively because the data is already gone or already shared.
2. **The privacy policy** (`05-privacy-and-consent.md`) — before the tag, not
   after. Today the policy states, in writing, that this site runs no analytics
   trackers. Shipping the tag first makes that sentence false while it is still
   published.
3. **Server-side events for SMS and payments.** Deliberately first among the
   code changes: they cover every member including the ones with no browser, and
   they need no consent decision because no cookie is involved.
4. **The browser tag**, with `page_view` and the acquisition parameters. This is
   where question 1 finally gets answered.
5. **Listing events** — `view_item`, `listing_reveal`, `chat_start`.
6. **The first-party upgrade** (`supabase/migrations/9961_analytics_upgrade.sql`) — referrer and
   campaign in our own tables, so the record survives GA's 14-month retention
   and the visitors GA cannot see.
7. **The operating routine** (`06-operating-the-numbers.md`). Numbers nobody
   reads on a schedule are not measurement; they are decoration.
