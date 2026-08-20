-- ============================================================
-- The Plain Exchange — first-party analytics upgrade
--
-- ⚠️ USER MUST PASTE THIS into the Supabase SQL Editor. Never `supabase db
-- push` — the CLI applies in ascending order, which under this repo's
-- DESCENDING scheme (new_session_instructions.md §4) is newest-first.
--
-- Numbered 9961 because 9962 was the lowest when it was moved. It was staged
-- unnumbered on purpose: 9963-9966 were claimed by other sessions the same day
-- this was written, so a number picked in advance would have collided.
--
-- Re-runnable: every statement is create-if-not-exists or create-or-replace,
-- so pasting it twice is harmless.
--
-- Until it is pasted, lib/analytics.ts falls back to the original
-- bump_page_view and nothing breaks — the extra columns simply are not
-- collected.
--
-- ────────────────────────────────────────────────────────────
-- WHY THIS EXISTS ALONGSIDE GOOGLE ANALYTICS
-- ────────────────────────────────────────────────────────────
-- Google Analytics cannot see a visitor with JavaScript off, and on this site
-- that is not a rounding error — it is a meaningful share of the people the
-- service is built for. It also cannot be asked "how many people came from the
-- flyer we mailed in March" two years from now, because the property's data
-- retention tops out at 14 months and the raw hits are gone.
--
-- This keeps the same three questions answerable from our own database,
-- forever, with no third party involved and no cookies:
--
--   1. How many visits, and how many DIFFERENT people?
--   2. Where did they come from — a referrer, a campaign, or nowhere?
--   3. Which pages?
--
-- The existing page_views table and bump_page_view()/visit_stats() are left
-- exactly as they are. /admin still reads them, nothing regresses, and this
-- adds a second, richer counter beside them.
--
-- PRIVACY: no IP address, no user agent, and no cross-day identifier is
-- stored. The visitor token is a salted hash that INCLUDES the calendar day
-- (analytics/src/ids.ts dailyVisitorHash), so it cannot follow anyone from one
-- day to the next even by us, even later, even on purpose. That is what makes
-- "we do not track you around the internet" on /privacy remain true.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Day-bucketed views, now with where they came from.
-- ────────────────────────────────────────────────────────────
-- One row per (day, path, source). Rows grow with distinct campaigns, not with
-- traffic, so this stays small for years.
create table if not exists visit_days (
  day date not null,
  path text not null,
  -- Referring HOST only ("facebook.com"), never the full URL: full referrers
  -- carry search terms and, from some sites, identifiers.
  ref_host text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  count integer not null default 0,
  primary key (day, path, ref_host, utm_source, utm_medium, utm_campaign)
);

alter table visit_days enable row level security;

-- ────────────────────────────────────────────────────────────
-- 2. How many DIFFERENT people, without knowing who any of them are.
-- ────────────────────────────────────────────────────────────
-- One row per (day, token). The token is a daily-salted hash; count(*) for a
-- day is the unique-visitor figure. Deliberately NOT joined to visit_days —
-- keeping them apart is what stops this becoming a per-person browsing history.
create table if not exists visit_uniques (
  day date not null,
  visitor_hash text not null,
  primary key (day, visitor_hash)
);

alter table visit_uniques enable row level security;

create index if not exists visit_uniques_day_idx on visit_uniques (day);

-- ────────────────────────────────────────────────────────────
-- 3. One atomic call per page view.
-- ────────────────────────────────────────────────────────────
-- Bumps the legacy counter, the new day/source counter and the unique token in
-- one round trip. Read-modify-write across serverless invocations races; every
-- write here is an upsert, so concurrent requests cannot lose a count.
--
-- Empty strings rather than nulls for the source columns: null never equals
-- null in a unique index, so nullable columns in the primary key would create
-- a brand-new row per view and the table would grow with traffic instead of
-- with campaigns.
create or replace function bump_visit(
  p_day date,
  p_path text,
  p_ref_host text default '',
  p_utm_source text default '',
  p_utm_medium text default '',
  p_utm_campaign text default '',
  p_visitor_hash text default ''
)
returns void
language plpgsql
as $$
begin
  -- Keep the original counter fed so /admin's existing figures never regress.
  insert into page_views (day, path, count)
  values (p_day, p_path, 1)
  on conflict (day, path) do update set count = page_views.count + 1;

  insert into visit_days (day, path, ref_host, utm_source, utm_medium, utm_campaign, count)
  values (
    p_day,
    p_path,
    coalesce(left(p_ref_host, 120), ''),
    coalesce(left(p_utm_source, 60), ''),
    coalesce(left(p_utm_medium, 60), ''),
    coalesce(left(p_utm_campaign, 60), ''),
    1
  )
  on conflict (day, path, ref_host, utm_source, utm_medium, utm_campaign)
  do update set count = visit_days.count + 1;

  if p_visitor_hash is not null and p_visitor_hash <> '' then
    insert into visit_uniques (day, visitor_hash)
    values (p_day, p_visitor_hash)
    on conflict do nothing;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. The numbers, in one round trip.
-- ────────────────────────────────────────────────────────────
-- Superset of visit_stats(): the same three view totals plus unique people.
-- The old function stays for callers that have not moved.
create or replace function visit_stats_v2()
returns table (
  today bigint,
  last7 bigint,
  total bigint,
  people_today bigint,
  people_last7 bigint
)
language sql
as $$
  with d as (select (now() at time zone 'America/New_York')::date as today)
  select
    (select coalesce(sum(count), 0) from page_views, d where page_views.day = d.today),
    (select coalesce(sum(count), 0) from page_views, d where page_views.day >= d.today - 6),
    (select coalesce(sum(count), 0) from page_views),
    (select count(*) from visit_uniques, d where visit_uniques.day = d.today),
    (select count(distinct visitor_hash) from visit_uniques, d where visit_uniques.day >= d.today - 6);
$$;

-- Where people came from, over a window. '' is direct/unknown — shown as its
-- own line rather than hidden, because "most of our traffic is direct" is
-- itself the finding when you are handing out printed cards.
create or replace function visit_sources(p_days integer default 30)
returns table (
  ref_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  views bigint
)
language sql
as $$
  with d as (select (now() at time zone 'America/New_York')::date as today)
  select
    v.ref_host, v.utm_source, v.utm_medium, v.utm_campaign, sum(v.count)::bigint as views
  from visit_days v, d
  where v.day >= d.today - (p_days - 1)
  group by 1, 2, 3, 4
  order by views desc
  limit 100;
$$;

-- Most-visited pages over a window.
create or replace function visit_paths(p_days integer default 30)
returns table (path text, views bigint)
language sql
as $$
  with d as (select (now() at time zone 'America/New_York')::date as today)
  select v.path, sum(v.count)::bigint as views
  from visit_days v, d
  where v.day >= d.today - (p_days - 1)
  group by 1
  order by views desc
  limit 100;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Housekeeping.
-- ────────────────────────────────────────────────────────────
-- visit_uniques is the only table here that grows with traffic. The aggregate
-- counts in visit_days are what you keep forever; the per-day tokens are only
-- needed until the day is counted. 400 days keeps a full year-over-year
-- comparison and then lets go.
create or replace function prune_visit_uniques(p_keep_days integer default 400)
returns integer
language plpgsql
as $$
declare
  removed integer;
begin
  delete from visit_uniques
  where day < ((now() at time zone 'America/New_York')::date - p_keep_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ============================================================
-- After pasting, this should return five zeros on a fresh install and real
-- numbers once the app is wired:
--   select * from visit_stats_v2();
-- ============================================================
