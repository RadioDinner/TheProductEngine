-- 9974: combined-photo confirmation (FEATURES item 33).
--
-- After a multi-picture ad's pictures settle (10 quiet minutes since the last
-- one arrived), the seller is texted the finished collage once, so they see
-- exactly the picture buyers will get. The cron (/api/cron/digests, every
-- 5 minutes) finds due ads and claims them by compare-and-set on
-- ads.collage_notified_at; a picture arriving AFTER a send makes the stored
-- stamp older than the newest ad_photos.created_at again, which re-arms one
-- more send after the next quiet period.
--
-- Re-runnable (hand-pasted into the Supabase SQL Editor, never db push).

alter table ads add column if not exists collage_notified_at timestamptz;

comment on column ads.collage_notified_at is
  'When the seller was last texted the combined collage photo (item 33). '
  'Null = never sent; older than the newest ad_photos.created_at = a re-send '
  'is due after the next 10-minute quiet period.';

-- When each picture row landed — drives the quiet-period clock. Pre-existing
-- rows default to the paste time, which only matters for ads still inside the
-- cron's 24-hour lookback (they get one confirmation shortly after the paste;
-- older ads are never considered).
alter table ad_photos add column if not exists created_at timestamptz not null default now();

comment on column ad_photos.created_at is
  'When this picture row was added (default now(); backfilled to the 9974 '
  'paste time). The combined-photo confirmation waits for 10 quiet minutes '
  'past the newest of these before texting the seller the collage.';
