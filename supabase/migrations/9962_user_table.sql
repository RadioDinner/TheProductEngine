-- 9962 — the users table view and saved views (feature 41).
--
-- The user's ask: a spreadsheet-style screen showing every member with as
-- much data as we hold — numbers, emails, status, ads sent, money spent,
-- subscription dates — filterable by column, with columns you can add and
-- drop, and named views you can save.
--
-- WHY A VIEW rather than assembling this in the app: every column below is an
-- aggregate over a different table. Fetching them per member would be a query
-- per member per column — a hundred members would be hundreds of round trips
-- for one screen. As a view it is one query, and because PostgREST can filter,
-- sort and page a view exactly like a table, the filtering happens in the
-- DATABASE rather than by pulling everything and sifting it in the page. This
-- is the admin screen most likely to get slow first; that decision is why it
-- won't.
--
-- Re-runnable.

create or replace view admin_user_rows as
select
  u.id                       as user_id,
  u.phone,
  u.email,
  u.user_id                  as member_id,
  u.created_at               as member_since,
  u.subscribed_at,
  u.email_subscribed_at,
  u.verified_at,
  u.posting_banned_at,
  u.archived_at,
  u.offense_count,
  u.starter_granted_at,
  u.line_type,
  u.pic_balance,
  u.stripe_customer_id is not null as card_on_file,
  u.auto_topup,
  (b.phone is not null)            as blocked,

  -- Ads. Counted from the ad rows themselves rather than a stored tally, so
  -- these can never drift from what the Ads tab shows.
  coalesce(a.ads_posted, 0)  as ads_posted,
  coalesce(a.ads_sold, 0)    as ads_sold,
  coalesce(a.ads_live, 0)    as ads_live,

  -- Money, in CENTS, straight off the append-only ledger — the same source
  -- the member's own balance comes from, so the table and their account page
  -- can never disagree.
  coalesce(l.balance_cents, 0) as balance_cents,
  coalesce(l.spent_cents, 0)   as spent_cents,
  coalesce(l.added_cents, 0)   as added_cents,

  -- Last sign of life from either direction: an ad they posted or a message
  -- either way. Null means they have done nothing at all since signing up.
  greatest(
    coalesce(a.last_ad_at, to_timestamp(0)),
    coalesce(m.last_message_at, to_timestamp(0))
  ) as last_active_at,
  coalesce(m.messages_in, 0) as messages_in

from users u
left join blocked_numbers b on b.phone = u.phone
left join lateral (
  select
    count(*)                                        as ads_posted,
    count(*) filter (where status = 'sold')         as ads_sold,
    count(*) filter (where status = 'approved')     as ads_live,
    max(created_at)                                 as last_ad_at
  from ads where ads.user_id = u.id
) a on true
left join lateral (
  select
    sum(delta)                                              as balance_cents,
    -- Spends are negative deltas; report them as a positive amount spent.
    coalesce(-sum(delta) filter (where kind = 'spend'), 0)  as spent_cents,
    coalesce(sum(delta) filter (where kind = 'purchase'), 0) as added_cents
  from credit_ledger where credit_ledger.user_id = u.id
) l on true
left join lateral (
  select
    count(*) filter (where direction = 'inbound') as messages_in,
    max(created_at)                              as last_message_at
  from messages where messages.user_id = u.id
) m on true;

-- Saved views (feature 41): which columns are showing, in what order, with
-- what filters and sort. Stored as one jsonb blob because the shape is the
-- UI's business and will change as columns are added — a column per setting
-- would mean a migration every time the table grows one.
create table if not exists admin_saved_views (
  id bigint generated always as identity primary key,
  name text not null,
  -- Whose view. The admin phone, so two operators don't overwrite each
  -- other's layouts.
  owner_phone text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_phone, name)
);

create index if not exists admin_saved_views_owner_idx
  on admin_saved_views (owner_phone, name);
