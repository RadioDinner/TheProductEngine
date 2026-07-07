# Session 002 — 2026-07-07

## What shipped

- **CLAUDE.md created at repo root.** The user asked to confirm that
  `new_session_instructions.md` is honored on every new session. Finding: the
  instructions file was in the repo, but the `CLAUDE.md` it says loads it did
  **not exist** (only the gitignored `.claude/` tooling dir did), so fresh
  sessions never auto-loaded it. CLAUDE.md now points to
  `new_session_instructions.md` + `HANDOFF.md`, which Claude Code auto-loads
  at session start.
- **`lib/admin.ts`: `isAdminPhone` now normalizes ADMIN_PHONES entries via
  `normalizePhone`.** Previously it only stripped punctuation, so
  `ADMIN_PHONES=+13305550142` produced `13305550142` (11 digits) which never
  matched the 10-digit session phone → signed-in admin got the deliberate 404.
- Session folder `002_2026-07-07/` with live `prompt_history.txt`.
- HANDOFF.md updated to the new deployment state.

## Vercel ENOENT root cause (resolved without a code change)

`mkdir '/var/task/.data'` 500s on `/`, `/ad/*`, `/api/cron/digests` meant the
app was running the **file-store fallback in production**: `supabaseConfigured`
was false because `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` weren't reaching
the runtime, and Vercel's lambda filesystem is read-only. Mid-session the user
reported the site loads — a redeploy after the env-var fix picked them up.
(Env edits never apply to an existing deployment; they need a new deploy.)

## Open questions / next step

- **Admin login on production** — exact symptom not yet pinned down (error
  page vs 404 vs code not accepted). Triage order:
  1. `GET /api/health` — check `ADMIN_PHONES: true`, key kind, DB round-trip.
  2. If signed in but `/admin` 404s → ADMIN_PHONES missing/mismatched (the
     normalizePhone fix on this branch removes the +1 formatting trap; it's
     not deployed until merged to main).
  3. Production DB has no accounts — first login walks phone → 6-digit code →
     set-password. With no TELNYX_API_KEY the code is echoed on-screen.
  4. If a server error page appears after entering the phone: check whether
     TELNYX_API_KEY is set to a junk/placeholder value (real-send path would
     throw).
- **Domain**: point theplainexchange.com (Namecheap) at the Vercel project
  (A @ → 76.76.21.21, CNAME www → cname.vercel-dns.com, or move nameservers
  to Vercel DNS), set primary domain, update `SITE_URL`, redeploy. Autodeploy
  to the domain is automatic once the domain is attached — main already
  deploys to production on every push.
- Still unknown whether `seed.sql` ran (config/packs/word-filter); a
  config-only production seed remains to be offered (see HANDOFF).

## Prevalent notes

- This sandbox cannot reach *.vercel.app (egress proxy 403), so live checks
  of /api/health must be done by the user.
- The Supabase dashboard's recurring `42P01 relation
  "supabase_migrations.schema_migrations" does not exist` log line is benign:
  the dashboard probes for CLI migration history, and this project applies
  migrations by hand in the SQL editor.
