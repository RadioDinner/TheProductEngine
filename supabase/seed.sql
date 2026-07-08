-- ============================================================
-- The Plain Exchange — development seed
-- Fixture sellers + the 20 demo ads the website ships with,
-- plus config defaults, packs, and starter word-filter rows.
-- Dates are relative to the day the seed runs.
-- ============================================================

-- ---------- fixture sellers ----------

insert into users (phone) values
  ('3305550190'), ('3305550171'), ('3305550177'), ('3305550163'),
  ('3305550166'), ('3305550142'), ('3305550104'), ('3305550151'),
  ('3305550182'), ('3305550129'), ('3305550148'), ('3305550124'),
  ('3305550138'), ('3305550186'), ('3305550119'), ('3305550157'),
  ('3305550132'), ('3305550195'), ('3305550116'), ('3305550109'),
  ('3305550187')
on conflict (phone) do nothing;

-- ---------- ads ----------
-- approved_at lands on digest slot times (7:00 / 12:00 / 16:00 / 20:00).

insert into ads (id, user_id, original_body, body, status, approved_at, sold_at)
select v.id, u.id, v.body, v.body, v.status::ad_status,
       date_trunc('day', now()) - (v.days_ago || ' days')::interval + (v.slot_hour || ' hours')::interval,
       case when v.status = 'sold'
            then date_trunc('day', now()) - (v.days_ago || ' days')::interval + (v.slot_hour || ' hours')::interval + interval '1 day'
       end
from (values
  (1042, '3305550190', 'Sweet corn by the dozen or bushel. Ready now at the produce stand, CR 77 south of Berlin. Troyer family.', 'approved', 0, 12),
  (1041, '3305550171', 'Driving horse, $2,800. Standardbred gelding, 9 years, traffic safe and sound. Jonas S., 330-555-0171, Fredericksburg.', 'approved', 0, 7),
  (1040, '3305550177', 'Laying hens, $8 each. Two dozen Rhode Island Reds, laying steady. Katie H., 330-555-0177, New Bedford.', 'approved', 0, 7),
  (1039, '3305550163', 'First cutting hay, $5.50 a bale. About 400 bales, stored dry in the barn. Mervin Y., 330-555-0163, Walnut Creek.', 'approved', 1, 20),
  (1038, '3305550166', 'Puppies to good homes, $50. Australian shepherd cross, ready August 1. Verna M., 330-555-0166, Big Prairie.', 'approved', 1, 20),
  (1037, '3305550142', 'Horse cart for sale, $1,000 OBO. Good shape, new wheel bearings last spring. Leroy P., 330-555-0142, Mt. Hope.', 'approved', 1, 16),
  (1036, '3305550104', 'Canning jars wanted. Quarts and pints, fair price paid. Emma W., 330-555-0104, Sugarcreek.', 'approved', 1, 12),
  (1035, '3305550151', 'Wood cook stove, $850. Pioneer Maid, used four winters, good baker. David M., 330-555-0151, Millersburg.', 'approved', 1, 7),
  (1034, '3305550182', 'Firewood, $70 a cord, split and delivered within 10 miles of Millersburg. Menno S., 330-555-0182.', 'approved', 2, 20),
  (1033, '3305550129', 'Treadle sewing machine, $225. Singer, oiled and sewing well, with attachments. Ada S., 330-555-0129, Charm.', 'approved', 2, 16),
  (1032, '3305550148', 'Pallet forks for skid loader, $425. Heavy built, 48 inch. Aden R., 330-555-0148, Baltic.', 'approved', 2, 12),
  (1031, '3305550124', 'Shop heater, $200. Waste oil, works good, selling because we went to coal. Marcus Y., 330-555-0124, Millersburg.', 'sold', 2, 12),
  (1030, '3305550138', 'Boer cross goats, $150 each. Five wethers, ready end of July. Reuben T., 330-555-0138, Berlin.', 'approved', 2, 7),
  (1029, '3305550186', 'Quilting frame, $120. Oak, full size, folds for storage. Mary K., 330-555-0186, Charm.', 'approved', 3, 20),
  (1028, '3305550119', 'Wheel Horse garden tiller, $340. Rebuilt engine this year, runs strong. Norman B., 330-555-0119, Walnut Creek.', 'approved', 3, 16),
  (1027, '3305550157', 'Maple syrup equipment, $600 for all. 2x6 evaporator pan, buckets, spiles. Andy M., 330-555-0157, Killbuck.', 'approved', 3, 12),
  (1026, '3305550132', 'Bulk food shelving, $75 a section. Six sections, sturdy pine. Lizzie T., 330-555-0132, Berlin.', 'approved', 3, 7),
  (1025, '3305550195', 'Farrowing crates, $90 each. Three available, good condition. Sam H., 330-555-0195, Baltic.', 'approved', 4, 20),
  (1024, '3305550116', 'Buggy harness, $375. Complete set, good leather, fits standard driver. Eli B., 330-555-0116, Mt. Hope.', 'sold', 4, 16),
  (1023, '3305550109', 'Post driver wanted, hydraulic, for 3-point hitch. Call or text Levi W., 330-555-0109, Apple Creek.', 'approved', 4, 7),
  (1022, '3305550187', 'Garden produce cart, $180. Sturdy built, needs paint. Alvin D., 330-555-0187, Winesburg.', 'expired', 36, 12)
) as v(id, phone, body, status, days_ago, slot_hour)
join users u on u.phone = v.phone
on conflict (id) do nothing;

update ads set expires_at = approved_at + interval '30 days' where expires_at is null;

alter table ads alter column id restart with 1043;

-- ---------- photos (seed uses site-relative paths from /public/ads) ----------

insert into ad_photos (ad_id, src, width, height, alt) values
  (1040, '/ads/1040.jpg', 960, 1075, 'Rhode Island Red laying hens'),
  (1039, '/ads/1039.jpg', 640, 480,  'Hay bales in a barn'),
  (1037, '/ads/1037.jpg', 960, 640,  'Two-wheeled horse cart'),
  (1035, '/ads/1035.jpg', 960, 640,  'Wood-fired cook stove'),
  (1033, '/ads/1033.jpg', 960, 660,  'Singer treadle sewing machine'),
  (1030, '/ads/1030.jpg', 960, 720,  'Boer cross goats in a pen')
on conflict do nothing;

-- ---------- config defaults (all admin-tunable) ----------

insert into config (key, value) values
  ('sms_number',              '"3309607170"'),
  ('support_number',          '"3309607170"'),
  ('digest_slots_sms',        '[7, 12, 16, 20]'),
  ('digest_slots_email',      '[7, 16]'),
  ('digest_ad_cap',           '10'),
  ('credit_cost_text',        '1'),
  ('credit_cost_photo',       '5'),
  ('bump_cost',               '0'),
  ('max_queued_bumps_per_ad', '1'),
  ('starter_free_ads',        '3'),
  ('ad_expiry_days',          '30'),
  ('ad_max_chars',            '250'),
  ('offense_ban_threshold',   '3'),
  ('sms_replies_per_hour',    '20'),
  ('sms_pics_per_hour',       '12'),
  ('sms_global_per_hour',     '500'),
  ('digest_daily_segment_budget', '12000'),
  ('pic_abuse_per_day',        '15')
on conflict (key) do nothing;

-- ---------- credit packs ----------

insert into packs (id, credits, price_cents, active, position) values
  ('pack5',  5,  500,  true, 1),
  ('pack10', 10, 900,  true, 2),
  ('pack25', 25, 2000, true, 3)
on conflict (id) do nothing;

-- ---------- starter word filter (flag-for-review; auto_reject stays false) ----------

insert into word_filter (word, auto_reject) values
  ('gun', false),
  ('firearm', false),
  ('rifle', false),
  ('whiskey', false),
  ('tobacco', false)
on conflict (word) do nothing;
