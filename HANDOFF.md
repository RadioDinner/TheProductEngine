# HANDOFF — The Plain Exchange

Live cross-session state document (per `new_session_instructions.md`). Update
this every session. Per-session detail lives in `Session log/`.

**Last updated:** 2026-07-17 (session 009, end).

⚠️ **MIGRATION NUMBERS RENAMED (session 009, user decision):** the repo now
uses the descending scheme from `new_session_instructions.md` §4 —
`9999_init.sql` counts down, lowest number = newest, **next migration =
(lowest − 1)** — after this session that means `9975_*`. Old ascending names
`0001`–`0019` were renamed with **new = 10000 − old** (0013 → 9987, etc.;
full table in `supabase/migrations/README.md`); `/api/health` probe keys
renamed to match. All 18 were applied to prod BEFORE the rename — nothing
needs re-running. History sections below and `Session log/` keep the old
numbers; decode with 10000 − old. Never `supabase db push` (CLI order is
ascending = newest-first under this scheme); hand-paste only.

## What shipped in session 009 (2026-07-17, committed DIRECTLY to `main`, per user)

**THE ENTIRE FEATURES LIST RAN TO COMPLETION** — items 9, 11–25 all built
(item 10 stays on hold by user decision), via parallel worktree lanes each
verified (unit tests, tsc, build, Playwright walk) before merge. Unit suite
181 → 391 → **401 checks** (last +10 from the adversarial-review fixes, see
below). Full detail: `Session log/009_2026-07-17/session_log.md`.
Headlines:

- **Migrations renumbered descending** (see the note above). 9980 (chat
  upgrade) was pasted by the user mid-session.
- ⚠️ **FOUR MIGRATIONS WRITTEN, NOT YET APPLIED at wrap: 9979 (reveal
  metering), 9978 (business packages), 9977 (town hall + featured), 9976
  (categories).** Independent — paste in any order; `/api/health` probes
  each. Everything degrades gracefully until pasted (reveal unmetered,
  business purchases refuse, sidebars hidden, categories dormant — never a
  500).
- **Item 9** web ad posting (SMS-exact pricing) · **11/12** strip hiding +
  header unread badge (`/api/unread`) · **13/14/15** chat rebuild: bubbles,
  report queue, link block, full audit logging (stance reversal documented
  on /admin/help), pictures (30/thread, never on SMS), one-RPC send +
  optimistic UI + `chat_nudged_at` · **16** My ads tab with the delete
  refund matrix (pending → refund; approved-never-broadcast → refund; ever
  digested → none; idempotent ledger refs) · **23** metered click-to-reveal
  (numbers never in HTML, 10/day + bank 30, insights flags + block) ·
  **17** business advertising ($39.99/59.99/89.99 wk/2wk/mo, Stripe
  self-serve, review-gated, labeled Sponsor line OUTSIDE the cap-10,
  missed days extend, declines = manual Stripe refund flow) · **18/19**
  homepage featured-left/ads-center/townhall-right; free events board with
  review + auto-expiry; two rotating Featured slots (operator-only, image
  ads, external links rel=sponsored) · **22/24/25** category system:
  approved SUBSCRIBE menu, toggle replies with exact user copy + 5/hr
  confirmation throttle, ONE combined filtered digest per subscriber
  (composed once per distinct category set; ALL byte-identical to before;
  uncategorized rides everything; sponsors ride all groups), operator
  categorizes at review, /account checkboxes, homepage ?category browser.
- **Site/policy batch:** privacy + terms competitor audits (ours kept
  stronger stances; real gaps filled); accessibility statement + refund
  policy footer pages; © 2026 footer line ("Powered and secured by
  CodeFuseSolutions"); **firearms banned** in the stated rules + post form;
  **support = (234) 301-0048 everywhere, (330) 960-7170 exclusively the
  ads line**.

**User ops queue:** paste 9979/9978/9977/9976 → check health; optionally add
firearm word-rule flags; set prices when ready (Featured slots, event
listing/blast — deliberately unwired); carried from 008: verify photos@
inbound + review-alert emails.

**Recommended-but-unbuilt (new + carried):** web-lane rate limiter (none on
posting/events/reveal-clicks beyond quotas); private bucket + signed URLs
for chat images (currently the public ad-photos bucket, unguessable URLs
only — user informed); abuse-suite pass over the new surfaces; HELP/FAQ
don't mention category commands yet; retry-swallow inbound trap; Telnyx DLR
badges.

**Adversarial review outcome (33 agents, find → refute):** 27 findings, 25
confirmed, ALL FIXED in `5557007` (hotfix: degrade guards had to match
PostgREST schema-cache codes PGRST205/204 — without this the homepage
sidebars + /advertising could 500 pre-paste; hasRevealed now fails closed)
and `835d45a` (batch: Stripe webhook 503s an unstorable paid package so
Stripe retries until 9978 lands; member-delete refunds crash-safe + CAS'd
against admin-reject races; dropped-paid-bump refund; web charge undo;
grantFreeAd CAS; per-GROUP STOP footer; finalize consumes only DELIVERED
ads; empty category set truly dark; stranger category/LIST texts no longer
mint accounts; emptied-warning exempt from throttle; dispatchSms
GSM-sanitizes at the choke point; chat nudge is an atomic claim; town-hall
+ photo-alt phone masking; sold-ad reveals allowed; search keeps the
category filter; privacy copy matches the reveal reality). Unit suite ends
at **401 checks**. ONE finding deliberately deferred: chat pictures live in
the PUBLIC ad-photos bucket (unguessable URLs) — the private-bucket +
authed-serving rework is the top backlog item.

## What shipped in session 008 (committed DIRECTLY to `main`, per user)

**The 007 handoff items, then the new `FEATURES.md` list — items 0–5 ALL
BUILT, each dev-walked (75 Playwright checks across 6 walks) and pushed
separately.** Unit suite 129 → **181 checks**.

⚠️ **SIX MIGRATIONS WRITTEN, NONE APPLIED at session end: 0013–0018.**
Prod auto-deploys `main`, so the code is live NOW with every new feature
**dormant-but-safe** until its paste: this session every schema-dependent
feature degrades gracefully (hides / reports "paste migration X" / omits
itself — never a 500) and `/api/health` (CRON_SECRET) probes
`migration0013`…`migration0018` individually. **User: paste
0013_ad_delete, 0014_user_ids, 0015_ad_photo_submissions, 0016_ratings,
0017_profiles_chat, 0018_digest_numbers in file order, then check health.**

- **Email digest subject** (user request): now led by the standout ad —
  `The Plain Exchange : 07-16-26 - Tractor trailer +3 more ads`. Standout =
  highest-priced ad (fallback: digest order); pure + unit-tested
  (`lib/ad-display.ts`), applies to scheduled AND early/extra editions.
- **Admin ad deletion (0013)** — the 007 request. "Delete this ad…" on
  /admin/ads, any status: two-step confirm shows the seller's charge and
  warns no-refund/no-notice. SOFT delete (new `deleted` status — broadcast
  history/digest_items never rewritten): hidden from site/digests/MYADS,
  PIC/STATUS no-ad-found, SOLD/BUMP refuse, queued bumps dropped, photos
  removed from storage too. `deleted` filter on the Ads tab; /admin/help
  documents it.
- **FEATURES.md created** — the running feature list (user convention: when
  they add a feature, append it there). Items 0–5 all **built**:
  - **0 · USER_ID (0014):** unique random 6-digit member ids, backfilled by
    the migration, lazily assigned after; merged-away ids not reusable for a
    YEAR (`retired_user_ids` tombstones). On /account + /admin/users.
  - **1 · Email-in extra pictures (0015):** photos@ + "Ad 1042" in the
    subject → sniffed + re-hosted → `ad_photo_submissions` awaiting review
    on /admin/ads → approved extras join the WEBSITE gallery at position 1+
    (position 0 = the paid MMS picture; SMS/PIC/digest costs untouchable).
    **Ops: add the photos@ inbound address in Resend → same webhook.**
  - **2 · Confirmed ratings (0016):** SOLD → "what was the buyer's phone
    number?" → sale recorded → RATE 1–5 both directions (buyer gets one SMS
    invite). Store-enforced: only the recorded sale's parties, right
    direction, once per ad. Averages on the ad page + /admin/users. New
    `sms_contexts` conversation-state (48 h / 7 d windows; SKIP opts out).
  - **3 · Profile (0017):** picture (re-hosted) + pickup address that is
    STRICTLY private — leaves only via the explicit "Share my pickup
    address" button inside a chat.
  - **4 · Chat (0017):** "Message the seller" on ad pages → threads under
    /account/messages keyed on member ids (phones never shown; non-members
    404). One "message waiting" SMS nudge / number / 3 h, reply-class.
  - **5 · Digest numbers (0018):** every sent digest numbers itself from 1
    (reset now, per user): "Plain Exchange No. 3 Jul 16 morning:"; email
    edition mirrors it; /admin/digests history shows it.

**Post-wrap additions (Jul 17, same session):**
- **User applied migrations 0013–0018** ✓ (0019 came after — see below).
- `b605caf` **inbound-photos fix:** Resend's `email.received` webhook carries
  attachment METADATA only — the handler now pulls the real files via
  `GET api.resend.com/emails/receiving/{email_id}/attachments`
  (RESEND_API_KEY; short-lived download_urls). Without this every live photo
  email saved nothing. Resend setup fact: inbound is DOMAIN-wide (one MX +
  one email.received webhook — photos@ needs NO separate config; our handler
  routes by recipient local part).
- `be80bab` **Verified members (FEATURES item 7) — ⚠️ NEW MIGRATION 0019**
  (users.verified_at): operator-granted green check, grant/revoke on
  /admin/users only (no self-serve, by design); ✓ shows on the ad page
  ("✓ Verified seller"), the member's account page, and in chat. Perks
  deliberately later, off `getVerifiedAt`. **User must paste 0019.**
- `4e37400` **Admin add-a-member (FEATURES item 8, built, no migration):**
  "Add a member" on /admin/users creates the account, grants optional
  starting credits (ledger `grant`), and texts a one-time compliant invite
  ("To sign up, reply START" + rates/HELP/STOP/  /sms link). Deduped 1/number
  /24 h; already-subscribed refused; reply-class gates apply. 9/9 walk checks.
- `1abaa7d` **Chat nudge once per DAY (item 6 built; user decision)** — and
  **item 10 (mixed SMS+chat) ON HOLD**: chat stays web-only for now.
- **FEATURES queue grew to items 9–15** (all not started unless noted):
  9 web ad posting (decision recorded: same `maxChars` cap as SMS, price
  shown before posting, one listing picture vs web-only extras); 11 hide the
  SMS signup strip for signed-in members; 12 header messages icon + red
  unread badge/alerts; 13 modern chat threads (right/left bubbles, report-a-
  message, no links, audit-log ALL chat messages — note: reverses this
  session's chat-privacy default, stance to be documented when built);
  14 pictures in chat (media NEVER doubled onto SMS — text pointer instead);
  15 messaging performance overhaul (send-lag diagnosis written into the
  item: no optimistic UI + ~8 sequential Supabase queries on send + ~6 on
  re-render; ILIKE nudge-dedup scan the likely worst offender; fix menu
  listed). FEATURES.md item notes carry the build guidance for each.

**VERIFY EARLY NEXT SESSION (couldn't reach prod from the session
container):** (1) health shows `migration0012`–`migration0019` all applied
(**0019 is the one the user may not have pasted yet**) + digests composing
(carried from 007); (2) review-alert emails arrive post-ADMIN_EMAIL-fix
(carried); (3) a real photo email to photos@ lands as a submission on
/admin/ads (needs the b605caf deploy + MX/webhook verified in Resend);
(4) the admin invite button live (needs nothing but the deploy).

**NEXT SESSION default work order (unless the user redirects):** FEATURES
items 9 (web ad posting), 11–15 — plus the standing hardening backlog
(retry-swallow trap, DLR badges, abuse-suite pass over the conversational
flows).

**Recommended-but-unbuilt (carried + new):** (1) the retry-swallow inbound
trap (any throw after `recordInboundOnce` still permanently eats that
message); (2) persist Telnyx DLRs as delivered/failed badges in
/admin/messages; (3) graceful-degradation retrofit for PRE-0013 features;
(4) extend the abuse suite to the new conversational flows (RATE hammering,
buyer-phone spoofing, chat-nudge abuse) — none of it is brutally tested yet.

Full session detail: `Session log/008_2026-07-16/session_log.md`.

## What shipped in session 007 (committed DIRECTLY to `main`, per user)

**The "texting the number does nothing" outage — root-caused (two stacked
causes), fixed, and REAL SMS CONFIRMED LIVE end-to-end 2026-07-16** (SUBSCRIBE,
AD NEW, approve/reject notices, PIC all exercised on the user's real phone).

1. **Migration 0011 wasn't applied** while `main` (auto-deploys) read
   `users.pic_balance` on every account lookup → every inbound command 500'd
   → Telnyx's retry was swallowed by the inbound dedup → texts permanently
   eaten. **User applied 0011 (2026-07-16) — now ALL migrations 0001–0011 are
   applied.** ⚠️ The retry-swallow design trap remains (any throw after
   `recordInboundOnce` permanently loses that message; the fix — a
   processing-state column + idempotent handlers — was offered, not built).
2. **TELNYX_API_KEY was missing from the prod deployment** (the user had the
   PUBLIC key and thought it was "the key"; the API key is a separate `KEY…`
   credential). With it absent, `smsDevEcho` silently flipped the transport
   to console-log — /admin/messages showed replies "sent" while nothing real
   existed; the only genuine texts were Telnyx's campaign-keyword
   auto-responses. **Key set + redeployed 2026-07-16 → outbound live.**
   (Number's 10DLC provisioning itself completed 8:05–8:24 AM that morning.)

Diagnostics now built into the product (all dev-verified + walked):
- `/admin/sms-diag` (admin-only, not in nav): send a test SMS through the
  app's exact payload, then fetch the message's LIVE Telnyx status + carrier
  error codes by id (catches sends stuck queued/held that portal reports
  never show).
- Reason-coded webhook-rejection logs; handleInbound failure logs;
  `[telnyx-dlr]` delivery-receipt logging; `[outbound]` logs for every
  suppressed (pause/blocklist/throttle) or failed send.
- `/api/health` (CRON_SECRET view): TELNYX_PUBLIC_KEY / TELNYX_FROM_NUMBER
  (E.164 check + last-4 echo) / TELNYX_MESSAGING_PROFILE_ID posture, and a
  `migration0011` probe.

Feature sprint (same day, all user-requested, each dev-walked before push):
- **MMS photo re-hosting** (`lib/photos.ts`): picture-ad media copied to
  Supabase Storage (public `ad-photos` bucket, lazily auto-created) at
  ingest. **Attachment security policy (user decision):** only byte-proven
  jpg/png/gif/webp accepted (`lib/image-sniff.ts`, unit-tested; headers/
  extensions never trusted; SVG/HEIC/BMP/TIFF rejected); NO raw-URL fallback
  in prod; if a photo can't be saved the ad posts as text AND the
  confirmation tells the seller. Telnyx-hosted media fetched with API-key
  auth (telnyx.com hosts only). **CONFIRMED WORKING LIVE** (user saw the
  badge; photos land in storage).
- **Admin Digests tab** (`/admin/digests`): the exact next-digest lineup
  (shares `selectDigestItems()` with the composer), next slot time, queued
  outbox count, inline editing, digest history — PLUS queue controls
  (move up/down = approval-order swap; **Skip next digest** = `ads.hold_until`
  hold, **migration 0012**; Back to review = revert to pending + clear queued
  bumps; Held section with Release) and **Send early / Send extra** buttons
  ('early' composes the upcoming slot NOW under its identity — scheduled run
  no-ops, queue consumed; 'extra' sends now consuming NOTHING so the queue
  rides again at the regular slot; both labeled in the SMS header + email
  subject, email mirror + immediate outbox drain included).
- **Email edition mirrors SMS 1:1** (user decision): same slots (emailSlots
  setting removed), each email carries exactly that slot's digest via
  `getSmsDigestAdIds`; email HTML handles absolute photo URLs.
- **Ads tab**: free admin Bump (expired relists first), inline editing,
  Picture badges, bump-queued indicator; review-queue Picture badge +
  full-size link; MMS attachment links in the messages log.
- **Subscribers tab** (`/admin/subscribers`): every SMS + email subscriber
  with the time their current subscription started, newest first.
- **Account merge + double subscription** (`/admin/users` detail → "Merge /
  link identities"): a PHONE does a FULL merge (ads, credit ledger, passes,
  strikes, PIC bank, saved card, subscription state move to the survivor;
  survivor wins conflicts; loser deleted; the message audit log is never
  rewritten). An EMAIL links the address + its subscription to the member
  (absorbs email-only signups) → subscribed to BOTH editions.
- **Engine/UX**: fresh SUBSCRIBE/START now gets a practical welcome (digest
  times from settings + AD NEW example — the compliance opt-in text is
  Telnyx's registered campaign auto-response, which fires on keywords);
  PIC on a pending ad tells the OWNER "not yet approved" (strangers still
  get no-ad-found); PIC media URLs absolutized; review-alert email embeds
  the ad photo inline; website price fix ("$10k OBO" rendered $10 — pure
  `lib/ad-display.ts`, unit-tested). Unit suite 107 → **129 checks**.

**Migrations:** 0011 applied (2026-07-16). **0012 (`ads.hold_until`) written
this session — the user was applying it at session end** after it caused the
day's second migration race: the deploy reached prod before the paste,
/admin/digests 500'd and the cron crashed at compose, so **the 4 PM ET
digest was missed; it self-heals on the first cron tick after 0012 lands**
(the slot's digest row exists un-finalized → the composer redoes it).
`/api/health` (CRON_SECRET) now probes 0011 AND 0012. **VERIFY EARLY NEXT
SESSION: health shows `migration0012: {applied: true}` and digests are
composing again** (Digests tab → Recent digests).

**Ops notes discovered:** the digest cron IS firing (slots composed on
schedule since Jul 14 — the LAUNCH §A5 "set up a pinger" item appears
already satisfied; confirm what's pinging, likely Vercel cron on a paid
plan). ADMIN_EMAIL had a typo (`prontonmail.com`) — user was told to fix the
Vercel env var + redeploy; **verify the review alerts actually arrive now**.

**NEXT SESSION (user request): add the ability to DELETE an ad from the Ads
list in the admin dashboard.** Design note: digest_items/bumps/ad_photos
reference ads — decide soft-delete vs cleanup vs forbidding deletion of
broadcast ads (see session log for details).

**Recommended-but-unbuilt follow-ups:** (1) schema-dependent features should
degrade gracefully instead of 500ing when their migration is missing (twice
bitten today); (2) the retry-swallow design trap (any throw after
`recordInboundOnce` permanently eats that inbound message); (3) persist
Telnyx delivery receipts ([telnyx-dlr] logs exist) into /admin/messages as
delivered/failed badges.

Full session detail: `Session log/007_2026-07-16/session_log.md`.

## What shipped in session 006 (branch `claude/stress-test-pic-limits-ki1jf0`)

Two asks: (1) brutal failure-case testing, and (2) a PIC request limit with an
admin control. **Both shipped, dev-verified; ⚠️ migration 0011 must be applied.**

- **PIC daily allowance + rolling/sinking bank — the real MMS cost control.**
  Every number gets `picDailyAllowance` photo pulls per ET calendar day (default
  **3**); unused pulls bank up to `picBankCap` (default **20**). Admin-tunable on
  `/admin/settings` ("Picture pulls per number per day" + "Most picture pulls a
  number can bank"); set the daily number to 0 to turn the quota off (falls back to
  the hourly cap alone). Pure accrual math in **`lib/pic-quota.ts`** (unit-tested,
  20 checks); atomic accrue-then-spend via **`reserve_pic_quota`** (advisory lock,
  **migration 0011**) in prod and a file-store equivalent in dev. Enforced in the
  engine's PIC handler only once a photo is actually about to send (a mistyped id
  never burns a pull); accountless pullers are `ensureAccount`'d first so the quota
  applies to everyone. Denial ("you're out of picture pulls") is a friendly SMS
  deduped to 1 / 3h / number. The hourly `smsPicsPerHour` cap stays as a burst
  limiter on top. **Documented on `/admin/help`.**
  - ⚠️ **Product-behavior heads-up:** with the default 3/day ON, a buyer can pull
    only 3 photos/day. Generous for a flip-phone audience, but if photo-browsing is
    core, raise the daily number (or the bank) on Settings, or set daily to 0. This
    is a live product decision — the control is there to tune.
- **Command re-route fix:** `AD SOLD 1325` (and `AD BUMP/STATUS/PIC <id>`) now parse
  as the owner command, not an ad whose body is "SOLD 1325". Before, a mistyped SOLD
  silently posted a junk pending ad and burned a credit/free pass. Narrowly scoped
  (only an exact `verb + number` body re-routes; a real ad that merely starts with
  the word is untouched). Parser unit tests added.
- **Brutal abuse suite extended to 19 vectors** (`npm run test:abuse`), all bounded.
  New: SOLD same ad ×20 (idempotent, tail silenced), `AD SOLD <id>` ×20 (0 junk ads,
  0 credits burned), PIC hammer 5 days with quota ON (**3 MMS/day**), PIC rolling bank
  (idle 2 weeks → burst delivers **20** = the cap, not infinity). `docs/abuse-test.md`
  rewritten. `npm test` now **107/107** (added the `pic-quota` + parser checks).
- **Migration numbering:** stayed ascending (`0011_pic_quota.sql`) to match the ten
  existing files, re-runnable per repo convention. (The descending `9999_` rule in
  `new_session_instructions.md` §4 is a different project — HANDOFF says ask before
  adopting it here; kept ascending, flagging for the user.)

## What shipped in session 005 (branch `claude/audit-continuation-qb7i83`)

Continued + finished the three-round audit. **Round 2 (function) COMPLETE, Round
3 (profitability) COMPLETE.** Plus the deferred starter-grant decision.

- **Starter free-ad grant deferred to first `AD NEW`** (user decision; **migration
  0010** — ⚠️ apply before merge to main; the code selects `starter_granted_at`).
  Accounts mint with 0 passes; `grantStarterAdsIfFirst` grants once on first post.
  A number that only subscribes/checks balance mints no passes. Dev-verified.
- **R2 correctness — 13 distinct bugs fixed** (65 raw findings → deduped),
  `npm test` now 79/79. Production-critical: (1) Supabase `listMessages` returned
  the OLDEST N → BUYCREDIT/YES purchase dead for any seller with >50 messages;
  (2) Supabase never expired ads → live-on-site-forever; added `expireDueAds()`
  in the digest cron. Plus: command parsing (`STOP.`/`YES.`/`/ help`), packMessages
  ceiling, settings blank→0 + midnight-slot, digest double-send on bookkeeping
  error, email exempt from the SMS budget, blocklist 500-cap, set-password ticket
  path, admin ad-# search, email body dup, expiry-date display. See
  `Session log/005_*/session_log.md` for the full list.
- **R3 profitability — `docs/profitability.md`** (code-grounded model). Bottom
  line: profitable to ~150 free subs at current pricing, then underwater as the
  free list grows. Inventories code-fixable leaks (free bumps/revive, uncapped
  PIC MMS, budget-invisible catch-up) + pricing levers + a staged scaling
  playbook. **Safety-valve code changes + pricing model await a user decision.**
- **MERGED to `main` 2026-07-09** (fast-forward `6d85c1f → ba3b9e5`); prod
  auto-deploys `main`. **Migration 0010 applied by the user** before/at merge, so
  the `starter_granted_at` reads are safe. `claude/audit-continuation-qb7i83` and
  `main` are identical at the merge. (Heads-up: a **stale local `main`** pointing
  at an ancient session-001 commit surfaced during the merge — realigned to
  `origin/main`; the FF push went via `branch:main`, not the local branch.)
- **Brutal abuse suite added** (`npm run test:abuse`, `test/abuse/brute.mjs`,
  `docs/abuse-test.md`): 15 attack vectors, all bounded. Empirically confirms
  `bumpCost>0` closes the free-rebroadcast/revival leak.
- **⚠️ Still open:** `bumpCost` is still `0` (the raise was discussed but never
  committed). R3 safety-valves + the pricing model still await a decision.

## What this project is

The Plain Exchange (repo codename **TheProductEngine**): an SMS-first
classifieds marketplace for the Plain community and people without
smartphones. Launch target: Holmes County, Ohio. Sellers text ads (with MMS
photos) to a number; a human approves each ad; approved ads broadcast in the
daily SMS digests (default 2/day, admin-set) and list on the website AFTER
they've gone out in a digest; buyers pull photos with `PIC ####`. Sellers fund
it via ad credits; subscribers are free. There is
also an email edition. Strategy/design context: `PRODUCT.md` (who/why),
`DESIGN.md` (visual system, "The Plain Ledger"), `initial plan.txt` (the
original seed).

## Current state (end of session 003 — 2026-07-08)

**`LAUNCH.md` is the live go-live checklist; `SECURITY-TODO.md` is the audit
+ remediation status. Read those two first.** The whole v1 surface is built
and dev-verified. Every code item on SECURITY-TODO is closed (session 003
shipped the digest outbox build + a verification-pass round of fixes — see
below); two items are deferred to a product decision. What remains is ops
(migrations 0006 + 0007 / keys / DNS) + one non-blocking build (photo
re-hosting).

**Deployment (resolved).** One Vercel project, `the-product-engine`. The
morning's `mkdir '/var/task/.data'` 500s and the "two deployments / example
ads" mystery were both **one bug: the Supabase key env var was typo'd
`SUPBABASE_…`.** Fixed → `/api/health` on both `www.theplainexchange.com` and
`the-product-engine.vercel.app` now read identically: `mode: supabase`,
`sb_secret (correct)`, `configTable.ok rows 16`, and all secrets `true`. The
app's built-in demo fixtures were the "example ads" (fixtures mode); gone now
that Supabase is connected.

**Env vars set in prod:** SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (sb_secret),
SESSION_SECRET, ADMIN_PHONES (3306001834), CRON_SECRET, SITE_URL
(`https://theplainexchange.com` — apex; make www primary in Vercel Domains and
keep SITE_URL matching), all TELNYX_* incl TELNYX_PUBLIC_KEY, RESEND_API_KEY.
**Not yet set:** STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET, ADMIN_EMAIL
(new-ad notifications). Admin account CLAIMED (password set for 3306001834).

**Migrations:** 0001 (init), 0002 (analytics), 0003 (credit_ledger.ref
unique), and 0005 (abuse hardening) all applied by the user (confirmed start
of session 003: "ran all the migrations"). `seed-production.sql` run (config
rows = 16). **⚠️ `0006_digest_outbox.sql` AND `0007_ad_broadcast_at.sql` NOT
yet applied** — both written in session 003 and REQUIRED before the
session-003 code deploys. 0006: every digest run writes `digests.item_count`
and delivers through the `digest_outbox` table + its RPCs
(`claim_digest_outbox`, `outbox_segments_since`) and inserts the
`digest_daily_segment_budget` config row (17th). 0007: adds `ads.broadcast_at`
(the digest builder reads it to find never-broadcast ads; backfilled). The
ad reads and the cron error until both are run.

**Telnyx 10DLC:** campaign **resubmitted 2026-07-08, now Pending Telnyx Review**
(Campaign ID `4b30019f-3dbf-6353-9dbf-2586aedd7f66`, TCR `CTSE7B5`, Marketing use
case). The prior **806** rejection ("needs compliant/accurate CTA info: opt-in
path, HELP, STOP, frequency, msg&data-rates disclosure, privacy link") was the
thing the session-004 `/sms` CTA build addressed — it is a HISTORICAL failure
reason shown on the record, not a new one. **Verified 2026-07-09 (session 005):
the CTA surface is fully compliant** — `/sms` (the submitted opt-in URL) carries
all six required elements, and the homepage subscribe-strip + footer repeat the
opt-in path / "up to 4/day, varies" / "msg & data rates may apply" / HELP / STOP
/ `/sms` link. Registration path: Telnyx review → TCR → MNO (carrier) review, then
active; typically hours to a few business days, T-Mobile slowest. Real A2P sending
stays blocked until approved → then text HELP as the go-signal. (Brand + campaign
were recreated after the Aug-2025 failure — brand-level "does not qualify," fixed
by a Standard EIN brand.) **HELP-number is NOT a mismatch** (session-004 note was
wrong): the registered HELP message lists (234) 301-0048, which is exactly what
the app sends via `site.supportPhone`. Number
**(330) 960-7170** (real number now everywhere; replaced the 555 placeholder).
User reports the dead Supabase webhook URL swapped → should be
`https://www.theplainexchange.com/api/telnyx/inbound` (v2), failover the
vercel.app one. **Production is in REAL-SMS mode** (TELNYX_API_KEY set); once
carriers approve, sign-in codes + inbound replies go live — verify by texting
HELP. Until then, on-screen sign-in codes are OFF in prod (dev tools gated
behind `ENABLE_DEV_TOOLS`, see security build below), so use the password.

**Domain:** theplainexchange.com at Namecheap, attached to Vercel. Make www
the primary domain (apex redirects), align SITE_URL. Legal pages
(`/privacy`, `/terms-and-conditions`) + `/faq` live for TCR compliance links.

## What shipped in session 002 (all merged to main)

- **Deploy + admin fixes:** CLAUDE.md wired so `new_session_instructions.md`
  loads every session; `isAdminPhone` normalizes ADMIN_PHONES.
- **Legal/help pages:** `/privacy`, `/terms-and-conditions`, `/faq`, and an
  admin `/admin/help` (why-it's-built-this-way doc, live tunable numbers).
- **Stripe payments (real):** hosted Checkout (`/account/checkout` →
  `startStripeCheckout`), signature-verified webhook `/api/stripe/webhook`
  (idempotent on `credit_ledger.ref`, amount check), order-complete page
  `/account/checkout/success`. Raw-fetch, no SDK. Saves card off-session +
  `stripe_customer_id` for future /BUYCREDIT.
- **Admin Reports** (`/admin/reports`): SMS/email subscriber counts, new-subs,
  ads posted, recent subscribers, + a cookieless server-side **visit counter**
  (`lib/analytics.ts`, migration 0002). **New-ad email alerts** to ADMIN_EMAIL
  (`lib/notify.ts`).
- **Security hardening** (SECURITY-TODO P0/P1.5/P2): fail-CLOSED secrets
  (SESSION_SECRET/Telnyx/CRON in prod); dev tools (on-screen codes, /dev/*,
  simulate-payment) gated behind `ENABLE_DEV_TOOLS` (`lib/env.ts`); Telnyx
  replay window; open-redirect fix; config clamps; SOLD-on-pending blocked;
  refund delimited-match; Stripe amount check; image host allowlist
  (`next.config.ts`).
- **Abuse & money-race hardening** (migration 0005): atomic `reserve_sms` +
  `spend_credits` RPCs (advisory locks) replace read-then-send/read-then-spend
  races; bump charging honors `bumpCost`; double-refund guard
  (`rejectAdRecord` returns whether it transitioned); race-safe inbound dedup
  (unique `provider_id` + `recordInboundOnce`); reservation moved BEFORE route
  (over-cap command dropped whole, never charged silently); STOP always
  unsubscribes, confirmation deduped; no account minted by STOP/gibberish.
  **Adversarially reviewed by parallel agents; 2 confirmed bugs found + fixed.**
- **SMS ad-packing composer** (`lib/sms-segments.ts`, `composeDigestMessages`):
  GSM-7 sanitize + pack whole ads into fewest single-SMS messages. **Cost
  reality learned:** the current one-concatenated-message digest is already
  near-minimal on billed *segments*; packing is ~segment-neutral. Real savings
  = emoji/Unicode containment (16 vs 22 seg) + no accidental MMS. NOT yet wired
  into the send path (that's the delivery rework below).

## What shipped in session 004 (branch `claude/app-audit-three-rounds-ypaa3e`, all on `main`)

A three-round audit (security → function → profitability). **Round 1 (security)
COMPLETE; Round 2 (function) IN PROGRESS; Round 3 (profitability) NOT STARTED.**
Session state at wrap:

- **10DLC MNO 806 fix (carrier rejection):** the campaign failed MNO review for
  an unverifiable opt-in CTA. Fixed: a canonical `/sms` "Text message program"
  page carrying all six required disclosures + homepage/how-it-works/footer
  disclosures + a marketing-disclosing opt-in confirmation (`OPT_IN_CONFIRMATION`
  in engine.ts, kept GSM-7). Full campaign-field copy (Description, Message
  Flow/CTA, opt-in/HELP/STOP messages) delivered in chat — Template #4 (keyword
  opt-in). **User ran the migrations + resubmitted the campaign 2026-07-08.**
  ⚠️ OPEN: registered HELP message had support # (330) 203-1031 but the app sends
  `site.supportPhone` (234) 301-0048 — must match; confirm which is real.
- **Operator controls** (migration 0008): two-level PAUSE (`bulk`/`all`), UNDER
  ATTACK mode (suppress-unknown + auto-tighten caps + per-minute throttle),
  number blocklist (one-click from `/admin/insights`). Single outbound choke
  point `lib/outbound.ts`.
- **Content filter** (`lib/content-filter.ts`): emoji stripped + links flagged
  for review at ad ingest.
- **Round 1 security: 16 of 17 confirmed findings fixed** (see next block).
- **Unit test suite added** (`npm test`, 69 checks green): segments/commands/
  dst/phone — the cost/launch/ownership-critical pure logic. `etParts` extracted
  to pure `lib/et.ts` so the DST test guards the real code.
- **Round 2 (function) audit LAUNCHED but not completed this session** — the
  adversarial workflow (11 correctness dimensions) was running in the background
  at wrap. Re-run it next session:
  `Workflow({scriptPath: ".../workflows/scripts/function-audit-r2-wf_8923b4d2-8d7.js"})`
  (script also under the session dir). A manual pass already cleared 4 pure
  areas (69/69) — those are now the committed test suite.
- **Round 3 (profitability): not started.** Break-even ≈ $1.65/credit @ 150 subs
  (from session 003's xlsx); the new test suite verifies the segment cost math
  the model rests on.

The operator-controls detail below (dev-verified 14/14 + `tsc`/`next build`):

- **Content filter at ad ingest** (`lib/content-filter.ts`): emoji/pictographic
  chars stripped from the stored+broadcast body (raw kept in the audit log);
  URLs/bare domains **flagged for manual review** (not stripped/auto-rejected)
  with a badge in the review queue. `mayPostLinks()` is the seam for a future
  verified-advertiser tier. Detector avoids false-flagging phones/prices.
- **PAUSE switch, two levels** (`lib/settings` `pauseMode`, `/admin/settings`
  System controls): `bulk` (PARTIAL — digests + catch-up off; replies, PIC,
  sign-in codes, STOP confirms on) and `all` (FULL — every subscriber/user
  outbound off; inbound still logged; operator alerts still send; admin signs
  in by password). Queued digests wait + resume on Resume.
- **UNDER ATTACK mode** (`underAttack`): suppress unknown/gibberish replies +
  skip catch-up, auto-tighten SMS caps (`effectiveSmsCaps`), global per-minute
  outbound throttle (`outboundThrottlePerMin`); the digest drain also caps
  sends/run.
- **Blocklist** (`lib/blocklist.ts`, **migration 0008**): blocked inbound
  logged for forensics then dropped before any account/reply/charge; excluded
  from digest recipients + all outbound. One-click block from `/admin/insights`
  (ranked worst senders), manage on `/admin/settings`.
- **The single outbound choke point** (`lib/outbound.ts` `dispatchSms` /
  `dispatchEmail`): all 10 non-digest send sites routed through it; the digest
  drain enforces pause/throttle at batch level so paused rows stay queued
  (never failed). Operator alert emails are class `operator` — never blocked.

**Security round-1 fixes (all on `main`, dev-verified, code-review batch):**
A 65-agent adversarial audit found 17 confirmed holes (4 P1, 4 P2, 9 P3);
fixed in three batches — (1) **consent enforced at send time** (STOP/block/unsub
purge queued digest rows via `cancelQueuedOutboxFor`; drain re-checks the
blocklist), **login-OTP routed through the global SMS breaker** (unauth `/login`
could pump unbounded SMS → 10DLC-suspension risk), email `eq` not `ilike`;
(2) **catch-up cost breaker + STOP/START dedup**, ad-title phone-PII masking;
(3) **OTP verify made atomic** (`verify_login_code` RPC — **migration 0009**),
**`/api/health` detail gated behind CRON_SECRET**, **email-in is now double
opt-in** (spoofable From no longer enrolls anyone; confirm/unsubscribe are POST
buttons, not GET side-effects). Blocklist/outbox reads fail safe if their table
is missing. **Deferred (need your call / low sev):** #9 login account-existence
oracle (inherent to password-vs-OTP UX). **Migrations 0006/0007/0008/0009 ALL
applied** (user confirmed 2026-07-08/09 — all migrations run; OTP verify is live).

## What shipped in session 003 (branch `claude/security-todos-noq7gf`)

**The digest columnar-delivery build — the last big SECURITY-TODO item.**
Migration `0006_digest_outbox.sql` (⚠️ run before deploying) + code:

- **Outbox delivery:** composing a due slot enqueues one `digest_outbox` row
  per (subscriber, message part); the cron drains bounded batches (50/claim,
  8 concurrent sends) in columnar order — every subscriber gets part 1 before
  anyone gets part 2 — with `maxDuration=60` and an internal ~45s budget, and
  RESUMES next tick. Timeouts can no longer half-send a digest; enqueue and
  claim are idempotent/race-safe (unique key + `FOR UPDATE SKIP LOCKED` RPC,
  10-min stale-claim reclaim). Failed sends retry ×3 then park as `failed`.
- **Packing composer wired in** (`composeDigestMessages` now feeds the real
  send path): GSM-sanitized, whole ads packed under a 612-septet ceiling —
  an emoji can't flip a broadcast to UCS-2 pricing.
- **Digest circuit breaker:** `digestDailySegmentBudget` (new admin setting,
  default 12,000 billed segments per rolling 24h, clamp 100k, 0 = pause).
  On trip: sending halts, rows wait, admin emailed once (alert fires only on
  the crossing run or a fresh enqueue — no 5-min spam). `/admin/help`
  documents it.
- **1000-row truncation fixes:** `listSubscriberPhones` / `listEmailRecipients`
  / `getCreditBalance` paged (subscribers past 1000 get digests; balances no
  longer summed from a 1000-row prefix).
- **Email edition** rides the same outbox (per-recipient signed unsub links,
  0 segments — exempt from the SMS budget).
- **Small fixes:** `digestsSentOnDay` parity (SMS-with-items in both stores —
  email/empty slots can't suppress the STOP footer); ad-id parser takes the
  full digit run (`SOLD 12345678` no longer truncates to #123456).
- **Verified:** 27/27 dev scenario checks (enqueue/drain, multi-part packing,
  footer rules, resume, breaker trip + recovery, email path, idempotent
  re-runs) + a breaker-trip alert walk. `tsc` + `next build` clean.

**Then a 7-agent adversarial re-audit** verified every SECURITY-TODO item
against the code (not the checkboxes) and caught gaps behind items marked
done — all fixed on `main` (commits `23446b2`, `f0cd97b`), 12/12 re-verified
in dev:
- **Digest ad starvation (Supabase):** new PAID ads could silently never
  broadcast (`getNewDigestAds` scanned the cap×3 oldest approved ads and
  Supabase never expires approved ads). Fixed with `ads.broadcast_at`
  (**migration 0007**).
- Open-redirect tab bypass (`/⇥/evil.com`); SOLD/revive store-level status
  guards (were engine-only); photo ingest host allowlist (scheme-only before,
  `//evil.com` passed); paged `getPendingAds`/`getSmsAdIdsSince`/`getLedger`
  (1000-row cap); dev-only echoes (email confirm link, plaintext OTP storage)
  now gated on `devToolsEnabled` not a missing key.
- **Two items deferred to a decision** (see SECURITY-TODO "Verification pass"):
  whether to defer the 3 starter free-ads from first contact to first post,
  and whether to rate-limit inbound audit logging (recommend NOT). Everything
  else on SECURITY-TODO is closed in code.

## Remaining work

**Ops (before/at launch — see LAUNCH.md):** ~~run migrations~~ **all migrations
0006–0009 applied 2026-07-08/09**;
set up the cron pinger (Vercel Hobby crons are daily-only — external GET
`/api/cron/digests` every 5 min with `Authorization: Bearer <CRON_SECRET>`);
Stripe test purchase → live keys; set ADMIN_EMAIL (also receives the new
digest-breaker alerts); Resend domain verify + real CAN-SPAM mailing address
in `lib/email-digest.ts` (`BUSINESS_ADDRESS`, still "PO Box 000"); make www
primary; wait for carrier approval → text HELP as the go-signal; then the
~15-min smoke walk in LAUNCH.md §B.

**Also shipped later in session 003 (on `main`):**
- **Email-in subscribe:** `subscribe@theplainexchange.com` → `/api/email/inbound`
  (Resend Inbound, Svix-verified, `RESEND_WEBHOOK_SECRET`, fail-closed) →
  direct-subscribe + welcome. Ops: add the inbound address in Resend + set the
  secret.
- **Admin insights** (`/admin/insights`): top advertisers, who-texts-most,
  excessive-PIC flags (`picAbusePerDay` setting, default 15/day), engagement
  leaderboard, ad funnel, most-bumped ads; 7/30/90-day window.
- **⚠️ Prod incident + hardening:** a `main` auto-deploy landed the broadcast_at
  code before migrations 0006/0007 ran → shared `AD_SELECT` hit a missing
  column → `/admin` 500'd. Fixed by not selecting broadcast_at in the shared
  reader (only the digest builder needs it). **Rule going forward: run additive
  migrations before/with merging schema-dependent code — prod auto-deploys
  `main`.**
- **Support phone `(234) 301-0048`** (`site.supportPhone`): the "call for
  help / to arrange payment" number, distinct from the SMS number people text.
- **BUYCREDIT by text + saved-card discount:** `BUYCREDIT <pack>` quotes a
  discounted price (new `savedCardDiscountPercent` setting, default 10%) and a
  `YES` charges the saved card off-session (`payments.chargeSavedCard`).
  Idempotent via a deterministic ledger ref (no new table); dev-simulated,
  gated on ENABLE_DEV_TOOLS. **The live off-session Stripe path needs a real
  test once Stripe keys are set.**
- **New-subscriber catch-up:** SUBSCRIBE/START sends the most recent digest's
  ads immediately (`sendRecentDigestTo`), best-effort, once per real
  (re)subscribe.
- **Digest default set to 2×/day** (`slots [7, 18]`). Note: slot count is a
  subscriber-frequency choice, NOT a cost lever — each ad broadcasts once/day
  regardless of slot count, so 2× and 4× cost about the same (more slots only
  repeat the short header). Prod DB still has the 4-slot value; change on
  `/admin/settings` if you want 2×.
- **Site shows ads only after they've run:** the public homepage + ad detail
  now require `broadcast_at` (an ad appears on the website only once it has
  gone out in a digest). ⚠️ Consequence: the public site is empty until the
  digest cron actually composes digests — so the external cron pinger
  (LAUNCH §A5) is now also what populates the website, not just SMS.
- **Ops artifact (not in repo):** a cost/pricing calculator xlsx was delivered
  to the user (break-even ≈ $1.65/credit at 150 subs / $0.008 SMS / $0.035 MMS;
  digest broadcast cost dominates and scales with free subscribers). Offer to
  commit it under `docs/` if they want it versioned.

**Build still pending (non-security):** **photo re-hosting to Supabase
Storage** on inbound MMS (reliability; the image-host allowlist already lets
Telnyx/Supabase photos render). Cost/throughput reality for scale, unchanged:
1500 subs × ~7 seg × 4 slots ≈ ~$5k/mo, and T-Mobile's 2000/day unvetted cap
arrives well before 1500 subs → external vetting (~$40) becomes mandatory;
the segment budget (default 12k/24h) must be raised deliberately as the list
grows.

## How the code is organized (the seams)

Everything externally-provided sits behind a swappable seam. Dev
implementations activate automatically when the provider env var is absent:

| Concern | Interface / switch | Dev implementation | Production |
|---|---|---|---|
| Data | `lib/db.ts` `supabaseConfigured` | JSON files in `.data/` (gitignored) | Supabase via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| SMS | `lib/sms.ts` (`smsDevEcho`) | console log + on-screen code echo + `/dev/sms` simulator | Telnyx via `TELNYX_API_KEY` etc. |
| Email | `lib/email.ts` (`emailDevEcho`) | audit-log capture + `/dev/email` viewer | Resend via `RESEND_API_KEY` |
| Payments | `lib/payments.ts` (`paymentsDevMode`) | simulated checkout page | Stripe hosted Checkout via `STRIPE_SECRET_KEY` + webhook `/api/stripe/webhook` via `STRIPE_WEBHOOK_SECRET` (BUILT session 002 — raw-fetch, no SDK; grants idempotent on `credit_ledger.ref`; card saved off-session + `stripe_customer_id` stored for the future /BUYCREDIT charge) |

Dual-mode modules pair as `lib/X.ts` (types + file impl + dispatch) and
`lib/X-supabase.ts`: `ads`, `store` (accounts/credits/codes),
`engine-store` (mutable ads/digests/bumps/messages). Engine logic:
`lib/engine.ts` (inbound commands), `lib/digest-engine.ts` (SMS slots),
`lib/email-digest.ts`, `lib/moderation.ts`, `lib/commands.ts` (parser).
Runtime-editable config: `lib/settings.ts` (admin `/admin/settings` edits it;
engine reads it live). Fixtures/seed data: `lib/fixtures.ts` ↔
`supabase/seed.sql` (keep in sync). Cron: `vercel.json` hits
`/api/cron/digests` every 5 min (SMS digests then email edition; idempotent).

**Dev-mode warning:** with no `TELNYX_API_KEY`, sign-in codes render
on-screen — anyone with the URL can log in as any number, and `/dev/sms` /
`/dev/email` are live. The deployment is not for public eyes until Telnyx is
configured (which disables all of it automatically).

## Product rules (grilled + confirmed 2026-07-06; do not relitigate)

- One credit = one broadcast in the next digest; ad lists on site 30 days
  (config). Text ad 1 credit, picture 5, starter grant 3 ads flat — all
  admin-config. `/PIC` pulls charge no credit but are rate-limited:
  `picDailyAllowance`/day (default 3) per number with a rolling bank up to
  `picBankCap` (default 20) — session 006, admin-tunable, 0 disables; also
  bounded by `smsPicsPerHour`. Digests: 4 ET slots, skip empty, cap 10
  FIFO; bumps free at the default `bumpCost` 0 but the engine now CHARGES
  `bumpCost` when an admin sets it > 0 (session 002); one queued per ad,
  after new ads.
- Manual review of every ad; admin can edit text; word filter flags (or
  auto-rejects per word). Benign rejection = full refund; violation = charge
  kept + strike; 3 strikes = posting-only ban (reversible in admin).
- Accounts keyed on internal id; phone and email nullable-unique (selling
  requires phone); auto-created on first inbound SMS with starter grant.
- Website: public browse; phone numbers masked until sign-in; posting is
  SMS-only in v1. Every message in/out is logged to the audit table.
- Future (bones exist, don't build unless asked): per-county subscriptions,
  premium ads, subscriber fees, website posting, `/CANCEL`.

## Testing conventions

Verification = scripted Playwright walks (chromium is installed as a dev
dep). Pattern: write `shoot.tmp.mjs` at repo root (module resolution needs
it inside the project), run against `npx next start -p 3311`, delete after.
Reset state with `Remove-Item .data -Recurse`. Gotchas learned the hard way:

- `innerText` returns CSS-transformed text — status chips are uppercase
  (`SOLD`, `FLAGGED`); match `/sold/i`, never `"Sold"`.
- Server-action redirects to the *same URL* make `waitForURL` resolve
  immediately with stale DOM; poll for content change instead.
- `textContent("body")` includes RSC bootstrap `<script>` payloads (stale
  page text); use `innerText`.

## Provisioning checklist

**Superseded by `LAUNCH.md`** — the ordered, checkbox go-live list (env,
migrations, cron, Stripe, Telnyx, the launch-day SMS smoke walk). Keep that
file as the single source of truth; don't maintain a second list here.
Reference notes that still matter: Vercel **Hobby crons are daily-only** (use
an external pinger); Telnyx unvetted T-Mobile cap ~2,000 msgs/day, ~$41.50
external vetting raises it; sole-prop-with-EIN registers PRIVATE_PROFIT, legal
name exactly per IRS CP-575, no LLC required.

## Repo & etiquette notes

- Remote: `github.com/RadioDinner/TheProductEngine`, branch `main`. The user
  owns all GitHub/visibility decisions — **do not raise repo visibility
  again**; it was flagged and acknowledged.
- `new_session_instructions.md` governs sessions (session log folder, live
  prompt history, this file). §5 (CoachAccountable API docs) is another
  project — no CA code here. §4 (descending migrations) **was adopted in
  session 009 by user decision**: files renamed to descend from `9999_init.sql`
  (map in `supabase/migrations/README.md`); the next migration takes
  (lowest existing − 1). Write every migration re-runnable (hand-pasted into
  the SQL editor; never `supabase db push`).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The `.agents/.claude/.codex` skills tooling is gitignored and reinstallable
  via `npx skills add mattpocock/skills` (`skills-lock.json` is committed).
