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

## 6. Version number (user rule, session 016)

The site shows a version number in the website footer. **Bump it at the end
of every session in which anything shipped**, using the user's rule:

- **3 or fewer features shipped** → increment the FAR RIGHT digit.
  `1.0.3` becomes `1.0.4`.
- **4 or more features shipped, or any major change** → increment the SECOND
  digit. `1.0.3` becomes `1.1.3`.
- **The FIRST digit only ever moves when the user says so.** Never bump it on
  your own judgement, however big the change feels.

Notes for whoever applies this:

- The rule as written increments the second digit *without* resetting the
  third (`1.0.3` → `1.1.3`, not `1.1.0`). That is the user's stated example —
  follow it literally rather than "correcting" it to semver habits.
- Count FEATURES, not commits: one feature may take several commits, and a
  bug fix is not a feature. If a session shipped only fixes, leave the version
  alone unless one of them was a major change.
- Say in the session log which digit moved and why, so the count is auditable.

## 7. How the user updates these instructions

The user will occasionally say "update new_session_instructions" with new
rules. When that happens:

- Edit this file directly.
- Commit on the current working branch with a message like
  `Update new_session_instructions: <one-line summary>`.
- Reflect the change in `CLAUDE.md` if it changes default behavior so future
  sessions pick it up at load.

## 8. Working alongside other sessions (added session 021)

The user runs SEVERAL Claude sessions against this repo at once, on purpose, to
move faster. Assume at all times that another session is editing this repo
right now. Two sessions collided on 2026-08-21 (021 and 022) and everything
below is a direct lesson from that.

The important thing to understand: **git does not protect you here.** The
damage is not merge conflicts — those are loud and get fixed. It is the
collisions that merge CLEANLY and leave the repo quietly wrong.

### 8a. Start of every session, in this order

1. **`git fetch origin main` FIRST** — before reading `HANDOFF.md`, before
   claiming a session folder, before anything. Local refs go stale, and a
   force-push leaves them not just behind but on an UNRELATED history (in 021
   the local `main` was 80 commits divergent and `git checkout main` silently
   restored a months-old working tree).
2. **Read `HANDOFF.md` from the freshly fetched `origin/main`,** not from
   whatever the container happens to have.
3. **Claim the session folder against `origin/main`, not local disk.** Both
   sessions on 2026-08-21 picked `021_2026-08-21b` because both looked only at
   their own checkout. Check `git ls-tree origin/main "Session log/"` and take
   the next free number; if the date already exists, add the letter suffix per
   §1.
4. **`npm run check:migrations`** before writing a migration AND again before
   pushing. See 8c.

### 8b. Where this repo collides

The shared single-writer files and counters, in rough order of how often they
bite:

| Thing | Why | What to do |
|---|---|---|
| `HANDOFF.md` | Every session prepends a section at the same spot — 8 of 12 consecutive commits touched it | **KEEP BOTH SIDES**, newest session first. Never drop another session's section to resolve a conflict |
| `Session log/NNN_` | Sequential counter | Claim against `origin/main` (8a.3) |
| Migration number | Descending counter, and **merges cleanly when duplicated** | `npm run check:migrations` |
| `FEATURES.md` item number | Sequential counter | Take the next number after a fetch; if two sessions land the same one, renumber yours in the merge |
| `version` in `lib/config.ts` | Shared counter | Bump from whatever is on `origin/main` **at merge time**, not from what you saw at session start (§6) |

If you know a parallel session is in flight, say so in your `HANDOFF.md`
section and name what you expect to land. Session 022 wrote *"a parallel
session 021 was in flight and lands its own section below when it merges —
keep both"*, and that one sentence made the conflict trivial to resolve
correctly hours later.

### 8c. Migrations are the dangerous one

Two sessions each take `lowest - 1`. The files have different names, so git
merges both without a word, and the repo now holds two different migrations
wearing the same number. Because migrations are pasted **by hand** into the
Supabase SQL editor (§4), a human reading "9950 is applied" cannot tell there
were two — so the second silently never runs and its feature degrades quietly
for weeks.

**`npm run check:migrations`** (`scripts/check-migrations.mjs`) catches it: it
fetches `origin/main`, fails on a duplicate number locally or a number already
claimed remotely by a different filename, and prints the next free number. It
degrades to a local-only check with a loud warning when the network is down.

### 8d. Merging

- **Never `git checkout main` to merge.** Merge `origin/main` INTO your branch,
  verify (`tsc`, `npm test`, `npm run build`) on the merged tree, then push
  `HEAD:main` after confirming it is a fast-forward:
  `git merge-base --is-ancestor origin/main HEAD`.
- **Merge small and often.** A branch that sits all day is a branch that
  collides with everything. Land each piece as soon as it is green.
- **Re-verify after merging**, not just before. The other session's code is new
  to yours, and a clean auto-merge is not a passing test suite.
- Ask the user before pushing to `main` unless they have already said to.

### 8e. Splitting work between sessions

The single biggest win, and it costs nothing: **give each session a disjoint
lane.** Two sessions on `lib/voice.ts` and `app/admin/ads/page.tsx` never
conflict; two sessions both "improving admin" always will. When the user is
about to start a parallel session, help them pick a lane that does not overlap
the one in flight, and say which files this session is holding.
