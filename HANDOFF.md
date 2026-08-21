# HANDOFF — The Plain Exchange

**Live cross-session state.** What is true RIGHT NOW and what still needs
doing. Kept deliberately short.

- **The session-by-session narrative lives in `HANDOFF-ARCHIVE.md`** — the WHY
  behind every decision, what was tried and rejected. Nothing was lost when it
  moved out of this file in session 021; go read it when you need history.
- **Per-session detail:** `Session log/<session>/session_log.md`.
- **Before you touch anything:** `CLAUDE.md` rule 0 and §8 of
  `new_session_instructions.md` — several sessions run against this repo at
  once, and the collisions that hurt are the ones that merge cleanly.

**Last updated:** 2026-08-21, **v1.5.11** — sessions 021 and 022 ran in
parallel and both landed. 022: ad cards, editing in every status, Digests
becomes Batches with a real queue preview, promote-to-Featured, pictures on
/admin/ads, and a page-down bug. 021: the call line no longer dials the
operator's cell, admin TEST MODE, the first end-to-end category delivery
tests, Twilio Trust Hub verified, and this file split. Both narratives are in
`HANDOFF-ARCHIVE.md`.

*Why this file is short: it was the hottest file in the repo — 8 of 12
consecutive commits touched it, and it was the only conflict when 021 and 022
merged. Keeping it to live state is what stops that. **Put new narrative in
your session log, not here.** Only add to this file what a future session must
know on day one.*

---

## ✅ START HERE: the migration queue is CLEAR (user confirmed 2026-08-21)

**`9951`, `9952` and `9953` are all applied**, along with everything before
them. Nothing is waiting. Every feature below is fully on rather than
degrading, so if one misbehaves, a pending migration is NOT the explanation —
look at the code. **`9951` is the newest; the next migration takes 9950 —
confirm with `npm run check:migrations`, which reads `origin/main` too.**

Consequences now live: held-unpaid ads are really held and released by a card
(9953), scheduled admin broadcasts work (9952), and test ads carry the
`is_test` label so they can be found and deleted (9951 —
`delete from ads where is_test;`).

### Everything before them was already applied (user confirmed 2026-08-21)

**`9954`, `9955`, `9956` and `9957` are applied.** Nothing else is waiting. Every
feature below is fully on rather than degrading, so if one of them misbehaves,
a pending migration is NOT the explanation — look at the code.

Consequences worth carrying:

- **`9954_reset_ledger.sql` has RUN.** It is destructive and runs exactly
  once; it is spent, and it has disarmed itself — `config.ledger_reset_at`
  carries `{"shape": "wipe-and-grant-v2"}`, so re-pasting does nothing.
  Resetting the books again means deleting that config row FIRST,
  deliberately. Do not write a "reset the books" migration by copying this one
  without reading why it was shaped that way (money section below).
- **`9955_saturday_close.sql` has RUN**, so the stored `sms_window_end_hour`
  row now matches the 6pm the public pages promise. The Saturday trap still
  stands as a rule to remember: **deleting `sms_saturday_end_hour` does not
  disable the early close** — with no row, `getEngineSettings` falls back to
  the CODE default and Saturday still stops at 5pm. Setting it equal to
  `sms_window_end_hour` is what turns it off.
- **`9957_money_kinds.sql` has RUN**, so `payment` / `courtesy` / `payout` are
  split out of the legacy `adjustment` catch-all and new money rows say which
  they are. The "unclassified" notice on /admin/money should read **$0** now —
  9954 deleted every legacy row, so there is no guesswork left to report. If
  it ever shows a figure again, that is a NEW unclassified row, not history.
- **`9956_featured_requests.sql` has RUN** — featured listings and the request
  queue are fully on.

---

## 💵 Unused balances are REFUNDABLE ON REQUEST (user decision, session 022)

*"Unused credits get refunded minus the 5% credit card processing fee."*

`/refund-policy` and the T&Cs both used to say refunds of money you added were
**"at our discretion"** — the opposite of the real policy. Both now say the
money comes back whenever you ask, to the card it came from, minus the ~5%
processing fee, and no fee at all when the fault is ours.

⚠️ **The grants-first carve-out is untouched and MUST stay.** Free credit
(welcome, invitation, courtesy) is not money and is never refundable — only the
cash-backed part comes back. That is what `refundableCents` in `lib/money.ts`
computes and what /admin/users refuses to over-refund. "Unused credits get
refunded" must never be read as promising the $40 welcome credit back as cash.

⚠️ A **"Refundable" figure exists only on /admin/users, never on the member's
/account page.** A draft of the policy page claimed otherwise and was corrected
before shipping. Add that figure to /account and the policy page can say so;
until then it tells members to ask.

## 📡 Where an ad goes, and what "paused" covers (session 022)

**The pipeline, and it is already what the user asked for:** approved → rides
the next SMS batch → `broadcast_at` stamped → **that same stamp is what puts it
on the website** → the next email edition carries it (`getUnemailedBroadcastAds`
requires `broadcast_at`).

⚠️ **There is no separate "publish to web" step, and do not add one.** All three
public queries in `lib/ads-supabase.ts` — list, single ad, category counts —
require `broadcast_at IS NOT NULL`, and the file store matches. Riding a batch
IS becoming visible. /admin/ads reports the two as one event for that reason.

**A paused ad therefore never reaches the website**, because it never
broadcasts. Pause coverage, all four checked: SMS compose ✔, outbox drain ✔,
**email compose ✔ (fixed session 022 — it was the one gap)**, website ✔ (via
`broadcast_at`).

⚠️ The email fix SKIPS the edition rather than composing it. Composing while
paused finalized the slot and stamped `emailed_at`, so the ads a pause was
holding back would have been marked carried and never appeared in the edition
that actually sent — the pause would have LOST them, not delayed them.

**An empty email edition already sends nothing** — `runDueEmailDigests` skips
when no ads are waiting, and always did.

⚠️ **Still unexplained: the user reported an ad reaching the website while ads
were paused.** The code above says that requires `broadcast_at`, so the ad must
have broadcast — the pause was not on at that moment, or something else stamped
it. The new /admin/ads delivery lines give the exact timestamps; settle it with
those rather than re-fixing code that already gates correctly.

## ⚠️ Open items

Live and unfinished. Anything resolved should be deleted from this list, not
annotated — a list of crossed-out things stops being read.

**1. Telnyx copy is out of date in two places. No code reaches either.**

- **The 10DLC campaign description** still says ads go out **7am–9pm** and
  **"up to 4 digests a day"**. Neither is true: the published window is 7am–6pm
  Mon–Sat (Saturday closes 5pm, unpublished), and SMS sends in batches rather
  than fixed digests. Carried across three sessions now.
- **The opt-in confirmation reply** was fixed by the user on 2026-08-21 and now
  reads *"…you're opted in to receive marketing texts - our local
  classified-ad **digests**…"* — but `/sms` publishes that same sentence as
  "our local **classified ads**". Carrier compliance wants the registered copy
  and the published terms to match word for word, and "digests" is the term
  this service RETIRED in session 018 when SMS became batches. **The published
  page is the correct wording; change the Telnyx string, not `/sms`** — editing
  the page to match would reintroduce a word deliberately swept out of
  member-facing copy in session 016 addendum 4.

**2. Delete `VOICE_RING_FIRST`, `VOICE_RING_TO`, `VOICE_RING_SECONDS` from
Vercel** (session 021). The code no longer reads them, so they are harmless —
but they read as live configuration and are not.

**3. Confirm `/admin/settings` → Email edition times are `7, 12, 17`**
(session 016 addendum 3). The saved config may still hold the old 2-slot
schedule; the code default is the 3-slot one.

**4. UNDECIDED, and it shapes both a policy page and a report: unused
balances.** The user asked and it was never settled — does the policy forfeit
an unused balance after N days, and how is ACTUAL income measured when fifty
people prepay $50 and never post? Today `/refund-policy` and the terms both
publish the opposite: ad credit *"doesn't expire"*. Changing that is a
published-promise change, not a code change. Full context in
`HANDOFF-ARCHIVE.md`, session 019.

**5. Insights money reporting has two known data gaps** — see
`HANDOFF-ARCHIVE.md`, session 019, before building any income report on it.

**Ops/launch checklist:** `LAUNCH.md` is the source of truth. `SECURITY-TODO.md`
is the audit status. Don't maintain a third list here.

---

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

### Where it stands

**Live in production**, deployed from `main` on Vercel. Stripe is live (real
money moves), Telnyx carries the SMS, Twilio carries the call-in card line, and
the Trust Hub business profile was verified 2026-08-21. Supabase is the
database; migrations are pasted by hand and the queue is currently clear.

The site version is in the footer and on `/api/health`, from `site.version` in
`lib/config.ts` (§6 of `new_session_instructions.md` is the bump rule).

---

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

**Guarding against an unpasted migration — read this before writing a query.**
Supabase requests go through PostgREST, which answers from its own schema
cache, so EVERY "column/table might not exist yet" guard needs BOTH codes:
columns are `42703` (Postgres) **and** `PGRST204`; tables are `42P01` **and**
`PGRST205`. Use the `tableMissing()` helper — never write a bare `42P01`
check. Session 022 took `/admin/digests` down in production this way: eight
table guards knew only the Postgres code, the "return [] when not pasted"
fallback never fired, and one unpasted migration threw the whole page. That
page has now gone dark twice, so its panels also load INDEPENDENTLY — one
failing renders its error in place and names itself while the rest still works.

**Dev-mode warning:** with no `TELNYX_API_KEY`, sign-in codes render
on-screen — anyone with the URL can log in as any number, and `/dev/sms` /
`/dev/email` are live. The deployment is not for public eyes until Telnyx is
configured (which disables all of it automatically).

## Product rules (grilled + confirmed 2026-07-06; do not relitigate)

> **⚠️ FROZEN — describes the CREDIT era.** Session 016 replaced credits with
> dollars, retired BUMP, and made SMS instant instead of a 4-slot digest. Read
> the session 016 addendums at the top of this file for what is true now; this
> section is kept as the record of what was decided when.

- One credit = one broadcast in the next digest; ad lists on site 30 days
  (config). Text ad 2 credits, picture 10 (defaults raised session 011; the user
  also set the live values on /admin/settings), starter grant 3 ads flat — all
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
external vetting raises it.

**Carrier/Trust Hub registration (settled 2026-08-21).** The Twilio Trust Hub
business profile is **VERIFIED**, after two sessions of error **18602**
("Business ID could not be verified"). What that error actually means: an
exact-match failure against IRS records. Legal name + EIN precisely as they
appear on the CP-575 (request a 147c letter if the CP-575 is lost), and a
STREET address — Twilio and TCR both reject PO Boxes. A newly issued EIN can
also take 30-90 days to reach the validation databases, so a correct
submission can still fail on timing alone. (An earlier note here said "no LLC
required" — true, but the profile that finally passed used the holding LLC's
EIN, so what matters is that the name and EIN are one matching pair, not which
entity they belong to.)

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
  the SQL editor; never `supabase db push`), and run **`npm run
  check:migrations`** before writing one and again before pushing — two
  parallel sessions taking the same number produces two files git merges
  cleanly, and the second then silently never gets pasted.
- **§8 governs working alongside parallel sessions** — fetch before reading
  anything, claim a session folder against `origin/main`, keep BOTH sides of a
  conflict in this file, never `git checkout main` to merge.
- Commits carry the Claude Code co-author trailer supplied by the harness.
- The `.agents/.claude/.codex` skills tooling is gitignored and reinstallable
  via `npx skills add mattpocock/skills` (`skills-lock.json` is committed).
