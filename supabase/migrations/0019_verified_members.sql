-- ============================================================
-- 0019 — verified members (FEATURES.md item 7, session 008)
--
-- The operator manually verifies real, known buyers/sellers and grants the
-- green check from /admin/users. verified_at doubles as the flag and the
-- audit stamp; NULL = not verified. There is no self-serve path by design —
-- verification means a human vouched. Perks for verified members come later;
-- for now the check shows on the ad page (seller), the account page, and in
-- chat.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table users add column if not exists verified_at timestamptz;
