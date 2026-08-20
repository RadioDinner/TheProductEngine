-- 9956 — featured / premium listings: four rolling slots and a fair queue
--        (session 019, user rules)
--
-- WHY
-- ---
-- Featured spots were operator-posted only, with no price, no dates and no way
-- for a business to ask for one. The user set both the shape and the price:
-- "up to 4 sponsored listings or premium business listings per month. Two
-- stacked on each side", at $199 for a 30-day run, and asked for a request
-- page that HONORS a queue rather than just describing one.
--
-- The scheduling rule is a rolling 30 days per run, NOT a shared calendar
-- month, so the four runs drift apart and the next opening is whenever the
-- earliest-ending run ends. The user's own example: four approved on 8-17,
-- 8-20, 8-24 and 8-30 means the fifth applicant starts on 9-16. The
-- arithmetic lives in lib/featured-schedule.ts and is unit-tested against that
-- example; this migration is only the storage it reads.
--
-- WHAT
-- ----
-- 1. featured_spots gains its run dates and grows from 2 slots to 4.
--    start_day / end_day are ET CALENDAR DAYS, not timestamps: a run that
--    starts on the 17th starts on the 17th wherever the server happens to be,
--    and "expires in 30 days" has to mean the same thing to the operator and
--    the business paying for it.
--    Both stay NULL for the spots already in the table — those are the
--    operator's own house ads, which run until he takes them down, and
--    lib/featured-store.ts treats a null start as "always on".
--
-- 2. featured_requests is the queue. Order is by submitted_at, so "the first
--    one submitted will get the 4th spot" is a fact about the data rather than
--    a promise about the operator's attention.
--
-- RE-RUNNABLE: every statement is if-not-exists or a drop-then-create.
--
-- AMENDED the same session to add featured_requests.image_src (self-service
-- artwork upload). If you already pasted an earlier copy of this file, paste
-- it again — the alter at the bottom adds the column and everything else
-- no-ops.

-- ---------- 1. run dates + four slots ----------

alter table featured_spots add column if not exists start_day date;
alter table featured_spots add column if not exists end_day date;

-- The old constraint allowed slots 1-2 only. Four now: 1-2 stack on the left
-- of the homepage, 3-4 on the right.
alter table featured_spots drop constraint if exists featured_spots_slot_check;
alter table featured_spots add constraint featured_spots_slot_check check (slot between 1 and 4);

comment on column featured_spots.start_day is
  'ET calendar day this run starts showing. NULL = an operator house ad with no schedule (always on while active).';
comment on column featured_spots.end_day is
  'ET calendar day the run ENDS — the slot is free again ON this day, so start + 30 days means a run beginning 8-17 hands its slot over on 9-16.';

create index if not exists featured_spots_run_idx on featured_spots (start_day, end_day);

-- ---------- 2. the request queue ----------

create table if not exists featured_requests (
  id bigint generated always as identity primary key,
  -- 'featured_ad' = a seller wants one of their own ads featured;
  -- 'business'    = a premium business listing that links out.
  kind text not null default 'business' check (kind in ('featured_ad', 'business')),
  business_name text not null,
  contact_name text,
  phone text,
  email text,
  -- Where the spot goes when someone clicks it: an external URL they choose,
  -- or one of their own ads (ad_id) which opens that ad's page.
  link_url text,
  ad_id bigint references ads (id),
  note text,
  -- The artwork, uploaded on the request page itself (session 019 follow-up:
  -- "Make a self service for the images"). Re-hosted in our own bucket like
  -- every other picture, never a hotlink to somewhere that can change under us.
  image_src text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- The queue order. Whoever asked first is scheduled first, full stop.
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  -- Set on approval, from lib/featured-schedule.ts — the first day a slot is
  -- genuinely free, which may be weeks out.
  scheduled_start_day date,
  spot_id bigint references featured_spots (id) on delete set null,
  price_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists featured_requests_queue_idx
  on featured_requests (status, submitted_at, id);

comment on table featured_requests is
  'Requests for a featured ad or premium business listing. Ordered by submitted_at: the queue is the data, not the operator''s memory. See lib/featured-schedule.ts for the rolling-30-day slot arithmetic.';

alter table featured_requests enable row level security;

-- Added after the first version of this file (self-service image upload), so
-- it is a separate alter rather than only a column in the create above: an
-- already-pasted table needs it too.
alter table featured_requests add column if not exists image_src text;
