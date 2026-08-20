-- ============================================================
-- The Plain Exchange — who filed the problem report (session 018)
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
-- "I need help!" (session 016) asked for nothing but the note, and the note
-- was optional on purpose: a stuck member usually cannot describe what went
-- wrong, and the diagnostics describe it for them. That reasoning covered
-- what happened. It did not cover WHO — a signed-out visitor left no way to
-- answer them at all, and a signed-in one left a phone number without a name,
-- which in a household is not the same as knowing who wrote in.
--
-- So the form now requires a first and last name and one of phone/email
-- (user decision), and those four values land here. `phone` (the existing
-- column) is still the SESSION's phone and is still never taken from the
-- form — that distinction is the security boundary and it stays: what a
-- person types about themselves is contact information, not identity.
--
-- UNTIL THIS IS PASTED: reports still file. The store detects the missing
-- columns, logs once, and inserts without them — the operator's email carries
-- the name and number in full either way, so nothing is lost but the copy in
-- the admin list. /api/health reports `migration9959`.
-- ============================================================

alter table help_reports add column if not exists first_name text;
alter table help_reports add column if not exists last_name text;
alter table help_reports add column if not exists contact_phone text;
alter table help_reports add column if not exists contact_email text;

comment on column help_reports.contact_phone is
  'Phone the person TYPED so we can call them back — self-reported, unlike help_reports.phone which is read from their session.';
