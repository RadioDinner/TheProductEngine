# Session 009 — 2026-07-17

The biggest build session yet: **the entire FEATURES list ran to completion**
(items 9, 11–25 all built; item 10 stays on hold by user decision), plus the
migration renumbering, two competitor-policy audits, and a batch of
site-rules changes — 45+ commits, ~120 files, ~10.5k lines added, everything
on `main` (user instruction: commit to main all session). Work ran as
parallel worktree lanes (one agent per feature cluster), each verified with
unit tests + tsc + `next build` + a scripted Playwright walk before its
merge; a final adversarial review workflow swept the merged result (outcome
in the follow-up commit / HANDOFF).

## What shipped (merge commits; each lane's detail in its commit messages)

- `800f166` **Migrations renumbered to the descending scheme** (user
  decision): `0001`–`0019` → `9999`–`9981` via **new = 10000 − old** (0004
  never existed → 9996 skipped). All 18 were applied to prod BEFORE the
  rename — nothing re-run. Live references updated (health probe keys,
  error tokens, docs); map in `supabase/migrations/README.md`; `supabase
  db push` explicitly retired (CLI would apply descending numbers
  newest-first). **Next migration counts down from the lowest.**
- `4460fa6` **Items 11+12**: signup strip hidden for signed-in members
  (footer compliance stays); header ✉ + red unread badge — `/api/unread`
  polled 60s by the repo's first client component, "(1)" tab-title prefix.
- `cef9e25` **Item 9 — web ad posting**: /account/post mirrors the SMS
  lane's exact pricing sequence (ban gate → stripEmoji → maxChars → word
  rules → starter grant → create-then-charge with benign-reject undo),
  listing picture vs web-only extras, price shown before posting, pending
  state surfaced. `next.config.ts` bodySizeLimit 80mb (Vercel still ~4.5MB).
- `416f788` **Items 13+14+15 — chat rebuild** (migration **9980, APPLIED by
  user this session**): right/left bubbles, report-a-message → /admin Review
  queue, links rejected, EVERY chat message audit-logged (privacy stance
  reversal, documented on /admin/help); pictures in chat (re-hosted, 30/
  thread cap, never rides SMS); send path = one `send_chat` RPC (was ~8
  sequential queries + ILIKE scan), optimistic client thread (~46ms),
  nudge off the critical path, `chat_nudged_at` watermark.
- `a949587` **Item 16 — My ads tab**: sold (optional buyer phone → ratings
  flow), bump (SMS semantics), PIC-picture replacement (review-gated swap),
  extras, self-delete with the user's refund matrix (pending → refund;
  approved-never-broadcast → refund; ever digested → none) — idempotent
  ledger ref `member-delete-refund-ad-{id}`, triple double-refund guard.
- `845ee6b` **Item 23 — metered click-to-reveal** (migration **9979**):
  numbers never render in HTML anywhere (body PII masked too); per-ad Show
  number, 10/day + bank 30 (settings), reveal log, insights excessive-
  reveals flag + one-click block. Chat is the unmetered contact path.
  Pre-paste degrade: button works unmetered, never 500s.
- `c3e7d75` **Item 17 — business advertising** (migration **9978**):
  /advertising with $39.99/wk, $59.99/2wk, $89.99/mo; Stripe self-serve
  (webhook-only storage, stripe_ref idempotency); ads land in review —
  approval starts the clock; digest **Sponsor:** line rides OUTSIDE the
  cap-10 once/day; missed days EXTEND the run (visible in /admin/business);
  decline = manual Stripe refund flagged until marked done.
- `46066e0` **Items 18+19 — Town hall + Featured** (migration **9977**):
  homepage = featured-left / ads-center / townhall-right (grid, collapses
  clean at 375px); Town hall v1 = free events board (/town-hall), same
  review posture, auto-expire after event date, NO blast yet (pricing
  unset); Featured = 2 stacked slots × 3 rotating image ads (8s, pauses on
  hidden tab, reduced-motion → dots), operator-only CRUD on /admin/featured,
  external links rel="sponsored", selling awaits pricing.
- `025dfb9` **Items 22+24+25 — category system** (migration **9976**):
  SUBSCRIBE/START sends the approved 10-word menu; category words + LIST
  toggle with the user's exact confirmation copy; confirmation throttle
  (5/hr then one notice + silent-but-applied); digests compose once per
  DISTINCT category set (ALL byte-identical to before; uncategorized ads
  ride everything; sponsor lines ride all groups); operator categorizes at
  review (web posting offers a seller suggestion); /account checkboxes
  (on-page confirm only, no SMS); homepage ?category= browser row.
- **Policy/site batch**: privacy policy competitor-audit update (`89687e5`),
  terms competitor-audit update (`851b6fd`), accessibility statement +
  refund policy pages + footer links (`dd31d32`, FEATURES 20–21),
  © 2026 line (`9eda990` after user corrected 2028), firearms banned in
  the rules + post form (`0e00931`), support contact = (234) 301-0048
  everywhere with (330) 960-7170 reserved for the ads program (`91a3bf2`).

## Directional decisions (user, this session — recorded in FEATURES notes too)

- Descending migration numbering adopted; next = lowest − 1 (9975 after
  this session's four).
- Item 17: Stripe self-serve now; labeled sponsor line outside the cap-10;
  links allowed after review. Same approval process as ads (also for
  events).
- Item 22/24/25: menu approved verbatim; ONE combined filtered digest;
  operator assigns categories at review; toggle-reply semantics with the
  user's copy; spam guard = reply caps + 5/hr confirmation throttle.
- Item 23 posture: metered click-to-reveal (10/day default) after the user
  spotted the burner-account scraping risk.
- Item 16 refund matrix verbatim ("game over" after any digest).
- Firearms not allowed (stated rules; word-rule flags left to the operator).
- Support number split; © 2026; Town-hall/Featured/event-blast pricing
  deliberately NOT wired (unset).
- Item 10 (mixed SMS+chat) REMAINS on hold — not reopened by "finish
  everything" (user can say otherwise).

## For the user — ops actions now

1. **Paste 4 migrations** (independent, any order): `9979_reveal_quota.sql`,
   `9978_business_packages.sql`, `9977_town_hall_featured.sql`,
   `9976_categories.sql`. Check `/api/health` (CRON_SECRET) shows
   migration9976–9979 applied. Until pasted: reveal is unmetered, business
   purchases refuse, sidebars hide, categories dormant — nothing 500s.
2. Optional: add firearm word-rule flags (gun, rifle, pistol, ammo,
   firearm) on /admin/settings — flag-for-review, not auto-reject.
3. Set prices when ready: Featured slots (item 19 selling), event listing/
   blast (item 18 phase 2).
4. Carried from 008: verify photos@ inbound (Resend) + review-alert emails.

## Adversarial review outcome (post-wrap addendum)

33-agent find→refute sweep over the whole session diff: 27 findings, 25
confirmed, all fixed in `5557007` + `835d45a` (see HANDOFF for the list;
headline: pre-paste degrade guards needed PostgREST schema-cache codes,
Stripe must retry unstorable paid packages, refund paths made crash/race
safe, per-group STOP footers, delivered-only broadcast consumption, empty
category sets truly dark, stranger texts don't mint accounts, GSM sanitize
at the outbound choke point, phone-number masking on town hall + photo
alts). Suite: 391 → **401 checks**. Deferred by choice: chat pictures'
public-bucket storage (top backlog item).

## Open questions / next session
- Hardening backlog (carried + new): retry-swallow inbound trap; Telnyx DLR
  badges; NO web-lane rate limiter (posting/events/reveal actions beyond
  the quota); chat + all images live in the PUBLIC ad-photos bucket
  (unguessable URLs only — flagged to user, private bucket + signed URLs
  offered); abuse-suite pass over the new surfaces (category toggles,
  reveals, web posting, business checkout).
- Phase 2s: event SMS/email blast (price + outbox labeling), Featured
  selling flow, item 10 if ever reopened, HELP/FAQ text doesn't yet mention
  category commands (deliberate scope cut — worth adding).

## Prevalent notes for future sessions

- Worktree-lane merges: append-zone conflicts (test/run.mjs SUITES, health
  probes, admin help/nav) are routine; NEVER blind-union code files — two
  seam bugs (a dropped `</p>`, a dropped `}`) came from exactly that; both
  caught by tsc before push.
- The maps file for this session's surfaces (chat/posting/layout, exact
  file:line) is in the session transcript; FEATURES.md item notes carry
  every product decision and are the spec of record.
- Session prompt history: complete and verbatim in this folder, including
  AskUserQuestion answers.
