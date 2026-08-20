-- ============================================================
-- The Plain Exchange — a member's name, learned from a form (session 018)
--
-- ⚠️ USER MUST PASTE THIS into the Supabase SQL Editor. Never `supabase db
-- push` — the CLI applies in ascending order, which under this repo's
-- DESCENDING scheme (new_session_instructions.md §4) is newest-first.
--
-- Re-runnable: add-column-if-not-exists only.
--
-- ────────────────────────────────────────────────────────────
-- WHY
-- ────────────────────────────────────────────────────────────
-- This service has never asked anyone their name. You sign up by texting
-- SUBSCRIBE, and a phone number is the whole identity — deliberately, because
-- the shortest possible signup is the point.
--
-- But the two feedback forms now require a name (session 018), so people are
-- telling us anyway. The user's instruction: "if they ever fill out a 'submit
-- an idea' or 'I need help' form, save their names to their user account."
-- After that, an operator working a report sees a person rather than ten
-- digits, and the forms stop asking a member the same question twice.
--
-- FILL-ONLY, enforced in the UPDATE itself (`is null` guards in
-- setMemberNameIfEmpty, lib/store-supabase.ts): a name already on an account
-- is never replaced. Both forms are open to anyone, so a typed phone number
-- is a CLAIM about identity, not proof of it — first-writer-wins means the
-- worst case is a wrong name on a record instead of somebody relabelling a
-- stranger's account, and it keeps an operator's correction from being undone
-- by the next form that household fills in. A form NEVER creates an account.
--
-- UNTIL THIS IS PASTED: the forms work exactly as they do now and the name
-- rides the operator's email; it simply isn't stored (the write detects the
-- missing column, logs once, and returns false). No account read depends on
-- these columns — they are fetched lazily, like auto_topup before 9973, so a
-- missing column can never take the site down. /api/health → `migration9958`.
-- ============================================================

alter table users add column if not exists first_name text;
alter table users add column if not exists last_name text;

comment on column users.first_name is
  'Learned from a feedback form the member filled in (session 018). Fill-only: never overwritten once set. Not collected at signup — a phone number is still the identity.';
