-- ============================================================
-- 9948 — the labelled SMS picture, kept instead of thrown away (session 024)
--
-- Since session 018 a picture ad's photo goes out with its ad number burned
-- into the corner ("AD 1024") so a photo arriving on its own can be tied to
-- its line in the batch text and to the PIC command. That labelled copy was
-- made at SEND time and its URL was DISCARDED the moment the outbox rows were
-- built — so nothing outside the subscriber's phone had ever seen it. The
-- operator could not check the label before a batch went out, could not see it
-- afterwards, and a failed render degraded silently to the clean original with
-- nothing but a line in the function log to say so.
--
-- These two columns keep it:
--
--   badged_photo      the public URL of the labelled copy (bucket ad-photos,
--                     folder badged/).
--   badged_photo_src  the picture it was rendered FROM.
--
-- The second column is what makes it safe. A seller can replace an ad's
-- position-0 picture (a follow-up MMS onto a text ad, an admin-approved PIC
-- replacement), and a stored label made from the OLD picture would then be a
-- confident lie about what goes out. Every reader compares badged_photo_src
-- against the ad's current first texted picture and treats a mismatch as "no
-- label yet" — so staleness is decided by comparison, never by trusting each
-- writer to have remembered to clear the column.
--
-- DEGRADES CLEANLY WHEN UNPASTED. Reads treat a missing column (42703 /
-- PGRST204) as "this ad has no stored label", which is exactly the pre-9948
-- truth, and the send path then renders the badge on the fly as it always did.
-- So an unpasted 9948 costs the /admin/ads preview and nothing else: ads still
-- post, batches still send, and the pictures still go out labelled.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table ads add column if not exists badged_photo text;
alter table ads add column if not exists badged_photo_src text;

comment on column ads.badged_photo is
  'Public URL of this ad''s SMS picture: its first texted photo with the ad '
  'number burned into the corner (session 018 badge, session 024 persisted). '
  'Send-only content -- never an ad_photos row, so the website and the review '
  'queue keep showing the clean original.';

comment on column ads.badged_photo_src is
  'The photo badged_photo was rendered from. A value different from the ad''s '
  'current first texted picture means the label is STALE and is ignored -- the '
  'picture was replaced after the label was made.';

-- ------------------------------------------------------------
-- Finding ads whose label has not been made yet (they get one when the batch
-- carrying them sends, or from "Label it now" on /admin/ads):
--
--   select a.id
--     from ads a
--     join ad_photos p on p.ad_id = a.id and p.position = 0
--    where a.badged_photo is null
--      and a.status in ('pending', 'approved', 'unpaid')
--    order by a.id;
--
-- Forcing every label to be rebuilt (harmless -- the next read of each ad
-- re-renders and re-stores it; the orphaned storage objects under badged/ are
-- send-only copies and cost only space):
--
--   update ads set badged_photo = null, badged_photo_src = null;
-- ------------------------------------------------------------
