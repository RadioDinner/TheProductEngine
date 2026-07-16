-- 0012_ad_hold.sql
-- Admin digest-queue control (session 007): "skip the next digest" holds an
-- approved ad past the upcoming slot. The digest builder only selects ads
-- whose hold has passed (or was never set).
--
-- Re-runnable: safe to paste into the Supabase SQL editor more than once.
-- ⚠️ Apply BEFORE (or immediately after) the session-007 deploy that reads it:
-- until this column exists, digest composition and /admin/digests error.

alter table ads add column if not exists hold_until timestamptz;
