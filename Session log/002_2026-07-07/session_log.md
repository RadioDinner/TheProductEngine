# Session 002 — 2026-07-07

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

## Open questions / next step

- **Admin login on production** — exact symptom not yet pinned down (error
  page vs 404 vs code not accepted). Triage order:
  1. `GET /api/health` — check `ADMIN_PHONES: true`, key kind, DB round-trip.
  2. If signed in but `/admin` 404s → ADMIN_PHONES missing/mismatched (the
     normalizePhone fix on this branch removes the +1 formatting trap; it's
     not deployed until merged to main).
  3. Production DB has no accounts — first login walks phone → 6-digit code →
     set-password. With no TELNYX_API_KEY the code is echoed on-screen.
  4. If a server error page appears after entering the phone: check whether
     TELNYX_API_KEY is set to a junk/placeholder value (real-send path would
     throw).
- **Domain**: point theplainexchange.com (Namecheap) at the Vercel project
  (A @ → 76.76.21.21, CNAME www → cname.vercel-dns.com, or move nameservers
  to Vercel DNS), set primary domain, update `SITE_URL`, redeploy. Autodeploy
  to the domain is automatic once the domain is attached — main already
  deploys to production on every push.
- Still unknown whether `seed.sql` ran (config/packs/word-filter); a
  config-only production seed remains to be offered (see HANDOFF).

## Prevalent notes

- This sandbox cannot reach *.vercel.app (egress proxy 403), so live checks
  of /api/health must be done by the user.
- The Supabase dashboard's recurring `42P01 relation
  "supabase_migrations.schema_migrations" does not exist` log line is benign:
  the dashboard probes for CLI migration history, and this project applies
  migrations by hand in the SQL editor.
