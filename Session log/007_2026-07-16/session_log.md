# Session 007 — 2026-07-16

**Theme: "Texting START/SUBSCRIBE to (330) 960-7170 does nothing — why?" →
root-caused (TWO stacked causes), fixed, SMS confirmed live end-to-end; then a
same-day feature batch (MMS photo re-hosting, admin Digests tab, bump/edit).**
All work committed directly to `main` per the user's instruction.

## The outage: two stacked root causes

**Cause 1 — migration 0011 never applied (killed INBOUND handling).**
`main` (auto-deployed) carried session-006 code reading `users.pic_balance` /
`pic_accrual_day` on every account lookup; the columns didn't exist. Every
START/SUBSCRIBE crashed at `ensureAccount()` → webhook 500 → Telnyx's retry
was swallowed by the inbound dedup (the message row is inserted before
processing), so each text was permanently eaten. User applied 0011 →
inbound worked.

**Cause 2 — TELNYX_API_KEY missing from the prod deployment (killed OUTBOUND).**
With no API key, `lib/sms.ts` silently runs the DEV transport: "sending" is a
console.log that always succeeds, so /admin/messages showed every reply as
sent while no SMS existed. The only real texts all day were Telnyx's
campaign-keyword auto-responses (every outbound record in Telnyx was 2 parts —
the auto-response length; the 7:58–7:59 ones failed because the number's
10DLC provisioning only completed 8:05–8:24, per `10dlc.phone_number.update`
webhooks). The user had `TELNYX_PUBLIC_KEY` set and believed that was "the
key" — the API key (Telnyx portal → Keys & Credentials → API Keys, `KEY…`) is
a different credential. Key added + redeploy → **PIC reply received on a real
phone: full SMS loop confirmed live.**

Diagnostic aids built along the way (all on `main`):
- Reason-coded webhook rejection logs + handleInbound failure logs; DLR
  (`message.sent/finalized`) receipts logged as `[telnyx-dlr]` lines.
- `[outbound]` logs naming every suppressed (pause/blocklist/throttle) or
  failed send — gate denials were previously invisible.
- `/api/health`: TELNYX_PUBLIC_KEY / TELNYX_FROM_NUMBER (E.164 + last-4 echo)
  / TELNYX_MESSAGING_PROFILE_ID posture + a `migration0011` probe.
- **`/admin/sms-diag`** (not in nav): sends a test SMS through the app's exact
  payload and fetches the message's LIVE status + carrier error codes by id —
  covers sends stuck queued/held that the portal's reports never show.
- Proof the app code was innocent: local simulation with real Ed25519-signed
  Telnyx webhooks (subscribe path end-to-end, tampered/stale → 401), plus a
  47-agent adversarial audit that confirmed the 0011 mechanism and refuted
  the www-redirect / wrong-Supabase-key / opt-out-list theories.

## Feature batch (user-requested, same day)

- **MMS photo re-hosting (`lib/photos.ts`)**: inbound picture-ad media is
  copied to Supabase Storage (public `ad-photos` bucket, lazily created) at
  ingest. Before: Telnyx media URLs off the allowlist were silently stripped —
  the user's real picture ad posted as text ("PIC 1004 → no picture") with no
  warning. Now: re-hosted URL → else original-if-allowlisted → else the ad
  posts as text AND the confirmation tells the seller the picture couldn't be
  saved. (Also fixes Telnyx media-URL expiry — the site serves our copy.)
- **Admin Digests tab** (`/admin/digests`): exactly what the next digest will
  carry — shares `selectDigestItems()` with the real composer — plus next-slot
  time, queued-outbox count, inline ad-text editing, recent digest history.
- **Ads tab**: free admin Bump (expired ads relist first, like seller BUMP),
  inline text editing, Picture badge, bump-queued indicator. Review queue:
  Picture badge + thumbnail links to full size. Messages log: MMS attachment
  links.
- New store ops `updateAdBody` / `listRecentDigests` (file + Supabase). No new
  migrations.
- Verified: 11-check Playwright dev walk + tsc + build + 107/107 unit checks.
  (Re-learned the hard way: `.ad-sold` chips are CSS-uppercased — match
  case-insensitively in walks. It's in HANDOFF's testing notes.)

## Directional decisions

- Commit to `main` all session (user instruction; prod auto-deploys).
- Seller-facing honesty rule affirmed: never silently drop a paid-for photo —
  tell the seller in the confirmation.
- Admin bumps are free by design (bumpCost applies to seller-texted BUMPs).

## Open questions / next session

- **#1 launch blocker: the external cron pinger (LAUNCH §A5).** The noon slot
  passed with no digest — expected, nothing calls `/api/cron/digests` (Vercel
  Hobby crons are daily-only). cron-job.org / UptimeRobot GET every 5 min with
  `Authorization: Bearer <CRON_SECRET>`. This also populates the public site.
- The retry-swallow design trap stands (any throw after `recordInboundOnce`
  permanently eats that message). Real fix: processing-state column +
  idempotent handlers. Offered; not yet requested.
- Delivery receipts are logged but not yet persisted to /admin/messages
  (offered: provider_id on outbound rows + `message.finalized` updates +
  delivered/failed badges; needs a small migration).
- First real picture ad will lazily create the `ad-photos` storage bucket —
  confirm it appears in Supabase → Storage and the photo renders.
- Still pending from LAUNCH: Stripe live keys + test purchase, ADMIN_EMAIL,
  Resend domain verify + real `BUSINESS_ADDRESS`, www-primary + SITE_URL
  alignment, launch-day smoke walk §B (partially done live today: SUBSCRIBE,
  AD NEW, approve/reject, PIC all exercised on real SMS).

## Commits (all `main`)

- `0b77a97` webhook/health observability (rejection reasons, 0011 probe)
- `f51ecff` outbound suppression/failure logging
- `2315f29` health: from-number last-4 echo
- `ff8aa81` /admin/sms-diag + [telnyx-dlr] receipt logging
- `ff9e6a0` MMS re-hosting + Digests tab + bump/edit + visibility
- plus prompt-history/session-log bookkeeping commits throughout
