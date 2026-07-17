-- ============================================================
-- 9986 — USER_ID (FEATURES.md item 0, session 008)
--
-- Every member gets a public 6-digit id (random digits, leading zeros
-- allowed, unique) identifying them beyond phone/email. When an account
-- merge deletes an account, its id is tombstoned in retired_user_ids and
-- may not be reused for a whole year (the app checks the window and reaps
-- expired tombstones lazily).
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table users add column if not exists user_id text;

create unique index if not exists users_user_id_uniq on users (user_id);

alter table users drop constraint if exists users_user_id_format;
alter table users add constraint users_user_id_format
  check (user_id is null or user_id ~ '^[0-9]{6}$');

create table if not exists retired_user_ids (
  user_id text primary key,
  retired_at timestamptz not null default now()
);

alter table retired_user_ids enable row level security;

-- Backfill every existing account. Re-runnable: only NULLs are filled.
do $$
declare
  r record;
  candidate text;
begin
  for r in select id from users where user_id is null loop
    loop
      candidate := lpad(floor(random() * 1000000)::int::text, 6, '0');
      continue when exists (
        select 1 from retired_user_ids t
        where t.user_id = candidate
          and t.retired_at > now() - interval '1 year'
      );
      begin
        update users set user_id = candidate where id = r.id;
        exit;
      exception when unique_violation then
        -- collision with an already-assigned id: draw again
      end;
    end loop;
  end loop;
end $$;
