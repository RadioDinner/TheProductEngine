# Session 001 — 2026-07-06 → 2026-07-07

First session of the project. Went from an idea in `initial plan.txt` to the
complete v1 product surface, committed and deploying.

## What shipped

- `abb9eca` — The Plain Exchange v1: full product surface against local dev
  seams (73 files: site, auth, account/credits, SMS engine, admin portal,
  email edition, Supabase migration + seed, PRODUCT.md/DESIGN.md).
- `aa8efe8` — /api/health diagnostics + data-layer error logging (Vercel 500
  investigation, still open — see below).
- (this commit) — Session log structure + HANDOFF.md.

## Directional decisions

The entire product spec was decided in a 23-question grilling session; the
full detail lives in HANDOFF.md ("Product rules"). Highlights:

- Holmes County launch, single list; `county` bones in schema for later.
- Sellers fund it (credits); subscribers free; premium tier maybe later.
- One credit = one broadcast; unlimited free /BUMPs (config 0), one queued
  bump per ad, new ads outrank bumps; "Premium ads" future product.
- Manual review of every ad; word filter admin-managed (flag vs auto-reject);
  benign rejection refunds, violation = strike, 3 strikes = posting ban.
- Text ad 1 credit, picture 5 (admin-config); starter grant = 3 ads flat.
- Every message in/out logged forever (audit table).
- Website: public browse, contact info masked until sign-in; SMS-only ad
  posting in v1; account claim via SMS code then phone+password.
- Email edition: confirmed opt-in, union of SMS digests, photos inline.
- 10DLC: Standard brand under existing EIN, NO LLC needed (verified against
  TCR/Telnyx/Twilio docs); legal name must match CP-575 exactly.
- Repo: github.com/RadioDinner/TheProductEngine (codename TheProductEngine).
  Visibility is the user's business — do not raise it again.
- Design: "The Plain Ledger" north star; product register; two inks on white
  paper; no parchment, no letterpress cosplay (PRODUCT.md / DESIGN.md).

## Open questions / next step

1. **Vercel deploy is 500ing** (digest 2292519677) at
   the-product-engine.vercel.app. Diagnosis so far: only data-layer routes
   fail; static-ish routes work → Supabase env not reaching the app or wrong
   key (user initially pasted `sb_publishable_`; needs `sb_secret_`).
   `aa8efe8` added `/api/health` — **first move next session: GET
   /api/health on the deployment** and read the verdict. Then run the full
   live verification walk.
2. Seed strategy for production: `supabase/seed.sql` mixes config/packs/word
   filter (wanted) with 21 demo ads on 555 numbers (test-only). Offer a
   config-only production seed; user hasn't chosen yet. Unknown whether the
   user ran seed.sql at all — ask.
3. Vercel Hobby plan limits crons to daily — the 5-minute digest cron needs
   Pro or an external pinger with the CRON_SECRET header.
4. Provisioning queue: Telnyx (number + 10DLC), Stripe, Resend, real business
   address for the CAN-SPAM footer.
5. `new_session_instructions.md` sections 4–5 reference another project
   (CoachAccountable docs, 9999-descending migrations). This repo's applied
   migration is `0001_init.sql` (ascending). Ask the user whether NEW
   migrations should adopt the descending convention.

## Prevalent things future-me should know

- Persistent memory (`the-plain-exchange-project` and
  `feedback-repo-visibility`) carries the spec and etiquette; HANDOFF.md is
  the in-repo equivalent.
- All local verification is scripted Playwright walks; two repo-specific test
  gotchas are documented in HANDOFF.md ("Testing gotchas").
- Dev harnesses (/dev/sms, /dev/email, on-screen codes) are keyed off missing
  provider env vars — a deployment without Telnyx keys lets anyone sign in as
  any number. Not public-ready until Telnyx exists, by design.
