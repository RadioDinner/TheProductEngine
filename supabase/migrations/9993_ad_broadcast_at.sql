-- ============================================================
-- The Plain Exchange — mark broadcast ads with a column
--
-- The digest builder needs "approved ads that have never ridden a new-ad
-- slot." The Supabase query did this by fetching the cap*3 OLDEST approved
-- ads and filtering client-side — but Supabase mode never expires approved
-- ads (only the dev file store sweeps), so already-broadcast-but-unexpired
-- ads pile up, fill the oldest-N window, and NEW paid ads silently never
-- enter a digest. A broadcast_at column makes the "never broadcast" queue an
-- O(cap) indexed lookup that can't be starved. Re-runnable.
-- ============================================================

alter table ads add column if not exists broadcast_at timestamptz;

comment on column ads.broadcast_at is
  'When the ad first went out in a new-ad digest slot; null = still queued for its included broadcast. Set by finalizeDigest.';

-- Backfill: any ad that already appeared as a new item in a digest.
update ads
   set broadcast_at = coalesce(approved_at, created_at)
 where broadcast_at is null
   and exists (
     select 1 from digest_items di
      where di.ad_id = ads.id and di.kind = 'new'
   );

-- The exact predicate getNewDigestAds scans (ordered by approval).
create index if not exists ads_new_broadcast_idx
  on ads (approved_at)
  where status = 'approved' and broadcast_at is null;
