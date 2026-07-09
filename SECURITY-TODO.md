# SECURITY-TODO — pre-launch hardening

From a 4-agent audit of the whole system (2026-07-07), deduplicated and
prioritized. Each item: **[code]** = a change I make in the repo, **[ops]** =
something you do in a dashboard. Severity and the one-line reason follow.

The single root cause behind most CRITICALs: **security controls fail OPEN.**
A protection is gated on whether a provider key exists, not on whether this is
production — so one missing/forgotten env var silently disables it.

## Status (2026-07-08, session 003)

**All prior migrations applied by the user (0001–0003, 0005)** — the P0
fail-closed build, the money-race build, and the ledger-ref unique index are
live end to end.

**FIXED — digest delivery build (session 003, ⚠️ needs migration 0006 run
BEFORE this code deploys):** the serial per-subscriber send loop is gone.
Composing a due slot now enqueues one `digest_outbox` row per (subscriber,
message part); the cron drains bounded batches in columnar order (every
subscriber gets part 1 before anyone gets part 2) with bounded concurrency
(8), `maxDuration=60` + an internal ~45s time budget, and resumes next tick —
a timeout can no longer half-send a digest or re-broadcast double-cost. The
GSM-packing composer is wired in (one emoji can't flip the broadcast to
UCS-2; parts capped at ~4 segments). Digests now have their own cost circuit
breaker: `digestDailySegmentBudget` (admin-set, default 12,000 billed
segments per rolling 24h; 0 pauses) — on trip, sending halts, rows wait, the
admin is emailed once (no 5-min re-alert spam). Failed sends retry ×3 then
park as `failed` with the error recorded. The email edition rides the same
outbox. Also fixed: PostgREST 1000-row truncation (`listSubscriberPhones`,
`listEmailRecipients` paged — subscribers past 1000 now get digests;
`getCreditBalance` paged — no more wrong balances from a 1000-row prefix);
`digestsSentOnDay` store parity (SMS-with-items only in both stores);
ad-id parser full-integer match. Verified in dev: 27/27 scenario checks +
breaker-trip alert walk.

**OPS to activate:** run `supabase/migrations/0006_digest_outbox.sql` (also
inserts the `digest_daily_segment_budget` config row); keep `ENABLE_DEV_TOOLS`
UNSET in production; set `ADMIN_EMAIL` so breaker-trip alerts reach you.

**DECISION RESOLVED:** contact masking stays web-on / SMS-off — already the
current behavior, no change.

**STILL PENDING (dedicated build):** photo re-hosting to Supabase Storage on
inbound MMS. Plus the user-input item: real CAN-SPAM mailing address in
`lib/email-digest.ts`.

## Verification pass + follow-up fixes (2026-07-08, session 003)

A 7-agent adversarial re-audit checked every item above against the code on
`main` (not the checkboxes). All P0/P2 items and the money-race items verified
genuinely fixed in both stores. It also caught gaps behind items that were
marked done, now fixed (commits on `main`):

- **Digest ad starvation (Supabase):** new PAID ads could silently never
  broadcast — `getNewDigestAds` scanned the cap×3 oldest approved ads, but
  Supabase never expires approved ads so already-broadcast ones fill the
  window. Fixed with an `ads.broadcast_at` column (**migration 0007**).
- **Open-redirect** had a surviving tab-character bypass
  (`/⇥/evil.com` → `//evil.com`); **SOLD/revive** lacked a store-level status
  guard (engine-only); **photo ingest** validated scheme but not host (a
  crafted `//evil.com` passed); more **unbounded reads** (`getPendingAds`,
  `getSmsAdIdsSince`, `getLedger`) hit the 1000-row cap; two **dev-only
  echoes** (email confirm link, plaintext OTP storage) were gated on a missing
  provider key rather than `devToolsEnabled`. All fixed and dev-verified.

**Two deferred — DECIDED 2026-07-09 (session 005):**

- [x] **[decision→code] Defer the starter free-ad grant to the first `AD NEW`.**
      RESOLVED: user chose to defer. Accounts are now created with ZERO passes
      (no "Welcome" ledger row at creation); the 3-ad grant is applied lazily on
      the seller's first real post via `grantStarterAdsIfFirst` (idempotent,
      guarded by the new `users.starter_granted_at` — **migration 0010**), so a
      number that only ever texts SUBSCRIBE/CREDITS/MYADS mints no passes. The
      race is closed by a conditional update on `starter_granted_at IS NULL`.
      Site copy ("your first 3 ads are free") updated. Dev-verified end to end.
- [x] **[decision] Keep inbound message logging un-rate-limited.** RESOLVED:
      user chose to keep it (matches the recommendation) — the audit log is the
      abuse-forensics record; it stays gated by the Telnyx signature + the
      per-message provider-id dedup. No code change.

---

## P0 — before the site is public / before re-adding TELNYX_API_KEY

- [x] **[code] Fail-closed secrets + prod guards on dev backdoors.** One change,
      kills ~6 findings. In production (`NODE_ENV === "production"`):
      - `lib/session.ts:15` — throw if `SESSION_SECRET` unset (today it falls back
        to the public string `"dev-secret-not-for-production"`; that fallback =
        forge any session/cookie = full account + admin takeover). *Currently
        mitigated only because you set SESSION_SECRET.*
      - On-screen sign-in code echo (`app/login/page.tsx`) + `/dev/sms` +
        `/dev/email` + `simulatePurchase` (`lib/account-actions.ts`) — gate on
        `NODE_ENV !== "production"`, not just the missing provider key. **Live
        risk right now:** with `TELNYX_API_KEY` unset, `/dev/sms` is reachable on
        the public domain and lets anyone post/moderate/subscribe as any number,
        and login shows the OTP on screen.
      - `app/api/telnyx/inbound/route.ts:12` — fail closed if `TELNYX_PUBLIC_KEY`
        unset in prod (today it trusts every request → forge inbound SMS from any
        number → drain a victim's credits).
      - `app/api/cron/digests/route.ts` — fail closed if `CRON_SECRET` unset.
- [x] **[ops] Set `TELNYX_PUBLIC_KEY`** (Telnyx → Account → Public Key) BEFORE you
      re-add `TELNYX_API_KEY`. Without it the inbound webhook is unauthenticated.
- [ ] **[ops] Confirm every required prod secret is set** so the new boot-guard
      doesn't refuse to start: `SESSION_SECRET`, `CRON_SECRET`,
      `TELNYX_API_KEY` + `TELNYX_PUBLIC_KEY`, `STRIPE_SECRET_KEY` +
      `STRIPE_WEBHOOK_SECRET`, `SUPABASE_*`, `SITE_URL`.

## P1 — cost leaks (before you have real subscribers)

- [x] **[code] Digest fan-out is a serial per-subscriber loop with no time budget**
      (`lib/digest-engine.ts:114`, `lib/email-digest.ts`). Past ~50-100
      subscribers the cron function times out mid-send: some people get the
      digest, the rest silently don't, and the same ads re-broadcast (double
      cost) next slot. Fix: bounded-concurrency or Telnyx batch send, a
      per-recipient "sent" cursor so re-runs resume, and an explicit
      `maxDuration`.
- [x] **[code] Digest length/segment is unbounded, and one non-GSM character
      (emoji, curly quote, em-dash, accent) flips the WHOLE digest to Unicode**
      for every subscriber that slot — ~2.3× the cost of the entire broadcast
      for a $1 ad. Fix: measure segments before send, hard-cap per digest,
      strip/transliterate non-GSM characters in ad bodies.
- [x] **[code] Digests are exempt from the cost circuit breaker**
      (`smsGlobalPerHour` only counts command replies). The largest cost center
      has no cap. Fix: a per-run/per-day segment×recipient budget that halts and
      alerts.
- [x] **[code] Credit + free-ad spending is a read-then-write race**
      (`lib/engine.ts:96-130`, `consumeFreeAd` in `store-supabase.ts:121`).
      Concurrent `AD NEW` can post multiple ads on one credit / one free ad and
      drive the balance negative (`consumeFreeAd` ignores the UPDATE row count
      and returns true even when it changed nothing). Fix: atomic guarded
      decrement (`... WHERE free_ads > 0 RETURNING *`, treat 0 rows as failure);
      conditional credit decrement, not sum-then-insert.
- [x] **[code] Rate-cap check is read-before-send, increment-after**
      (`lib/engine.ts:313`). A concurrent burst all reads sub-threshold and all
      sends, blowing the 500/hr breaker. Fix: reserve the slot atomically before
      `sms.send`.
- [x] **[code] STOP bypasses the cap and still sends a reply every time**
      (`lib/engine.ts:196`) with no dedup — a STOP loop is unbounded outbound SMS
      + account/ledger writes. Fix: confirm opt-out at most once per number per
      window (like the existing 1-per-day redirect dedup).
- [x] **[code] Every inbound from any number auto-creates an account + ledger row
      + 3 free-ad passes** (`ensureAccount`), before any cap and even for STOP.
      A flood of spoofed numbers mints unbounded accounts/liability. Fix: don't
      grant starter free ads on first *contact*; defer to first real use, and
      rate-limit inbound logging/account creation.
- [x] **[code] Queries with no `.limit()` hit PostgREST's ~1000-row default**
      (`listSubscriberPhones`, `listEmailRecipients`, `getCreditBalance` in
      `store-supabase.ts`). Result: subscribers past 1000 **never get digests**,
      and a busy account's balance is summed from only the first 1000 ledger
      rows (wrong balance → overspend or false denial). Fix: paginate the lists;
      compute balance with a SQL `sum()` aggregate or a stored balance column.
- [x] **[code] Admin settings accept unbounded values** (`digestCap`, `maxChars`,
      the caps themselves) (`lib/admin-actions.ts:85`). One fat-fingered save →
      thousand-ad / giant-body digests, or the breaker set to infinity. Fix:
      clamp each to a sane min/max.

## P1.5 — moderation & revenue leaks (4th audit pass)

- [x] **[code] `SOLD` on a *pending* ad publishes unreviewed content to the public
      site** (`lib/engine.ts:150`, `markAdSold` has no status guard). Attacker
      texts `AD NEW <prohibited text + contact>`, gets the id, texts `SOLD <id>`
      — the raw, never-reviewed body appears on the homepage as "Sold,"
      bypassing human review entirely, for 1 credit. **HIGH.** Fix: only allow
      SOLD from `approved`/`expired`; add a status guard in `markAdSold`.
- [x] **[code] Bumps are unconditionally free and unlimited; expired-ad revival
      is infinite** (`lib/engine.ts:157-172`). `settings.bumpCost` is never
      charged (dead config), and `BUMP` on an expired ad calls `reviveAd` for a
      free new 30-day run — repeatable forever. Re-queue a bump before every
      slot → free re-broadcast to the whole list 4×/day. Revenue leak + a
      broadcast-cost vector. Fix: charge `bumpCost` (balance check + ledger
      entry) before `queueBump`; same for revive; add a revival cooldown/quota.
- [x] **[decision] Contact masking is SMS-bypassable.** The website masks phone
      numbers until sign-in, but any number that texts `SUBSCRIBE` (no
      verification) receives full-contact digests (`digest-engine.ts:61`). Decide
      the threat model: if masking matters, digests to unverified subscribers
      should mask too, or subscribers must be verified. If it doesn't (contact
      info in a classified ad is meant to be reachable), document that and drop
      the web masking as security theater.

## P2 — integrity / correctness

- [x] **[code+db] Credit-grant idempotency is app-level and racy; no DB unique
      index on `credit_ledger.ref`.** Two concurrent Stripe deliveries of the
      same event can both pass the check and double-credit. Fix: `create unique
      index ... on credit_ledger(ref) where ref is not null` + upsert / catch
      23505. (Migration — I'll write it; you paste it in the SQL editor.)
- [x] **[code] Refund matches the charge by note substring** (`moderation.ts:50`):
      `"Ad #123".includes("Ad #12")` is true, so rejecting ad #12 can refund
      #123's larger charge. Fix: match the exact ad id (structured column or
      delimited token), not `includes`.
- [x] **[code] Concurrent benign rejection can double-refund** (`moderation.ts`).
      Fix: only refund when this call actually transitioned the row.
- [x] **[code] Telnyx webhook has no replay/timestamp check and no inbound
      idempotency** — a captured valid webhook replays forever, and ordinary
      retries double-process one `AD NEW`. Fix: timestamp tolerance +
      dedup on Telnyx message id (unique on `messages.provider_id`).
- [x] **[code] Stripe webhook grants by pack metadata without checking the amount
      paid.** Not exploitable today (price + pack both server-set), but zero
      cross-check. Fix: verify `amount_total >= pack price` before granting.
- [x] **[code] Open-redirect via backslash in `next`** (`auth-actions.ts:23`):
      `/login?next=/\evil.com` → offsite after sign-in. Fix: reject `\`, or
      resolve against the site origin.

## P3 — launch-day failure modes (mostly ops, verify don't assume)

- [ ] **[ops] The digest cron actually fires every 5 min** (external pinger with
      the `Authorization: Bearer <CRON_SECRET>` header). This is the silent
      launch-killer: Vercel Hobby runs crons once/day. Test one manual hit →
      `{"ok":true,...}`.
- [ ] **[ops] Stripe live keys are a matched pair** (live secret + live webhook
      secret); do one test-mode `4242…` purchase first.
- [ ] **[ops] Resend domain shows Verified** before the email edition sends; real
      mailing address set (see below).
- [ ] **[code] Real CAN-SPAM mailing address** in `lib/email-digest.ts` (still
      "PO Box 000"). *Needs the real address from you.*
- [ ] **[ops] Final `/api/health` on the live domain**: everything `true`,
      `sb_secret (correct)`, `configTable.ok` with rows.
- [x] **[code] Photo ads will NOT render on the public site** — `next.config.ts`
      has no `images.remotePatterns`, so real inbound-MMS photo URLs throw in
      the `<Image>` optimizer (fixtures use local paths and hide this in dev).
      **Launch-day breaker for any picture ad.** Fix: allowlist the Telnyx/media
      host in `remotePatterns` and validate the URL scheme/host on ingest.
      (Silver lining: because nothing is allowlisted, there's no image-optimizer
      SSRF today.)

## Low / informational (from the 4th pass)

- [x] **[code] Ad-id parser truncates >6-digit ids and ignores signs**
      (`commands.ts:21`): `SOLD 12345678` → `123456`; `SOLD call 3305550142` →
      `330555`. Contained by the ownership check, but fix to match the full
      trailing integer once ids could exceed 6 digits.
- [x] **[code] `digestsSentOnDay` differs between stores** — Supabase counts empty
      slots, the file store doesn't, so an early empty slot can drop the "Reply
      STOP to end" line from the day's first real digest (minor compliance nit).
- Word-filter escaping is **correct** — no ReDoS, no regex injection (verified).
  It's easily bypassed by spacing/homoglyphs, which is fine: every ad is
  human-reviewed. Don't treat auto-reject as a security control.

## Notes — what the audit found SOLID (no action)

- Stripe signature verification: raw-body HMAC, constant-time, 300s tolerance,
  **fails closed** (the one secret done right).
- Session/password crypto: HMAC length-checked + `timingSafeEqual`, scrypt,
  expiry bound into the signed payload.
- Admin server actions each call `requireAdmin()`; SOLD/BUMP ownership enforced;
  checkout price is server-set (client can't choose the amount); credits go to
  the authenticated phone only.

All four audit passes are folded in (webhooks/money, auth/session,
cost/economics, engine/moderation logic).
