-- ============================================================
-- 0017 — profiles + chat (FEATURES.md items 3 & 4, session 008)
--
-- Item 3: members can set a profile picture (public) and a pickup address
-- (PRIVATE — it leaves the account only when the member explicitly shares
-- it into a chat conversation).
--
-- Item 4: on-platform chat between buyers and sellers, keyed on member ids,
-- so nobody's phone number is exposed. One thread per (pair, ad); read
-- state tracked per member; membership is checked on every read/write.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table users add column if not exists profile_photo text;
alter table users add column if not exists pickup_address text;

create table if not exists chats (
  id bigint generated always as identity primary key,
  ad_id bigint references ads (id) on delete set null,  -- conversation context
  a_user_id uuid not null references users (id),
  b_user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- One thread per pair per ad (a/b stored in sorted order by the app).
create unique index if not exists chats_pair_ad_uniq
  on chats (a_user_id, b_user_id, (coalesce(ad_id, 0)));

create index if not exists chats_a_idx on chats (a_user_id, last_message_at desc);
create index if not exists chats_b_idx on chats (b_user_id, last_message_at desc);

create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null references chats (id) on delete cascade,
  from_user_id uuid not null references users (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_chat_idx on chat_messages (chat_id, id);

create table if not exists chat_reads (
  chat_id bigint not null references chats (id) on delete cascade,
  user_id uuid not null references users (id),
  last_read_message_id bigint not null default 0,
  primary key (chat_id, user_id)
);

alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table chat_reads enable row level security;
