-- ============================================================
-- 9976 — the category system (FEATURES.md items 22/24/25, session 009)
--
-- Ads get ONE category (operator-assigned at review; web posting may suggest
-- one); subscribers pick which categories they want by texting a category
-- word (toggle) or with checkboxes on /account. Category keys are stored
-- lowercase: buggies, dogs, garden, horses, household, hunting, livestock,
-- machinery, wanted (lib/categories.ts is the authority).
--
-- Semantics (user decisions, session 009):
--   * ads.category NULL   = uncategorized — rides EVERY digest (pre-migration
--     ads and operator-skipped dropdowns are never silently unsendable).
--   * users.categories NULL = ALL (default/grandfathered: every existing
--     subscriber keeps getting everything without a backfill).
--   * users.categories '{}' = the member removed their last category — they
--     get only uncategorized ads until they reply ALL or a category name
--     (the engine warns them; the state is allowed but never silent).
--
-- Spam/cost guard (item 24): category/LIST confirmations are throttled per
-- number — after N confirmations in an hour (config category_confirms_per_hour,
-- default 5) one "changes still apply" notice goes out and further
-- confirmations are silent for the hour while toggles still apply. The
-- throttle state is a WATERMARK + COUNTER on the user row (the 9980 lesson:
-- never an ILIKE scan of the message log): category_confirm_window_start
-- anchors the hour window at the first confirmation, category_confirm_count
-- counts confirmations inside it.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

-- The ad's one category (lowercase key; null = uncategorized).
alter table ads add column if not exists category text;

-- Homepage /?category=... filter + digest partitioning read this.
create index if not exists ads_category_idx on ads (category);

-- Subscriber category prefs live on the user row (not a join table): every
-- read/write is single-row alongside the account, the digest composer gets
-- them in the same paged subscriber scan, and null-means-ALL grandfathering
-- is automatic. Lowercase keys, canonical sorted order (lib/categories.ts).
alter table users add column if not exists categories text[];

-- Category-confirmation throttle state (see header).
alter table users add column if not exists category_confirm_window_start timestamptz;
alter table users add column if not exists category_confirm_count integer not null default 0;

-- Throttle tunable (admin-editable on /admin/settings; 0 = unthrottled).
-- Default mirrors lib/config.ts engineDefaults.categoryConfirmsPerHour.
insert into config (key, value) values ('category_confirms_per_hour', '5')
on conflict (key) do nothing;
