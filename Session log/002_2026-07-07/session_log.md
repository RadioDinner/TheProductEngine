# Session 002 — 2026-07-07 / 08

A long session: deploy triage → launch prep → a full security audit → two
hardening builds → the SMS ad-packing composer. Everything merged to `main`
(head `f7015d8`). `LAUNCH.md` = go-live checklist; `SECURITY-TODO.md` = audit
+ remediation status; `HANDOFF.md` = live cross-session state.

## What shipped (late session — reporting, security, money hardening)

- **Admin Reports** (`/admin/reports`): active SMS/email subscriber counts,
  new-subs 7d, ads posted, recent-subscriber list, and a **cookieless,
  server-side page-view counter** (`lib/analytics.ts` + migration
  `0002_analytics.sql`; counts no-JS visitors). **New-ad email alerts** to
  `ADMIN_EMAIL` (`lib/notify.ts`) — best-effort, never blocks posting.
  Verified in dev (2 subs → count 2, ad post → alert fired).
- **Admin `/admin/help`**: plain-language "why it's built this way" doc, live
  tunable numbers pulled from settings.
- **4-agent security audit** (cost, auth, webhooks/money, engine logic) →
  `SECURITY-TODO.md` (prioritized, code-vs-ops tagged). Root finding:
  controls **failed open** (gated on a provider key, not on prod).
- **Security hardening** (P0/P1.5/P2): `lib/env.ts` — dev tools
  (on-screen codes, `/dev/*`, simulate-payment) gated behind
  `ENABLE_DEV_TOOLS`, OFF in prod by default; SESSION_SECRET/Telnyx/CRON
  fail CLOSED in prod; Telnyx replay window; open-redirect fix; admin config
  clamps; SOLD-on-pending blocked; refund delimited-match; Stripe amount
  check; `next.config` image host allowlist; migration `0003` ref-unique +
  idempotent grant; `consumeFreeAd` row-count guard. Verified: prod build
  404s /dev, 401s cron; escape hatch works.
- **Abuse & money-race hardening** (migration `0005_abuse_hardening.sql`):
  atomic `reserve_sms` + `spend_credits` RPCs (pg advisory locks) replace the
  read-then-send / read-then-spend races; **bump charging** honors `bumpCost`
  (default 0 = free) with no-op refund; **double-refund guard**
  (`rejectAdRecord` → boolean); **race-safe inbound dedup** (unique
  `messages.provider_id` + `recordInboundOnce`); reservation moved BEFORE
  route so an over-cap command is dropped whole (never charged silently);
  STOP always unsubscribes with a once-a-day confirmation; STOP/gibberish no
  longer mint accounts. **Adversarially reviewed by 2 parallel agents; both
  confirmed bugs fixed** (`b7a3347` expired-bump double-charge; `43d7512`
  race-safe dedup + reserve-before-route). Dev-verified across 11 scenarios.
- **SMS ad-packing composer** (`lib/sms-segments.ts`,
  `composeDigestMessages`): GSM-7 sanitize + pack whole ads into fewest
  single-SMS messages. **Cost reality (important):** the current
  one-concatenated-message digest is ALREADY near-minimal on billed
  *segments* — packing is ~neutral, NOT a saving. Real wins = Unicode
  containment (16 vs 22 seg when an ad has an emoji) + never accidentally
  MMS. NOT wired into the send path yet (that's the digest-delivery rework).
- **Real number** (330) 960-7170 replaced the 555 placeholder everywhere.
- **LAUNCH.md** added (go-live checklist), **robots.txt/sitemap.xml** added.

Key commits (newest first): `43d7512` dedup+reserve-before-route ·
`b7a3347` bump fix · `7df8b8c` abuse/money-race · `a5a92b9` security
hardening · `6f77c41` reports/visits/alerts · `6324fac` order page ·
`ebb117e` Stripe · `531c3fb` legal pages.

## What shipped (evening)

- **Stripe payments, real mode** (user request "wire up the payment
  processor"): hosted Stripe Checkout created via raw fetch (no SDK —
  matches the Telnyx pattern) from `/account/checkout`; signature-verified
  webhook at `/api/stripe/webhook` grants credits **idempotently** on
  `credit_ledger.ref` (= payment intent id), auto-creates the account,
  and stores `stripe_customer_id`; card saved off-session for the future
  /BUYCREDIT charge. Verified locally: forged + stale signatures → 400;
  valid event → account + 10 credits + customer id; replay → no double
  grant. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Schema needed
  no migration (`ref` and `stripe_customer_id` existed since 0001).
- **/faq page** (user request): same `container prose` pattern, 14 plain
  Q&As, footer link "Questions". Screenshot-verified.
- **Leroy P. removed** from how-it-works and the engine's AD NEW example.
- **supabase/seed-production.sql** added (config/packs/word-filter, no
  demo data).
- Login: graceful "couldn't send a text" error instead of a crash when the
  SMS provider fails (verified e2e against a failing provider).
- Mysteries resolved: the "example ads" on the domain are the app's own
  fixtures (that deployment runs without a DB); user then found the
  Supabase key env var was typo'd `SUPBABASE…`. JSX space-swallowing
  compiler bug hit a **third** time ("PICand", "7170and") — always fix
  with explicit `{" "}`; sweep rendered HTML with
  `grep -oE '</strong>[A-Za-z]|</span>[A-Za-z0-9]'`.

## What shipped (afternoon)

- **/privacy and /terms-and-conditions pages** (user request; built per
  `/impeccable` — skill reinstalled from pbakaus/impeccable into gitignored
  `.claude/skills/`, its setup flow followed: context.mjs, craft.md, product
  register, DESIGN.md/PRODUCT.md). Pure reuse of the existing `container
  prose` pattern — zero new CSS. Both pages carry the CTIA/TCR compliance
  language (opt-in/opt-out, frequency, "msg & data rates", the
  no-sharing-mobile-info-for-marketing clause) that 10DLC campaign vetting
  checks for. Footer now links both pages. Verified by production build +
  Playwright screenshots at 1280/375.
- **SMS abuse guards** (user request): per-number command-reply cap
  (20/hour), per-number PIC/MMS cap (12/hour), and a service-wide
  command-reply circuit breaker (500/hour). All three admin-tunable
  (`sms_replies_per_hour`, `sms_pics_per_hour`, `sms_global_per_hour` in
  config + admin Settings UI + seed.sql). Digest broadcasts and email are
  never counted (filtered by `digest_id is null`, channel sms/mms). STOP is
  exempt — carriers require the confirmation. Over-cap = engine logs the
  inbound but sends nothing. Verified end-to-end via the dev simulator:
  22×HELP → exactly 20 replies then silence; STOP still confirmed.
- **JSX gotcha learned:** the compiler swallowed the space in
  `{site.name} is` on one line of the terms page (rendered "Exchangeis")
  while identical patterns elsewhere kept theirs. Fixed with the explicit
  `{" "}` idiom. Grep rendered HTML for `<!-- -->[a-z]` to catch these.

## What shipped (early session)

- **CLAUDE.md created at repo root.** The user asked to confirm that
  `new_session_instructions.md` is honored on every new session. Finding: the
  instructions file was in the repo, but the `CLAUDE.md` it says loads it did
  **not exist** (only the gitignored `.claude/` tooling dir did), so fresh
  sessions never auto-loaded it. CLAUDE.md now points to
  `new_session_instructions.md` + `HANDOFF.md`, which Claude Code auto-loads
  at session start.
- **`lib/admin.ts`: `isAdminPhone` now normalizes ADMIN_PHONES entries via
  `normalizePhone`.** Previously it only stripped punctuation, so
  `ADMIN_PHONES=+13305550142` produced `13305550142` (11 digits) which never
  matched the 10-digit session phone → signed-in admin got the deliberate 404.
- Session folder `002_2026-07-07/` with live `prompt_history.txt`.
- HANDOFF.md updated to the new deployment state.

## Vercel ENOENT root cause (resolved without a code change)

`mkdir '/var/task/.data'` 500s on `/`, `/ad/*`, `/api/cron/digests` meant the
app was running the **file-store fallback in production**: `supabaseConfigured`
was false because `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` weren't reaching
the runtime, and Vercel's lambda filesystem is read-only. Mid-session the user
reported the site loads — a redeploy after the env-var fix picked them up.
(Env edits never apply to an existing deployment; they need a new deploy.)

## Resolved this session

- **Deploy + "example ads" + admin login** — all one bug: the Supabase key
  env var was typo'd `SUPBABASE_…`. Fixed → both hosts identical
  (`mode: supabase`, `sb_secret`, config rows 16). Admin claimed a password
  and confirmed `/admin`. Env vars, ADMIN_PHONES, SESSION_SECRET, CRON_SECRET,
  SITE_URL, all TELNYX_* + RESEND all set.
- **Telnyx** — campaign recreated → **TCR_ACCEPTED (2026-07-08)**; awaiting
  carrier acceptance. Dead Supabase webhook URL swapped.

## Next step (session 003)

1. **Run migration `0005_abuse_hardening.sql`** — REQUIRED before prod serves
   real SMS (the atomic reserve/spend/dedup paths error without it).
2. Ops from `LAUNCH.md`: cron pinger, Stripe test→live keys, ADMIN_EMAIL,
   Resend domain verify + real CAN-SPAM address, make www primary, then the
   launch-day HELP smoke walk once carriers approve.
3. **Digest columnar delivery** build (the packing composer is done, waiting
   to be wired into an outbox-based, resumable, columnar send + circuit
   breaker + subscriber pagination). Weigh the ~$5k/mo + mandatory-vetting
   cost reality at 1500 subs first.
4. Photo re-hosting to Supabase Storage.

## Prevalent notes

- This sandbox cannot reach *.vercel.app (egress proxy 403) or the live
  Supabase — live `/api/health`, real-DB, and prod-RPC checks must be done by
  the user. Dev verification uses the file store (`npx tsx` scripts / dev
  simulator); prod-only RPCs (0005) are typecheck- + logic-reviewed only.
- Migrations are pasted by hand into the Supabase SQL editor (ascending
  0001→0005); the dashboard's recurring `42P01 schema_migrations` log line is
  benign (CLI-history probe).
- The JSX space-swallowing compiler bug recurred 3×; fix with explicit
  `{" "}` and sweep rendered HTML for `</span>[A-Za-z]` / `<!-- -->[a-z]`.
- Dev tools now require `ENABLE_DEV_TOOLS=1` (even for local `next start`,
  which sets NODE_ENV=production); set it when testing the simulator/on-screen
  codes locally.
