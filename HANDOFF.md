# HANDOFF — The Plain Exchange

Live cross-session state document (per `new_session_instructions.md`). Update
this every session. Per-session detail lives in `Session log/`.

**Last updated:** 2026-07-08 (session 002).

## What this project is

The Plain Exchange (repo codename **TheProductEngine**): an SMS-first
classifieds marketplace for the Plain community and people without
smartphones. Launch target: Holmes County, Ohio. Sellers text ads (with MMS
photos) to a number; a human approves each ad; approved ads broadcast in up
to 4 daily SMS digests and list on the website; buyers pull photos with
`PIC ####`. Sellers fund it via ad credits; subscribers are free. There is
also an email edition. Strategy/design context: `PRODUCT.md` (who/why),
`DESIGN.md` (visual system, "The Plain Ledger"), `initial plan.txt` (the
original seed).

## Current state (end of session 002 — 2026-07-08)

**`LAUNCH.md` is the live go-live checklist; `SECURITY-TODO.md` is the audit
+ remediation status. Read those two first.** The whole v1 surface is built
and dev-verified; what remains is ops (migrations/keys/DNS) + two non-blocking
builds.

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

**Migrations:** 0001 (init), 0002 (analytics / page-view counter), 0003
(credit_ledger.ref unique) applied by the user. `seed-production.sql` run
(config rows = 16). **⚠️ `0005_abuse_hardening.sql` NOT yet applied** — it was
written after the user's "applied all migrations" and is REQUIRED before prod
serves real SMS traffic (creates `sms_reservation`, `reserve_sms`/
`spend_credits` RPCs, and the `messages.provider_id` unique index; the atomic
reserve/spend/dedup paths error without it). `0004_analytics.sql` = the visit
counter table (part of the 0002/analytics work — confirm it ran; visits show 0
until then).

**Telnyx 10DLC:** campaign **TCR_ACCEPTED (2026-07-08)** — brand + campaign
recreated after the Aug-2025 failure (brand-level "does not qualify"; fixed by
Standard EIN brand). Awaiting carrier acceptance (hrs–2 days). Number
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

## Remaining work

**Ops (before/at launch — see LAUNCH.md):** run migration 0005; set up the
cron pinger (Vercel Hobby crons are daily-only — external GET
`/api/cron/digests` every 5 min with `Authorization: Bearer <CRON_SECRET>`);
Stripe test purchase → live keys; set ADMIN_EMAIL; Resend domain verify + real
CAN-SPAM mailing address in `lib/email-digest.ts` (`BUSINESS_ADDRESS`, still
"PO Box 000"); make www primary; wait for carrier approval → text HELP as the
go-signal; then the ~15-min smoke walk in LAUNCH.md §B.

**Builds still pending (both non-security):**
1. **Digest columnar delivery** (the "make it work at 1500" build): the
   current send loop is a serial per-subscriber loop that times out past ~100
   subs and drops the rest silently. Plan = an outbox table enqueued per
   (part, subscriber), drained by the cron in bounded batches ordered by part
   (columnar: all get part 1 before part 2), resumable, + a per-slot cost
   circuit breaker + subscriber pagination (fixes the >1000 PostgREST silent
   truncation). The packing composer is done and waiting to be wired in here.
   **Cost/throughput reality to weigh first:** 1500 subs × ~7 seg × 4 slots ≈
   ~$5k/mo, and you exceed T-Mobile's 2000/day unvetted cap well before 1500
   subs → external vetting (~$40) becomes mandatory.
2. **Photo re-hosting to Supabase Storage** on inbound MMS (reliability; the
   image-host allowlist already lets Telnyx/Supabase photos render).

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
