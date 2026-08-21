# CLAUDE.md

Standing orders for every session in this repo:

0. **`git fetch origin main` BEFORE READING ANYTHING ELSE.** The user runs
   several Claude sessions against this repo at once, deliberately. Another
   session is probably editing it right now, and local refs go stale — a
   force-push can leave the local `main` on an entirely UNRELATED history.
   Read `HANDOFF.md` and claim a `Session log/` folder against the FRESHLY
   FETCHED `origin/main`, never against whatever the container happens to hold.
   **§8 of `new_session_instructions.md` is the full protocol — read it.**

1. Read `new_session_instructions.md` (repo root) FIRST and follow it for the
   whole session. It defines the `Session log/` folder-per-session convention,
   the verbatim `prompt_history.txt` log (every prompt, always), the
   end-of-session `session_log.md`, and (§8) how to work alongside parallel
   sessions. It is a living contract — the user updates it; treat the file on
   disk as authoritative.

2. Then read `HANDOFF.md` (repo root) — the live cross-session state document —
   before starting work, and keep it updated as project state changes. When it
   conflicts with another session's edit, **keep BOTH sections** (newest
   first); never resolve a HANDOFF conflict by dropping someone else's work.

3. Run **`npm run check:migrations`** before writing a migration and again
   before pushing. Two sessions taking the same descending number produces two
   files that git merges CLEANLY — and since migrations are pasted by hand, the
   second one then silently never runs. That check is the only thing that
   catches it.

As of session 016 the site carries a VERSION NUMBER in the website footer,
and §6 of `new_session_instructions.md` is the rule for bumping it at the end
of any session that shipped work (3 or fewer features → far-right digit; 4+ or
a major change → second digit; the FIRST digit only when the user says so).

Note: this repo has no CoachAccountable code, so §5 of
`new_session_instructions.md` (CA API docs) does not apply here. §4 DOES
apply: as of session 009 (user decision, 2026-07-17) migrations under
`supabase/migrations/` are numbered **descending from `9999_init.sql`** —
the lowest number is the newest; the next migration takes (lowest − 1).
The original ascending files `0001`–`0019` were renamed with
new = 10000 − old; the map lives in `supabase/migrations/README.md`.
Old numbers in `Session log/` and HANDOFF history are frozen — decode via
that map. Migrations are hand-pasted into the Supabase SQL Editor
(never `supabase db push`) and must be written re-runnable.
