-- ============================================================
-- The Plain Exchange — PRODUCTION seed
-- Config defaults, credit packs, and the starter word filter.
-- No demo sellers, no demo ads — this is safe to run on the
-- live database. Re-runnable: every insert is on-conflict-safe.
-- (Full dev seed with demo data lives in seed.sql.)
-- ============================================================

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
  ('digest_daily_segment_budget', '12000')
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
