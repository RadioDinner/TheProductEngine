# New session instructions

Standing orders from the user. These are loaded at the start of every session
via `CLAUDE.md` and govern how I work on this repo. The user may update this
file at any time; treat it as a living contract.

## 1. Session log folder

At the start of every new session, create a numbered folder under `Session log/`
at the repo root:

```
Session log/
├── 001_<YYYY-MM-DD>/
├── 002_<YYYY-MM-DD>/
└── 003_<YYYY-MM-DD>/
```

- Numbers are zero-padded to 3 digits and auto-increment from the highest
  existing folder (next after `003_*` is `004_*`).
- The date suffix is the session start date in `YYYY-MM-DD` (the user's local
  date, per `CLAUDE.md` / system context).
- If a session starts and a folder for today already exists, append a letter
  suffix (`001_2026-05-29b`) — do not silently overwrite.

## 2. Prompt history (every session, always)

Inside the current session folder, maintain a file named `prompt_history.txt`.

- Every time the user sends a prompt, append it to this file verbatim,
  preceded by a separator line and a timestamp:

  ```
  --- 2026-05-29 14:32 ---
  <full user prompt, unedited>
  ```

- This is non-negotiable: log *every* prompt, including small follow-ups,
  clarifications, single-word replies, and AskUserQuestion answers.
- The file is committed at session end (or sooner if other commits are pushed
  in the meantime). Do not let it drift out of git.

## 3. End-of-session log

Before the session ends, write `session_log.md` inside the current session
folder. It captures:

- **What shipped**: commits made this session (hashes + one-line summaries).
- **Directional decisions**: anything the user and I discussed and decided,
  even if no code changed (e.g. "we chose stacked-below-graph over side-by-side
  for table layout").
- **Open questions / next step**: what should the next session pick up.
- **Anything prevalent to the project** that future-me should know.

This is the per-session log. `HANDOFF.md` at repo root remains the live
project-wide cross-session state document — keep updating it too.

## 4. Supabase migrations: descending numbering

When writing new migrations under `supabase/migrations/`, number them in
**descending** order so the newest sorts to the top of the folder.

- Existing convention starts at `9999_init.sql` and counts down (`9998_*`,
  `9997_*`, `9996_*`, …). The lowest-numbered file is always the most recent.
- Keep using this 4-digit pattern in this repo to stay consistent with the
  existing files. The user's general rule ("999_x, 998_y, …") and this 9999
  pattern are the same idea, just zero-padded differently — preserve the
  existing zero-padding here.
- Migrations are pasted into the Supabase SQL Editor by hand, not applied via
  `supabase db push`, so make every new migration **re-runnable**
  (`drop ... if exists` before `create policy`, triggers, etc.).

## 5. CoachAccountable API: source of truth

**`docs/coachaccountable-api.md` is THE ONLY SOURCE OF TRUTH for the
CoachAccountable API.** It is a copy of the official CA API docs.

- Whenever writing code that talks to the CA API — endpoints, parameter
  names, return shapes, rate limits, response envelope (`status` / `result` /
  `return` / `error` / `message` / `timezone`) — read from
  `docs/coachaccountable-api.md` and follow it exactly.
- If the existing code (`lib/ca.ts`, `lib/sync.ts`, etc.) disagrees with the
  docs, the docs win. Flag the code as the thing to fix.
- Never override or contradict the docs based on training-data memory of
  what the CA API "usually" looks like. Always check the file.
- If something in the docs is ambiguous, ask the user before guessing.

## 6. How the user updates these instructions

The user will occasionally say "update new_session_instructions" with new
rules. When that happens:

- Edit this file directly.
- Commit on the current working branch with a message like
  `Update new_session_instructions: <one-line summary>`.
- Reflect the change in `CLAUDE.md` if it changes default behavior so future
  sessions pick it up at load.
