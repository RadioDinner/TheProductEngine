-- ============================================================
-- The Plain Exchange — abuse & money-race hardening
-- Atomic SMS-reply reservation (closes the read-then-send rate-limit race)
-- and atomic credit spend (closes concurrent overspend). Re-runnable.
-- RLS on, no policies — service role only, like every other table.
-- ============================================================

-- ---------- SMS reply reservation ledger ----------
-- One row per command reply the engine is about to send. The reserve_sms()
-- function counts + inserts under an advisory lock so a burst of concurrent
-- inbound messages can't all pass the cap before any of them count. Digest
-- broadcasts never touch this table, so they stay exempt.

create table if not exists sms_reservation (
  id bigint generated always as identity primary key,
  address text not null,
  kind text not null default 'reply',   -- 'reply' | 'pic'
  created_at timestamptz not null default now()
);

create index if not exists sms_reservation_created_idx on sms_reservation (created_at);
create index if not exists sms_reservation_addr_idx on sms_reservation (address, created_at);

alter table sms_reservation enable row level security;

create or replace function reserve_sms(
  p_address text,
  p_kind text,
  p_per_number int,
  p_global int,
  p_per_number_pic int,
  p_window_s int
) returns boolean
language plpgsql
as $$
declare
  v_since timestamptz := now() - make_interval(secs => p_window_s);
  v_num int;
  v_global int;
  v_pic int;
begin
  -- Serialize the count-then-insert so the cap is atomic, not best-effort.
  perform pg_advisory_xact_lock(hashtext('sms_reserve'));

  select count(*) into v_global from sms_reservation where created_at >= v_since;
  if v_global >= p_global then return false; end if;

  select count(*) into v_num
    from sms_reservation where address = p_address and created_at >= v_since;
  if v_num >= p_per_number then return false; end if;

  if p_kind = 'pic' then
    select count(*) into v_pic
      from sms_reservation
      where address = p_address and kind = 'pic' and created_at >= v_since;
    if v_pic >= p_per_number_pic then return false; end if;
  end if;

  insert into sms_reservation (address, kind) values (p_address, p_kind);

  -- Opportunistic prune of rows too old to be counted.
  if random() < 0.02 then
    delete from sms_reservation where created_at < now() - interval '2 hours';
  end if;

  return true;
end;
$$;

-- ---------- atomic credit spend ----------
-- Debits credits only if the balance covers it, serialized per user, so two
-- concurrent AD NEW submissions can't both spend the same credit or drive the
-- balance negative.

-- ---------- inbound idempotency ----------
-- A unique provider id makes inbound dedup race-safe: a concurrent Telnyx
-- retry that slips past the app-level SELECT check fails the INSERT (23505),
-- so an AD NEW can't be double-posted / double-charged. Partial (only rows
-- that carry a provider id) so outbound / dev rows are unaffected.

create unique index if not exists messages_provider_id_uniq
  on messages (provider_id)
  where provider_id is not null;

create or replace function spend_credits(
  p_phone text,
  p_amount int,
  p_kind text,
  p_note text
) returns boolean
language plpgsql
as $$
declare
  v_user uuid;
  v_balance int;
begin
  select id into v_user from users where phone = p_phone;
  if v_user is null then return false; end if;

  perform pg_advisory_xact_lock(hashtext('credit:' || v_user::text));

  select coalesce(sum(delta), 0) into v_balance
    from credit_ledger where user_id = v_user;
  if v_balance < p_amount then return false; end if;

  insert into credit_ledger (user_id, delta, kind, note)
    values (v_user, -p_amount, p_kind, p_note);
  return true;
end;
$$;
