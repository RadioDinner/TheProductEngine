# CLAUDE.md

Standing orders for every session in this repo:

1. Read `new_session_instructions.md` (repo root) FIRST and follow it for the
   whole session. It defines the `Session log/` folder-per-session convention,
   the verbatim `prompt_history.txt` log (every prompt, always), and the
   end-of-session `session_log.md`. It is a living contract — the user updates
   it; treat the file on disk as authoritative.

2. Then read `HANDOFF.md` (repo root) — the live cross-session state document —
   before starting work, and keep it updated as project state changes.

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
