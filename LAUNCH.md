# LAUNCH.md — go-live checklist

Everything between here and launch, in order. Work top to bottom; section A
items are blockers, section B is the launch-day smoke test, section C can
follow after launch. (Cross-session state lives in HANDOFF.md; this file is
the countdown.)

**Status as of 2026-07-07 evening:** A1 ✅ (both hosts identical, supabase
mode, sb_secret correct) · A3 ✅ (seed-production.sql run) · ADMIN_PHONES ✅ ·
TCR_ACCEPTED ✅ (carrier acceptance pending). Remaining: the unchecked boxes
below.

## A. Blockers — all green before telling anyone

### A1. One deployment, correctly configured
- [x] Check `/api/health` on **both** hosts. The detailed report is now
      operator-only — pass the CRON_SECRET bearer:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://www.theplainexchange.com/api/health`
      (and the `the-product-engine.vercel.app` host). Both must show
      `mode: "supabase"`, `sb_secret (correct)`, `configTable.ok: true`, and
      identical env booleans. Without the bearer the endpoint returns only
      `{"ok":true,"mode":"supabase"}` (that's the disclosure fix, not a bug).
- [ ] If they differ, a second Vercel project still owns the domain: remove
      the domain there (Settings → Domains), add it to **the-product-engine**,
      make `www.theplainexchange.com` primary (apex redirects), delete the
      duplicate project.

### A2. Environment variables (the-product-engine, Production scope)
Redeploy after any change — env edits never touch running deployments.
- [x] `SUPABASE_URL` — set
- [x] `SUPABASE_SERVICE_ROLE_KEY` — the `sb_secret_…` key (health confirms)
- [x] `SESSION_SECRET` — long random string (`openssl rand -hex 32`)
- [x] `ADMIN_PHONES` — `3306001834` (comma-separate future admins)
- [x] `CRON_SECRET` — another random string (used in A5)
- [x] `SITE_URL` — `https://www.theplainexchange.com`
- [ ] `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` (`+13309607170`),
      `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_PUBLIC_KEY`
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — a matched pair
      (test with test, live with live; mixing them = payments succeed but
      credits never arrive)

### A3. Database seeded + migrated
- [x] Run `supabase/seed-production.sql` in the Supabase SQL editor
      (config, packs, word filter — no demo data; safe to re-run).
- [x] **`0006_digest_outbox.sql`**, **`0007_ad_broadcast_at.sql`**,
      **`0008_blocklist_and_controls.sql`** — all run 2026-07-08 (session 004).
      (0006 = outbox delivery; 0007 = `ads.broadcast_at`; 0008 = blocklist +
      operator-control config rows.)
- [ ] **Run `supabase/migrations/0009_verify_login_code.sql`** (SQL editor;
      re-runnable). Adds the `verify_login_code` RPC that checks-and-burns a
      login code under a row lock (fixes the OTP attempt-cap race →
      brute-force/takeover). Until it's applied, sign-in code verification
      errors (the app calls the RPC). Run before this deploy reaches prod.

### A4. Telnyx
- [x] Campaign fully accepted (TCR_ACCEPTED ✓ 2026-07-07; wait for carrier
      acceptance — typically hours to ~2 days after TCR).
- [ ] Number **+1 330 960 7170** assigned to the campaign's messaging profile.
- [x] Messaging profile inbound webhook:
      `https://www.theplainexchange.com/api/telnyx/inbound` (API v2),
      failover `https://the-product-engine.vercel.app/api/telnyx/inbound`.

### A5. Digest cron — THE silent launch-killer
Vercel **Hobby runs crons at most once per day**; the `*/5` schedule in
`vercel.json` will not fire every 5 minutes on Hobby, and digests simply
won't send. Pick one:
- [ ] Upgrade the Vercel project to Pro (the vercel.json cron then works
      as written), **or**
- [ ] Free external pinger (cron-job.org, UptimeRobot, etc.):
      `GET https://www.theplainexchange.com/api/cron/digests`
      every 5 minutes with header `Authorization: Bearer <CRON_SECRET>`.
- [ ] Verify: hit the URL once with the header — expect
      `{"ok":true,"sms":[…],"email":[…],"drain":{…}}`, and 401 without it.
      (`drain` is the outbox delivery pass: `sent` / `failed` / `remaining` /
      `halted` — `halted:true` means the daily digest segment budget in
      `/admin/settings` stopped sending and queued rows are waiting.)

### A6. Stripe (live)
- [ ] One test-mode purchase first (test keys, card `4242 4242 4242 4242`):
      credits appear, order-complete page renders, webhook shows `200`.
- [ ] Switch BOTH Stripe env vars to the live pair; create the live-mode
      webhook destination (same URL, `checkout.session.completed`).
- [ ] One real purchase of the $5 pack from your own card; refund it in the
      Stripe dashboard afterward if you like (credits stay unless you
      adjust them in admin).

### A7. Admin access
- [x] Sign in at `/login` with 330 600 1834 → "Admin" appears top-right.
- [x] `/admin/settings` loads and shows the seeded numbers (proves the
      config table round-trip).

## B. Launch-day smoke test (~15 minutes, from your own phone)

1. [ ] Text `HELP` → commands list returns. **This is the go signal.**
2. [ ] Text `SUBSCRIBE` → confirmation with frequency + STOP/HELP.
3. [ ] Text `AD NEW Farm wagon, $50. Call 330-600-1834.` with a photo
       attached → "waiting for review" reply, free-ad note.
4. [ ] `/admin` → the ad is in the review queue → approve it → approval
       text arrives.
5. [ ] Digest: either wait for the next ET slot (7 / 12 / 16 / 20) or set a
       temporary near-term slot in `/admin/settings`, let it fire, then set
       it back. Digest text arrives; ad is on the website.
6. [ ] Text `PIC <ad#>` → photo comes back by MMS.
7. [ ] `STATUS <ad#>` → "Available" · `BUMP <ad#>` → queued reply ·
       `SOLD <ad#>` → sold confirmation, site shows SOLD.
8. [ ] Text `STOP` → unsubscribe confirmation · `START` → re-subscribed.
9. [ ] Website from a second browser: browse, sign in with a second number,
       masked contact reveals after sign-in, buy the $5 pack, order-complete
       page, credits on the account page.
10. [ ] Clean up: reject/mark-sold the test ad in admin; check Vercel logs
        for errors and `/api/health` one last time.

## C. Soon after launch (not blockers)

- [ ] **Email edition**: set `RESEND_API_KEY` + verify the sending domain
      (SPF/DKIM in Resend), and replace the placeholder mailing address in
      `lib/email-digest.ts` (`BUSINESS_ADDRESS`, currently "PO Box 000") —
      CAN-SPAM requires a real one. Email stays dormant until the key is set.
- [ ] **Email-in subscribe** (optional): to let people subscribe by emailing
      `subscribe@theplainexchange.com`, add that Inbound address in Resend
      (its MX setup), point its webhook at `/api/email/inbound`, and set
      `RESEND_WEBHOOK_SECRET` (the endpoint's `whsec_…`). Without the secret the
      route fails closed in prod. Optionally set `EMAIL_INBOUND_ADDRESS`.
- [ ] **Logo** → site header + real `favicon.ico` (clears the /favicon 404s
      in the logs).
- [ ] **External vetting** (~$40) when subscribers × digests approach
      T-Mobile's 2,000 msgs/day unvetted cap.
- [ ] **/BUYCREDIT by text**: the checkout already saves cards off-session
      and stores `stripe_customer_id`; the SMS-side confirm-and-charge flow
      is the remaining build.
- [ ] **Flyers**: print and post only after B1 (HELP) passes.
