-- 9969 — the second price sheet (user decision, session 016).
--
-- The first overhaul priced against the PRINT competitor ($65 picture / $45
-- text). A second competitor turned up doing the same thing this service
-- does — classifieds by text — at $15 text / $20 one picture / $30 two-to-
-- three. Being 3x a direct substitute in a community that compares notes is
-- not a position worth holding, so:
--
--     text ad          $20
--     1 picture        $30
--     2 pictures       $40
--     3 pictures       $50   (and three is now the maximum an ad can carry)
--
-- Starter credit drops to $40 and becomes a LAUNCH OFFER: the first 200
-- members to post get it, nobody after. $150-then-$45 was the worst of both
-- worlds — a generous trial ending in a cliff exactly where a free user would
-- have become a paying one.
--
-- Pictures also stop riding the broadcast: an MMS costs ~$0.035 per
-- subscriber, so a $30 picture ad stops breaking even near 850 subscribers.
-- "Reply PIC 12" comes back, and the website carries every picture.
--
-- These keys ALREADY EXIST in prod with the old values, so this migration
-- must UPDATE, not insert-if-absent. Re-runnable either way.

update config set value = '2000' where key = 'ad_price_text_cents';
update config set value = '3000' where key = 'ad_price_photo_cents';
update config set value = '4000' where key = 'starter_credit_cents';

insert into config (key, value) values
  -- Picture prices by count: [1 pic, 2 pics, 3 pics].
  ('ad_price_photo_cents_by_count', '[3000, 4000, 5000]'),
  -- The launch offer's ceiling. 0 = no cap.
  ('starter_credit_limit', '200'),
  -- false = ads say "Reply PIC 12"; true = the photo rides as MMS.
  ('photos_in_broadcast', 'false')
on conflict (key) do nothing;
