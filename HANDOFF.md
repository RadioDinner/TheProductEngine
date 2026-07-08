# HANDOFF — The Plain Exchange

Live cross-session state document (per `new_session_instructions.md`). Update
this every session. Per-session detail lives in `Session log/`.

**Last updated:** 2026-07-08 (session 004).

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

**Telnyx 10DLC:** campaign **Pending MNO Review (as of 2026-07-08)** — TCR
accepted it and the carriers (T-Mobile/AT&T/Verizon) are now reviewing. This is
the last gate before the campaign goes active; typically hours to a few
business days, T-Mobile usually the slowest. Nothing to do but wait unless an
MNO returns a rejection with feedback. Real A2P sending stays blocked until all
MNOs approve → then text HELP as the go-signal. (Brand + campaign were
recreated after the Aug-2025 failure — brand-level "does not qualify," fixed by
a Standard EIN brand.) Number
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
oracle (inherent to password-vs-OTP UX). **Migrations 0006/0007/0008 applied
2026-07-08; ⚠️ migration 0009 still to run** (OTP verify errors until it is).

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

**Ops (before/at launch — see LAUNCH.md):** run migrations **0006 + 0007 + 0008**;
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
  admin-config. `/PIC` pulls free. Digests: 4 ET slots, skip empty, cap 10
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
  prompt history, this file). Its sections 4–5 reference another project
  (CoachAccountable API docs; migrations descending from `9999_`): this repo
  has no CA code, and its applied migration is `0001_init.sql` (ascending).
  **Ask the user** whether new migrations adopt the descending convention;
  either way, write them re-runnable (they're pasted into the SQL editor).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The `.agents/.claude/.codex` skills tooling is gitignored and reinstallable
  via `npx skills add mattpocock/skills` (`skills-lock.json` is committed).
