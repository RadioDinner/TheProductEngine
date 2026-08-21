-- ============================================================
-- 9951 — TEST MODE: label the ads created while it was on (session 021)
--
-- Test mode (admin Settings) sends real ads to a short list of test numbers
-- instead of the subscriber list, so the whole pipeline can be exercised
-- against a real phone. Ads created while it is on are ordinary ads in every
-- respect except two: they go only to the test numbers, and they stay off the
-- public website.
--
-- WHAT ACTUALLY HIDES THEM IS NOT THIS COLUMN. createAd also sets
-- ads.web_listing = false on a test ad, and that is the filter the public site
-- already applies (lib/ads-supabase.ts). So the site is correct with or
-- without this migration -- which is deliberate: hiding a test ad from real
-- visitors must not depend on an operator remembering to paste SQL.
--
-- This column is the LABEL: it is how test ads are found again, badged in
-- /admin/ads, and deleted in a batch when the bench session is over. Until it
-- is pasted, test ads are stored unlabelled (and still hidden), and the
-- function log carries "ads.is_test missing (migration 9951)".
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table ads add column if not exists is_test boolean not null default false;

-- Partial index: test ads are a handful among many, and every query that wants
-- them wants ONLY them (the admin filter, the cleanup delete). Indexing just
-- the true rows keeps it small and leaves the ordinary ad path untouched.
create index if not exists ads_is_test_idx on ads (is_test) where is_test;

comment on column ads.is_test is
  'Created while admin test mode was on (session 021). The ad is hidden from '
  'the public site by web_listing=false, not by this column; this is the label '
  'used to find and clean up test ads afterwards.';

-- ------------------------------------------------------------
-- Cleaning up after a bench session (run by hand when you want it -- this
-- migration deliberately does NOT delete anything on its own):
--
--   select id, created_at, left(body, 60) from ads where is_test order by id;
--   delete from ads where is_test;
--
-- Deleting is safe: a test ad never reached a real subscriber and never
-- appeared on the site. Ad NUMBERS are not reused, so the gap left behind is
-- expected and harmless.
-- ------------------------------------------------------------
