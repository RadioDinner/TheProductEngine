# Session 003 — 2026-07-08

Branch: `claude/security-todos-noq7gf`. Kickoff prompt: "ran all the
migrations, work on the security to-do items." With migrations 0001–0003 +
0005 confirmed applied, the remaining SECURITY-TODO work was the digest
delivery build (the last dedicated-build item) plus two small fixes.

## What shipped

- `e3f49e9` — **Digest outbox: columnar delivery, segment budget breaker,
  pagination.** The big one; see the commit body and HANDOFF "What shipped in
  session 003" for the full breakdown. New migration
  `supabase/migrations/0006_digest_outbox.sql` (⚠️ must be run in the SQL
  editor BEFORE this code deploys — the cron errors without it).
- `d6bc755` — **Parse the full ad-id digit run** (`SOLD 12345678` no longer
  truncates to #123456).
- (this commit) — docs brought current: SECURITY-TODO status + 23 items
  checked off, HANDOFF, LAUNCH.md (0006 checkbox, new cron response shape),
  session log.

## Directional decisions

- **Migration numbering stays ascending** (0006 follows 0005). The
  new_session_instructions descending convention is the other project's;
  session 002 already established ascending here in practice. Flagging per
  the HANDOFF note — say the word and future migrations flip to descending.
- **Budget window is rolling-24h, not calendar-day** — a circuit breaker that
  resets at midnight can be gamed at the boundary; rolling can't. "Daily"
  in the setting name means "per 24 hours."
- **Budget semantics: 0 pauses digests** (breaker fully closed). Fat-fingering
  0 must not mean "unlimited."
- **Breaker-trip alert dedup:** alert only on the run that crossed the budget
  or a run that enqueued new work into a tripped breaker. Idle halted runs
  stay silent, so the 5-minute cron can't send 288 emails/day.
- **Email digests are budget-exempt** (0 segments — they cost ~nothing) but a
  halted drain stops them too; simplicity over precision while the breaker
  is tripped.
- **Columnar ordering is batch-granular:** with a tiny subscriber list, one
  subscriber's parts 1+2 can land in the same 8-concurrent chunk and race;
  at real list sizes each part fills whole batches, so the guarantee holds
  where it matters. Carriers don't guarantee inter-SMS ordering anyway.
- `digests.sent_at` now means "composed + enqueued," not "delivered" — it's
  the idempotency/finalize marker; delivery state lives per-row in the
  outbox.

## Verification

27/27 checks in a scripted walk (file store, prod build on :3311, per the
repo's Playwright convention): first digest w/ STOP footer; 10-ad multi-part
packed digest w/o footer; resume of requeued rows; budget halt + recovery;
email edition through the outbox; idempotent re-runs. Separate manual walk
confirmed the breaker-trip admin alert fires exactly once, with correct
numbers, on enqueue-into-tripped-breaker. `tsc` + `next build` clean.
Note for future walks: this environment needs
`chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`.

## Verification pass + round-2 fixes (after "commit to main")

Merged session 003 to `main` (fast-forward, pushed), then ran a 7-agent
adversarial workflow that re-checked every SECURITY-TODO item against the
code on `main` rather than the checkboxes. It confirmed all P0/P2 + money-race
items genuinely fixed in both stores, and caught real gaps behind items marked
done. Fixed and committed to `main`:

- `23446b2` — **digest ad starvation** (Supabase `getNewDigestAds` could
  silently stop broadcasting new paid ads; **migration 0007** adds
  `ads.broadcast_at`), **SOLD/revive store-level status guards**, and paging
  for `getPendingAds`/`getSmsAdIdsSince`/`getLedger`.
- `f0cd97b` — **photo ingest host allowlist** (`lib/media.ts`, rejects
  `//evil.com` + off-site), **open-redirect tab-bypass** fix (`lib/safe-next.ts`,
  shared by login page + auth actions), and **dev-echo gating** (email confirm
  link + plaintext OTP storage now require `devToolsEnabled`).
- 12/12 re-verified in a dev walk (tab-bypass, photo allowlist incl. subdomain
  spoof, SOLD-on-pending refused / SOLD-on-approved works, BUMP-revive, digest
  regression). `tsc` + `next build` clean.

Two `partial` items were deferred to a decision rather than changed
unilaterally (documented in SECURITY-TODO "Verification pass"): defer the 3
starter free-ads to first post (product/UX call), and rate-limit inbound audit
logging (recommend NOT — it's the forensics record).

## Follow-on features + a production incident (later in session 003)

After "commit to main," work continued directly on `main`:

- **Email-in subscribe** (`4843cd0`): emailing `subscribe@theplainexchange.com`
  now subscribes the sender and sends a welcome (one-click unsubscribe). New
  `/api/email/inbound` webhook — Resend Inbound, Svix-signature-verified,
  fail-closed in prod (`RESEND_WEBHOOK_SECRET`). User chose direct-subscribe
  over double-opt-in. 15/15 tests. **Ops:** add the inbound address in Resend,
  point its webhook here, set the secret.
- **Digest self-review fixes** (`4630f1a`): `getSmsAdIdsSince` paging needed a
  stable ORDER BY; `finalizeDigest` digest_items insert made idempotent
  (upsert) so a re-run after a partial failure converges.
- **PRODUCTION INCIDENT — `/admin` 500** (`cf46e29`): prod auto-deploys `main`,
  and the deploy landed the broadcast_at code before migrations 0006/0007 were
  run, so the shared `AD_SELECT` selected a missing column and every ad read
  (admin queue, SMS) 500'd. Fix: dropped `broadcast_at` from the shared reader
  (only the digest builder needs it), so a migration-lag deploy now degrades to
  "digests wait" instead of taking down /admin. **Lesson: run additive
  migrations before/with merging schema-dependent code, since prod auto-deploys
  main.** The user still must run 0006+0007 to restore digests.
- **Admin insights dashboard** (`5c724cb`): `/admin/insights` — top advertisers,
  who-texts-most, excessive-PIC flags (new `picAbusePerDay` setting, default
  15/day), engagement leaderboard, ad funnel, most-bumped ads. Selectable
  window (7/30/90d). Pure aggregation over paged reads, both stores. Degrades
  gracefully if a read fails. Verified end-to-end (activity → admin login →
  every table incl. the EXCESSIVE flag).

Branch note: `claude/security-todos-noq7gf` was **merged to `main`** early in
the session ("commit it to main and continue committing to main"); everything
after has been committed directly to `main`.

## Product + pricing work (session tail)

- **Support phone `(234) 301-0048`** (`d0f0b49`): new `site.supportPhone` for
  "call for help / to arrange payment"; the SMS number stays for texting ads.
- **Telnyx status** (`b6ca32c`): campaign moved to **Pending MNO Review** — last
  gate before it goes active; nothing to do but wait.
- **BUYCREDIT by text + 10% saved-card discount** (`923e0ce`): `BUYCREDIT
  <pack>` quotes a discounted price and `YES` charges the saved card
  off-session; idempotent via a deterministic ledger ref (no new table).
  New `savedCardDiscountPercent` setting (default 10). Dev-simulated + gated;
  the **live Stripe off-session path still needs a real test** once keys exist.
- **New-subscriber catch-up** (`9f160a9`): SUBSCRIBE/START sends the most recent
  digest's ads immediately (`sendRecentDigestTo`), once per real (re)subscribe.
- **2×/day digest default + site-after-digest** (`b60bf9d`): `slots [7, 18]`;
  the public site now shows an ad only once it has ridden a digest
  (`broadcast_at`). ⚠️ Prod DB still seeded with 4 slots — set on
  `/admin/settings`. ⚠️ Consequence: the site is empty until the cron composes
  digests, so the cron pinger now populates the website too.
- **Confirmed cost correction:** the user pointed out digest *frequency* is
  cost-neutral (each ad broadcasts once/day regardless of slot count) — true.
  The real cost driver is **ads × subscribers**, so per-ad economics go
  negative past a break-even subscriber count (~850 at $5 text / $15 picture).
  Delivered an Excel cost/pricing calculator (scratchpad, NOT committed — offer
  to add under `docs/` if wanted). Ad pricing stays 1 credit text / 5 credit
  picture for now.

## Product decisions parked (NOT built, NOT in any committed file)

- A future **premium tier** was discussed then redesigned to "digest ~1 hour
  earlier" (not more frequent). Per the user, **nothing about premium
  subscriptions is written anywhere in the repo** — keep it out of code, copy,
  and docs until told otherwise.
- Whether to reprice a **picture ad to 3 credits** (so $5/credit → $15) is
  pending the user's word; default is unchanged (5 credits).

## Open questions / next step

1. **Ops:** run migrations **0006 + 0007** (LAUNCH §A3); set the digest slots to
   `7, 18` on `/admin/settings` if 2×/day is wanted; then the LAUNCH countdown
   (cron pinger — now also what fills the website — Stripe keys, ADMIN_EMAIL).
2. **Wire email-in** (optional): Resend inbound address + `RESEND_WEBHOOK_SECRET`.
3. **Two deferred security decisions** (SECURITY-TODO "Verification pass"):
   starter-grant deferral and inbound-log rate-limit.
4. **Last pending build:** photo re-hosting to Supabase Storage on inbound MMS.
5. **User input still needed:** real CAN-SPAM mailing address in
   `lib/email-digest.ts` (`BUSINESS_ADDRESS`); and the picture-ad reprice call.
6. **Live Stripe test** of BUYCREDIT-by-text once Stripe keys are set.
