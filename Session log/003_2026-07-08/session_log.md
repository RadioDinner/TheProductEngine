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

## Open questions / next step

1. **Ops:** run migration 0006 (now a checkbox in LAUNCH.md §A3). Then the
   LAUNCH.md countdown as before (cron pinger, Stripe keys, ADMIN_EMAIL —
   which now also receives breaker alerts).
2. **Last pending build:** photo re-hosting to Supabase Storage on inbound
   MMS.
3. **User input still needed:** real CAN-SPAM mailing address for
   `lib/email-digest.ts` (`BUSINESS_ADDRESS`).
4. This branch (`claude/security-todos-noq7gf`) is pushed but not merged —
   review + merge to main when ready.
