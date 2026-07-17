-- ============================================================
-- The Plain Exchange — analytics (page-view counter)
-- Re-runnable: paste into the Supabase SQL editor. RLS on with no
-- policies (service role only), matching 9999_init.sql.
-- ============================================================

-- Day-bucketed page views. One row per (ET day, path); the app
-- increments via bump_page_view(). Tiny: rows = days x public paths.
create table if not exists page_views (
  day date not null,
  path text not null,
  count integer not null default 0,
  primary key (day, path)
);

alter table page_views enable row level security;

-- Atomic increment — avoids a read-modify-write race across serverless
-- invocations.
create or replace function bump_page_view(p_day date, p_path text)
returns void
language sql
as $$
  insert into page_views (day, path, count)
  values (p_day, p_path, 1)
  on conflict (day, path) do update set count = page_views.count + 1;
$$;

-- Today / last 7 days / all-time totals in one round-trip (ET calendar).
create or replace function visit_stats()
returns table (today bigint, last7 bigint, total bigint)
language sql
as $$
  with d as (select (now() at time zone 'America/New_York')::date as today)
  select
    coalesce(sum(count) filter (where page_views.day = d.today), 0),
    coalesce(sum(count) filter (where page_views.day >= d.today - 6), 0),
    coalesce(sum(count), 0)
  from page_views, d;
$$;
