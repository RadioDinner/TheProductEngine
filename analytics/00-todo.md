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

## ✅ Code — all waves written

Every wave in the original plan is now wired, verified and on `main`.

- **1b** `post_submit` at acceptance (not arrival), `post_blocked` with eight
  distinct reasons, `sign_up` for genuinely new members only, `unsubscribe`,
  `pic_pull` with its real outcome
- **2** `listing_approved` with wait_minutes, `listing_rejected`,
  `listing_broadcast` with reach and segments, `listing_sold` with days_to_sell
  on both lanes
- **3** the ten uncounted pages, `search` with results_count, `post_start`,
  `login`, `contact_submit`, `town_hall_submit`, `email_signup`,
  `begin_checkout` — and the sign-out identity leak fixed
- **4** `refund`, `auto_topup`, `starter_credit_granted`, `call_inbound`,
  `card_saved`, `email_edition_sent`
- **5** user properties: `member_status`, `signup_channel`, `has_saved_card`
- **6** migration **9961** written and `recordVisit` rewritten for referrer,
  campaign and unique visitors

Not built, and deliberately: `line_type` as a user property. It would need a
lookup on a path that does not already do one, and it answers a question nobody
is asking yet.

---

## 🔴 One paste, and it is on you

- [ ] **Paste `supabase/migrations/9961_analytics_upgrade.sql`** into the
      Supabase SQL Editor. Never `supabase db push` — the CLI applies in
      ascending order, which under this repo's descending scheme is
      newest-first.

Until it is pasted, `recordVisit` falls back to the old counter and warns once;
nothing breaks, and referrer/campaign/unique-visitor data is simply not
collected. `/api/health` → `migration9961` tells you which state you are in.

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
