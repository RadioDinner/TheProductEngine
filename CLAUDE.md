# CLAUDE.md

Standing orders for every session in this repo:

1. Read `new_session_instructions.md` (repo root) FIRST and follow it for the
   whole session. It defines the `Session log/` folder-per-session convention,
   the verbatim `prompt_history.txt` log (every prompt, always), and the
   end-of-session `session_log.md`. It is a living contract — the user updates
   it; treat the file on disk as authoritative.

2. Then read `HANDOFF.md` (repo root) — the live cross-session state document —
   before starting work, and keep it updated as project state changes.

Note: sections 4–5 of `new_session_instructions.md` reference another project
(CoachAccountable API docs; migrations numbered descending from `9999_`). This
repo has no CA code and its applied migration is `supabase/migrations/0001_init.sql`
(ascending) — ask the user before adopting those conventions here (see
HANDOFF.md "Repo & etiquette notes").
