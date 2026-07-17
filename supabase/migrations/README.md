# Migration numbering — descending from 9999

Per `new_session_instructions.md` §4 (adopted for this repo in session 009,
user decision): migrations are numbered **descending** so the newest file
sorts to the top of the folder. The first migration is `9999_init.sql` and
every later one counts down. **The lowest number is always the most recent;
the next migration takes (lowest existing − 1)** — as of the rename that
means `9980_*.sql` is next.

Two rules that follow from this scheme:

- **Apply order on a fresh database is numerically DESCENDING** (9999 first,
  then 9998, … down to the lowest). A plain ascending directory sort shows
  the files in *reverse* apply order — read from the bottom up.
- **Hand-paste only.** Migrations are pasted into the Supabase SQL Editor
  (each file is re-runnable). Do NOT use `supabase db push`: the CLI applies
  files in ascending version order, which under this scheme would run the
  newest migration first.

## Historical renumbering map (session 009, 2026-07-17)

The repo originally numbered ascending (`0001`–`0019`, all applied to prod
before the rename). Files were renamed with the mechanical rule
**new = 10000 − old**, so any old number in frozen session logs or old
health-check output converts in your head. `0004` never existed, which is
why `9996` is skipped.

| Old | New (current file) |
|-----|--------------------|
| 0001 | `9999_init.sql` |
| 0002 | `9998_analytics.sql` |
| 0003 | `9997_ledger_ref_unique.sql` |
| 0005 | `9995_abuse_hardening.sql` |
| 0006 | `9994_digest_outbox.sql` |
| 0007 | `9993_ad_broadcast_at.sql` |
| 0008 | `9992_blocklist_and_controls.sql` |
| 0009 | `9991_verify_login_code.sql` |
| 0010 | `9990_defer_starter_grant.sql` |
| 0011 | `9989_pic_quota.sql` |
| 0012 | `9988_ad_hold.sql` |
| 0013 | `9987_ad_delete.sql` |
| 0014 | `9986_user_ids.sql` |
| 0015 | `9985_ad_photo_submissions.sql` |
| 0016 | `9984_ratings.sql` |
| 0017 | `9983_profiles_chat.sql` |
| 0018 | `9982_digest_numbers.sql` |
| 0019 | `9981_verified_members.sql` |

The rename changed file names and references only — no SQL content changed,
and nothing needs re-running: all 18 were applied under their old names.
Live references in code/docs (including `/api/health` probe keys, e.g.
`migration0013` → `migration9987`) were updated in the same commit.
`Session log/` and HANDOFF history sections keep the old numbers as
historical record — use the table (or 10000 − old) to decode them.
