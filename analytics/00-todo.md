# The analytics worklist

The shared to-do list. **Owner** says who does each item: 🧑 the operator (in
the GA console, in Vercel, or a decision), 🤖 code.

Tick things off here as they land. The detail behind each item lives in the
numbered documents; this is the tracker.

---

## ✅ Done

**In the GA4 console**

- [x] Property created — `The Plain Exchange`, Eastern time, USD
- [x] Web data stream, measurement id **`G-0P031ZCC9Z`**
- [x] Measurement Protocol API secret created
- [x] Data retention → **14 months** (defaults to 2 — the one that destroys data while it waits)
- [x] Google Signals → **off**
- [x] Reporting identity → **Blended**
- [x] Unwanted referrals → `stripe.com`
- [x] Privacy decision: browser tag + policy rewritten

**In Vercel** — `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `GA_API_SECRET`, `ANALYTICS_SALT`

**In the code**

- [x] The staged library: config, catalogue, salted ids, browser emitter, MP sender, server helpers
- [x] `/privacy` rewritten and shipped in the same commit as the tag
- [x] Browser tag in `app/layout.tsx`, operator excluded
- [x] `page_view` on every App Router navigation
- [x] `sms_inbound` on every inbound text, tagged with its parsed command
- [x] `sms_reply_suppressed` when a rate cap or attack mode eats a reply
- [x] `purchase` on top-ups and sponsorships, from the webhook, inside the ledger-ref guard
- [x] `ga_client_id` carried through Stripe checkout
- [x] `view_item`, `view_item_list`, `select_item`, `ui_click`
- [x] `listing_reveal`, `listing_reveal_blocked`, `chat_start`
- [x] First-party counter records `/ad/<id>` rather than one `/ad` bucket
- [x] `/api/health` reports all four GA flags
- [x] 77 unit checks, registered in the main suite

---

## 🔴 Do next

### 🧑 Register the custom definitions — **not retroactive**

**Admin → Data display → Custom definitions.** Nothing already collected gets
these applied; they report from the day they are created. Every day of delay is
a day of data that cannot be broken down later.

Event-scoped dimensions:

- [ ] `channel` — sms / web / email / voice
- [ ] `listing_category`
- [ ] `command` — the SMS vocabulary, incl. `unknown`
- [ ] `reason`
- [ ] `method`
- [ ] `outcome`
- [ ] `payment_channel`
- [ ] `click_text`
- [ ] `click_section`
- [ ] `results_count`
- [ ] `has_photo`

User-scoped:

- [ ] `member_status`, `signup_channel`, `line_type`, `has_saved_card`

Metrics (mind the unit — `wait_minutes` is minutes, `days_to_sell` is standard):

- [ ] `photo_count`, `segments`, `recipients`, `wait_minutes`, `days_to_sell`,
      `reveals_left`, `duration_seconds`

### 🧑 Mark the key events

- [ ] `sign_up`, `post_submit`, `listing_reveal`, `listing_sold`, `purchase`,
      `generate_lead`

Six, and no more. Marking everything a conversion is the same as marking
nothing.

### 🧑 Filter out your own traffic

The tag already skips you when signed in as admin. Signed out, or in a private
window, you are counted like anyone else — and on a service this size that is
enough to distort every rate.

- [ ] Admin → Data streams → Configure tag settings → Show all → **Define internal traffic**
- [ ] Admin → **Data filters** → set Internal Traffic from *Testing* to **Active**
      *(it ships inactive; this is the most-missed step in a GA4 setup)*

### 🧑 Verify the pipeline end to end

- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/health` — all four GA flags
- [ ] Set `GA_DEBUG_MODE=1`, redeploy
- [ ] Text the service number → `sms_inbound` in DebugView within seconds
- [ ] Text deliberate nonsense → arrives as `command: unknown`
- [ ] Load the site signed out → `page_view`; open a listing → `view_item`; click one from the homepage → `select_item`
- [ ] Turn `GA_DEBUG_MODE` back off

---

## 🟡 Code still to write

### Wave 1b — the SMS events that need the outcome, not the intent

Deliberately not wired from the route, because from there they would be wrong.
Each belongs where `route()` settles the outcome.

- [ ] `post_submit` (channel `sms`) — at the point the ad is actually accepted,
      not when the text arrives. From the route it would count ads the word
      filter, the balance check or the blocklist then refused. An inflated
      supply number is worse than none: it is the figure the roadmap is argued
      from.
- [ ] `post_blocked` with the refusal reason — the other half of the same story
- [ ] `sign_up` (method `sms`) — only for genuinely new members, not every
      re-SUBSCRIBE
- [ ] `unsubscribe` on STOP
- [ ] `pic_pull` with its real outcome — served, out of pulls, throttled

### Wave 2 — the ad lifecycle

- [ ] `listing_approved` with `wait_minutes` — review latency is entirely under
      the operator's control and directly shapes the seller's experience
- [ ] `listing_rejected` with a reason code
- [ ] `listing_broadcast` with recipients and segments — reach per ad, and what
      it cost to deliver
- [ ] `listing_sold` with `days_to_sell` — **the number that proves the service
      works**, and the one to put in front of a business advertiser
- [ ] `listing_expired`

### Wave 3 — the rest of the web surface

- [ ] `recordVisit` on the ten uncounted pages (`/faq`, `/how-it-works`,
      `/advertising`, `/email`, `/sms`, `/login`, and the policy pages)
- [ ] `search` with `results_count` — then turn OFF Enhanced Measurement's Site
      search, and not before
- [ ] `post_start` on `/account/post` — how many people start an ad and never finish
- [ ] `login`, and web `sign_up`
- [ ] `contact_submit`, `town_hall_submit`, `email_signup`
- [ ] `begin_checkout`
- [ ] `forgetUser()` on sign-out — shared machines are common in this community,
      and without it the next person inherits the last one's id

### Wave 4 — money and the phone line

- [ ] `refund`, `auto_topup`, `starter_credit_granted`
- [ ] `call_inbound`, `card_saved` from `/api/voice`
- [ ] `email_edition_sent` per edition

### Wave 5 — user properties

- [ ] `member_status`, `signup_channel`, `line_type`, `has_saved_card`

These are what turn "sellers versus buyers" from a guess into a filter. One
blended average describes neither group.

### Wave 6 — the first-party upgrade

- [ ] Move `sql/first-party-upgrade.sql` into `supabase/migrations/`, renamed
      `<lowest existing − 1>_analytics_upgrade.sql` **taken at the moment you
      move it** — parallel sessions have claimed numbers before
- [ ] Paste it by hand in the Supabase SQL editor. Never `supabase db push`
- [ ] Rewrite `recordVisit` to call `bump_visit` with referrer, campaign and the
      daily visitor token
- [ ] Degrade guard on `PGRST202`/`PGRST205` so a page never 500s pre-paste

Why bother when GA does this: GA cannot see a visitor with JavaScript off — a
real share of this audience — and its retention tops out at 14 months. Anything
you want to ask in three years has to live in our own database.

---

## 🔵 Operational

- [ ] Build the four explorations in `06-operating-the-numbers.md` (buyer
      funnel, acquisition→money, seller cohorts, seller funnel)
- [ ] Set the three custom alerts
- [ ] Link **Search Console** — the only way to see what people google to find you
- [ ] Add a second **Administrator** to the Analytics account
- [ ] Start the Monday fifteen-minute routine
- [ ] Quarterly: take one number and verify it by hand against Supabase. A
      wired-wrong event produces a confident, plausible, wrong chart forever

---

## ⚠️ Not analytics, but open and adjacent

- [ ] **Edit the Telnyx HELP auto-response.** The app no longer replies to HELP,
      so the carrier keyword response is the ONLY answer this service gives —
      and carriers require one. It currently advertises BUMP and CREDITS, both
      removed in session 016. It is not in version control and no test can reach
      it: check it whenever the messaging profile is touched.
- [ ] **Check whether STOP double-replies** the same way HELP did.
- [ ] **The 10DLC campaign description still says "up to 4 digests/day."** The
      app has not sent digests since session 016. A registered description that
      does not match real traffic is what carrier audits look for. Carried since
      session 016 addendum 3.
