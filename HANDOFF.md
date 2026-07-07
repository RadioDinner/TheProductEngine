# HANDOFF — The Plain Exchange

Live cross-session state document (per `new_session_instructions.md`). Update
this every session. Per-session detail lives in `Session log/`.

**Last updated:** 2026-07-07 (session 002).

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

## Current state (end of session 001)

**Built and locally verified — every v1 surface works end-to-end** via
scripted Playwright walks against `npx next start`:

- Public site (browse/search/detail, masked contact, printable how-it-works)
- Auth (phone → SMS code → password), HMAC cookie sessions
- Account area (append-only credit ledger, packs w/ simulated checkout,
  My Ads, email + subscription settings)
- SMS engine (all commands), digest broadcaster (idempotent ET slots),
  moderation (refund/strike/ban), Telnyx webhook w/ dormant Ed25519 verify
- Admin portal (`/admin`, gated by `ADMIN_PHONES` env)
- Email edition (confirmed opt-in, union-of-SMS digests, CAN-SPAM)

**Deployment: site loads; admin login is the open issue.**

- Vercel: https://the-product-engine.vercel.app — **homepage loads as of
  2026-07-07 (session 002).** The earlier `mkdir '/var/task/.data'` 500s were
  the file-store fallback running on Vercel's read-only lambda FS (Supabase
  env vars not reaching the runtime); a redeploy after the env fix resolved
  it. Remember: env-var edits only apply to *new* deployments.
- **OPEN: admin sign-in on production "doesn't work" (symptom not yet
  pinned).** Triage: `GET /api/health` (mode, env presence, key kind, DB
  round-trip) → then note the prod DB has no accounts, so first login is
  phone → on-screen code (no TELNYX_API_KEY) → set-password; `/admin`
  deliberately 404s for signed-in non-admins. Session 002 fixed an
  `ADMIN_PHONES` trap on branch `claude/vercel-mkdir-enoent-2ephir`:
  `isAdminPhone` now normalizes entries (a `+1`/`1` prefix used to defeat the
  match) — not live until merged to main.
- Domain: theplainexchange.com bought at Namecheap; plan is A `@` →
  76.76.21.21 + CNAME `www` → cname.vercel-dns.com (or Vercel nameservers),
  add both hosts in Vercel → Settings → Domains, then set `SITE_URL` and
  redeploy. Pushes to `main` already auto-deploy to production, and the
  domain simply aliases the latest production deployment.
- After login works: run a full verification walk against the live site (the
  Supabase code path has never run against a real database).
- Supabase: project exists, `supabase/migrations/0001_init.sql` applied by
  the user. **Unknown whether `seed.sql` was run — ask.** For production,
  offer a config-only seed: `seed.sql` mixes config/packs/word-filter
  (wanted) with 21 demo ads on 555 numbers (test-only).

## How the code is organized (the seams)

Everything externally-provided sits behind a swappable seam. Dev
implementations activate automatically when the provider env var is absent:

| Concern | Interface / switch | Dev implementation | Production |
|---|---|---|---|
| Data | `lib/db.ts` `supabaseConfigured` | JSON files in `.data/` (gitignored) | Supabase via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| SMS | `lib/sms.ts` (`smsDevEcho`) | console log + on-screen code echo + `/dev/sms` simulator | Telnyx via `TELNYX_API_KEY` etc. |
| Email | `lib/email.ts` (`emailDevEcho`) | audit-log capture + `/dev/email` viewer | Resend via `RESEND_API_KEY` |
| Payments | `lib/payments.ts` (`paymentsDevMode`) | simulated checkout page | Stripe via `STRIPE_SECRET_KEY` (NOT BUILT YET — the seam exists, real Stripe checkout/webhook is the remaining build task) |

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
  FIFO; bumps free (config 0), unlimited, one queued per ad, after new ads.
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

## Provisioning checklist (the remaining work, in order)

1. **Fix the Vercel deploy** (see Current state) + set all env vars from
   `.env.example`; note Vercel **Hobby crons are daily-only** — the 5-minute
   digest cron needs Pro or an external pinger sending
   `Authorization: Bearer <CRON_SECRET>`.
2. **Production seed** (config/packs/word-filter without demo ads).
3. **Telnyx**: account, 330 number, 10DLC Standard brand under the user's
   existing EIN — **no LLC required** (verified vs TCR/Telnyx/Twilio docs,
   2026-07-06); legal name must exactly match the IRS CP-575 letter; sole-
   prop-with-EIN registers as PRIVATE_PROFIT. Unvetted T-Mobile cap 2,000
   msgs/day (~1,500–2,000 subscribers of headroom); $41.50 vetting raises it.
   Then point the messaging profile webhook at `/api/telnyx/inbound` and set
   `TELNYX_*` env vars.
4. **Stripe**: build the real checkout + webhook behind `lib/payments.ts`
   (dev simulation currently fulfills the seam), enable saved cards for the
   future `/BUYCREDIT` confirm flow.
5. **Resend + domain**; replace the placeholder PO Box in
   `lib/email-digest.ts` (`BUSINESS_ADDRESS`) with the real CAN-SPAM address.

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
