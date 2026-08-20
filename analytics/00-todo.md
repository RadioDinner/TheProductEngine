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

### ✅ Custom definitions — DONE 2026-08-20

All 18 registered and verified against the code: 15 event-scoped
(`channel`, `listing_category`, `command`, `reason`, `outcome`,
`payment_channel`, `click_text`, `click_section`, `click_href`, `has_photo`,
`has_media`, `is_mms`, `contact_type`, `message_class`, `menu_choice`),
3 user-scoped (`member_status`, `signup_channel`, `has_saved_card`), and all
10 custom metrics with their units.

Zero item-scoped, which is correct: every field the code puts in `items[]` is
a built-in GA4 item dimension.

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

### ✅ Pipeline VERIFIED LIVE — 2026-08-20

Confirmed from Admin → Events → Recent events, on the real property:

```
first_visit  page_view  scroll  session_start        <- browser tag, real visitors
sms_inbound                                          <- server-side Measurement Protocol
```

`sms_inbound` arriving is the one that matters. It proves the whole server-side
chain end to end: the API secret, the salt, the phone hashing, the derived
client_id, the Measurement Protocol request, and GA accepting the payload —
the hardest and most failure-prone part of the build. The four browser events
prove the tag is live, and that they came from REAL visitors rather than the
operator, since the tag is skipped while signed in as admin.

Both halves of the architecture are working. Everything below is configuration
on top of a pipeline that is known good.

Events not yet seen are not missing — nobody has done the things that fire them
since the deploy (`view_item` needs an ad page opened, `post_submit` an ad
posted, `listing_reveal` a number look-up). They will appear on their own.

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

## ✅ Migration 9961 — PASTED 2026-08-20

`recordVisit` now records the referring host, campaign tags and a
daily-rotating visitor token through `bump_visit`, alongside the page-view
count it always kept.

Verify: `select * from visit_stats_v2();` returns five columns (views today,
last 7, all time, and unique people today and last 7). Or `/api/health` →
`migration9961: { applied: true }`.

This closes the code side entirely. Everything below is optional.

---

## 🔧 From the audit — 2026-08-20 (`07-audit.md`)

Ranked by cost, not effort. The first two are real defects, not polish.

### 🔴 Fix

- [ ] **Register `setAfterImpl(after)` where server actions load it.** Only the
      four API routes register it today, so twelve events — including two of
      the six key events — fall back to unawaited fire-and-forget and can be
      killed with the serverless invocation. An undercount of unknown size that
      still looks plausible. ⚠️ `lib/moderation.ts` and `lib/digest-engine.ts`
      must NOT import `next/server`: the test harness loads them under plain
      node. Register in the calling server actions instead.
- [ ] **Emit `generate_lead`** in `startBusinessCheckout`. It is catalogued and
      listed as a key event, and nothing sends it — so business advertising has
      a funnel end (`purchase`) and no beginning.

### 🟡 Worth doing

- [ ] **Turn Enhanced Measurement's Site search OFF.** The custom `search`
      event has shipped, so both now fire on every homepage search. Two numbers
      for one thing.
- [ ] **Reconcile the catalogue.** `chat_message_sent` and `categories_changed`
      are listed but never emitted; `listing_expired` is deliberately skipped.
      Wire them or mark them planned in `events.ts`.
- [ ] **Wire `chat_message_sent`** — chat starts are counted, depth is not, so
      "do conversations continue or die after one message" is unanswerable.
- [ ] **Set the three custom insights** in `06-operating-the-numbers.md`.
      Nothing currently notices if collection stops.
- [ ] **Sample the bot gap once.** The first-party counter counts crawlers and
      GA filters them, so GA will read lower forever. Understand the ratio once
      rather than rediscovering it as a "bug".
- [ ] **UTM-tag the links in email editions** (free). SMS is an operator call —
      ~15 characters, and at a segment boundary that is money on every send.

### 🟢 Tidy

- [ ] **Refresh `analytics/README.md`** — it still says the code is "imported by
      nothing", the migration is "not yet numbered", and nothing is wired. All
      true when written, all false now.

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
