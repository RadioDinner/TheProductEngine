-- ============================================================
-- 9977 — Town hall events board + Featured sidebar spots
--        (FEATURES.md items 18 + 19, session 009/010)
--
-- ONE paste covers BOTH homepage sidebars:
--
--   events          — member-submitted upcoming events (item 18 v1). Free to
--                     list; every submission waits for admin review exactly
--                     like an ad (approve/decline on /admin). Approved events
--                     show on the homepage right sidebar and /town-hall until
--                     their date passes, then drop off automatically — rows
--                     are kept (nothing deletes them), display just filters
--                     by date. The paid SMS/email event blast is PHASE 2
--                     (pricing unconfirmed) and has no schema here.
--
--   featured_spots  — operator-posted image ads for the homepage left
--                     sidebar (item 19). Two slots stacked; each slot
--                     rotates through up to 3 spots (display caps at 3 —
--                     no hard cap here). Images are re-hosted into our
--                     bucket like every other picture; link_url is the
--                     operator-only exception to the no-links rule.
--
-- Re-runnable, per repo convention (hand-pasted into the Supabase SQL
-- editor). RLS on with no policies: service-role access only, like every
-- other table.
-- ============================================================

create table if not exists events (
  id bigint generated always as identity primary key,
  owner_phone text not null,   -- app-canonical 10-digit form (lib/phone)
  title text not null,
  event_date date not null,    -- ET calendar day; drops off display after it
  time_text text,              -- free text ("6:30 pm supper"), optional
  place_text text,             -- free text, optional
  body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now()
);

-- The two hot reads: upcoming approved (homepage + /town-hall) and pending
-- (admin review queue) — both are (status, date-ordered) scans.
create index if not exists events_status_date_idx on events (status, event_date, id);

create table if not exists featured_spots (
  id bigint generated always as identity primary key,
  slot smallint not null check (slot in (1, 2)),
  position smallint not null check (position between 1 and 3),
  src text not null,           -- re-hosted image URL (our ad-photos bucket)
  caption text,
  link_url text,               -- optional EXTERNAL link (operator-only exception)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists featured_spots_slot_idx on featured_spots (slot, position, id);

alter table events enable row level security;
alter table featured_spots enable row level security;
