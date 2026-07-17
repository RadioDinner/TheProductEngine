-- ============================================================
-- 9987 — admin ad deletion (session 008)
--
-- Ads are SOFT-deleted: status flips to the new 'deleted' enum value, so
-- every positive status filter (public site, digest selection, My Ads,
-- PIC/STATUS/SOLD/BUMP) excludes them naturally, while digest_items — a
-- RESTRICT foreign key that IS the broadcast history — and the message
-- audit log keep the ad number intact. deleted_at records when. The app
-- removes ad_photos rows and their storage objects at delete time.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter type ad_status add value if not exists 'deleted';

alter table ads add column if not exists deleted_at timestamptz;
