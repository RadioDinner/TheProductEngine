-- ============================================================
-- 9984 — confirmed buyer/seller ratings (FEATURES.md item 2, session 008)
--
-- Only CONFIRMED parties can rate: after SOLD, the seller is asked for the
-- buyer's phone number; that answer records the sale (sales), and each side
-- is then invited to RATE 1–5 the other (ratings — one rating per person
-- per ad, both directions). sms_contexts is the short-lived conversation
-- state that makes the SOLD → buyer-phone → RATE exchange possible in an
-- otherwise stateless command engine.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

create table if not exists sms_contexts (
  phone text primary key,
  kind text not null check (kind in ('buyer_phone', 'rate')),
  ad_id bigint not null references ads (id) on delete cascade,
  other_phone text,
  rated_role text check (rated_role in ('buyer', 'seller')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  ad_id bigint primary key references ads (id) on delete cascade,
  seller_user_id uuid not null references users (id),
  buyer_user_id uuid not null references users (id),
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  id bigint generated always as identity primary key,
  ad_id bigint not null references ads (id) on delete cascade,
  rater_user_id uuid not null references users (id),
  rated_user_id uuid not null references users (id),
  rated_role text not null check (rated_role in ('buyer', 'seller')),
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

create unique index if not exists ratings_once_per_ad_rater on ratings (ad_id, rater_user_id);
create index if not exists ratings_rated_idx on ratings (rated_user_id);

alter table sms_contexts enable row level security;
alter table sales enable row level security;
alter table ratings enable row level security;
