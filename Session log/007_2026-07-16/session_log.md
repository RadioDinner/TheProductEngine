# Session 007 — 2026-07-16

**Theme: "Texting START/SUBSCRIBE to (330) 960-7170 does nothing — why?"**
All work committed directly to `main` per the user's instruction for this
session.

**⚠️ STATUS AT THIS POINT (session still in progress):** migration 0011 was
applied and keyword texts now get replies — BUT the quoted SUBSCRIBE reply
text ("You're subscribed to The Plain Exchange - Holmes County, Ohio…") does
NOT exist in the app; it is the 10DLC campaign's registered opt-in
confirmation, auto-sent by TELNYX's keyword responder. So keyword replies do
not yet prove the app's webhook path is alive. `AD NEW` (not a registered
keyword → no auto-response) got silence. Remaining split: webhook still
rejected (bad TELNYX_PUBLIC_KEY → 401) vs app processing fine but every
outbound Telnyx send failing (then the trailer ad IS in the /admin review
queue and a free pass was burned). Vercel function logs + /admin decide it.

## Outcome

**ROOT CAUSE: migration `0011_pic_quota.sql` had never been applied**, while
`main` (which prod auto-deploys) had carried the session-006 code that reads
`users.pic_balance` / `pic_accrual_day` on EVERY account lookup
(`USER_SELECT`, `lib/store-supabase.ts`). The chain:

1. START/SUBSCRIBE → `handleInbound` → `route()` → `ensureAccount()` — its
   first query selects the missing columns → Postgres 42703 throw.
2. The webhook returned 500 to Telnyx.
3. Telnyx retried — but `recordInboundOnce` had already inserted the message
   row on attempt #1, so the retry deduped to a silent no-op (200).
4. Net effect: every inbound text permanently swallowed. Perfect silence,
   even though brand/campaign were approved and the number, messaging
   profile ("Advertising"), and webhook URLs were all correctly configured.

The user pasted 0011 into the Supabase SQL editor → texted START → got a
confirmation reply ("working!") — but see the status note above: that reply
may have been Telnyx's campaign auto-responder, not the app. Verification of
the app path (AD NEW round-trip) is the open thread.

## How it was diagnosed

- Local end-to-end proof the app code was innocent: simulated Telnyx exactly
  (Ed25519-signed webhooks over `timestamp|raw_body` against a dev server
  with `TELNYX_PUBLIC_KEY` set) — START/SUBSCRIBE subscribed + replied,
  tampered/stale posts got 401. So the failure had to be config/ops.
- An adversarial audit workflow (4 finders → per-finding verifiers) over the
  webhook route, engine, transport, and deployment surface. Confirmed the
  0011 mechanism link-by-link; also CONFIRMED as real-but-not-firing:
  `TELNYX_PUBLIC_KEY` mispaste → blanket 401s; `pause_mode='all'` silently
  suppressing replies; non-E.164 `TELNYX_FROM_NUMBER` failing every send.
  REFUTED with repo evidence: www→apex redirect theory (session-002 logs
  show www serving the app), wrong Supabase key, missing `TELNYX_API_KEY`,
  v1-webhook payload shape.
- Sandbox network policy blocked probing prod directly, so prod was made
  self-diagnosing instead (see below).

## What shipped (all on `main`)

- `0b77a97` — **inbound-SMS observability**: `/api/telnyx/inbound` logs WHY a
  webhook is rejected (missing key / missing headers / stale timestamp /
  signature mismatch) and logs `handleInbound` crashes with sender + text
  before returning 500. `/api/health` (CRON_SECRET view) now reports
  `TELNYX_PUBLIC_KEY` / `TELNYX_FROM_NUMBER` (E.164 shape check) /
  `TELNYX_MESSAGING_PROFILE_ID`, plus a direct `migration0011` probe.
  Verified: signed-webhook e2e sim, `tsc` clean, 107/107 unit checks.
- `0698ed4`, `38366a0`, + this commit — session 007 prompt history / logs;
  HANDOFF + LAUNCH.md state updates (0009–0011 applied, number-profile
  assignment confirmed, SMS-live go-signal reached).

## Directional decisions

- Commit to `main` for the whole session (user instruction; prod
  auto-deploys `main` — kept changes observability-only for that reason).
- Deliberately did NOT rush a schema fix for the retry-swallow flaw
  mid-incident (see below) — repeating the deploy-before-migration hazard
  while diagnosing it would have been silly.

## Open questions / next session

- **Top launch blocker now: the external cron pinger (LAUNCH §A5).** Digests
  don't send and the public site stays empty until
  `GET /api/cron/digests` (Bearer CRON_SECRET) fires every 5 min.
- **Recommended resilience build:** any throw AFTER `recordInboundOnce`
  turns a transient failure into permanent message loss (Telnyx's retry
  dedups against the already-inserted row). Proper fix: a processing-state
  column on `messages` + idempotent handlers so retries can re-process.
  Confirmed by the audit as a standing design trap; user is aware.
- Launch-day smoke walk (LAUNCH §B: HELP, AD NEW, PIC, digest) is now
  unblocked — SUBSCRIBE/START verified live, rest untested on real SMS.
- Still pending from LAUNCH: Stripe live keys + test purchase, ADMIN_EMAIL,
  Resend domain verify + real `BUSINESS_ADDRESS`, www-primary + SITE_URL
  alignment, photo re-hosting build.
