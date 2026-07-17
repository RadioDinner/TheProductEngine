-- 9979_reveal_quota.sql
-- Metered click-to-reveal for seller phone numbers (FEATURES item 23,
-- anti-scraping). The website never renders seller numbers in HTML; a
-- signed-in member spends one "number look-up" per ad from a daily allowance
-- + rolling bank that works exactly like PIC pulls (migration 9989 /
-- lib/pic-quota.ts). Every reveal is recorded (account phone, ad id,
-- timestamp) in reveal_log — the record doubles as the persistent "already
-- revealed, free to see again" check and feeds the /admin/insights
-- excessive-reveals flags. See lib/reveal-quota.ts.
--
-- Re-runnable: safe to paste into the Supabase SQL editor more than once
-- (add-column/create-table IF NOT EXISTS, create-or-replace function,
-- on-conflict config).

-- 1) Per-account bank state (mirrors 9989's pic_balance / pic_accrual_day).
--    reveal_balance     = look-ups available right now.
--    reveal_accrual_day = ET day (date) the balance was last accrued to;
--                         NULL = never (the next reveal seeds one day's allowance).
alter table users add column if not exists reveal_balance integer not null default 0;
alter table users add column if not exists reveal_accrual_day date;

-- 2) The reveal log: one row per (member phone, ad) — the FIRST reveal is
--    recorded with its timestamp; repeats are free and keep the original row.
--    ad_id is a plain bigint (no FK) so the audit record outlives a deleted ad.
create table if not exists reveal_log (
  id bigint generated always as identity primary key,
  phone text not null,
  ad_id bigint not null,
  created_at timestamptz not null default now()
);
create unique index if not exists reveal_log_phone_ad_uniq on reveal_log (phone, ad_id);
create index if not exists reveal_log_created_idx on reveal_log (created_at desc);

-- Service-role only, like every table (RLS on, no policies).
alter table reveal_log enable row level security;

-- 3) Atomic check-log-accrue-spend, serialized per user so a burst of
--    concurrent reveals can't overspend the bank or double-charge one ad
--    (same advisory-lock pattern as reserve_pic_quota, migration 9989).
--    Returns { allowed: bool, remaining: int } (remaining -1 = not metered).
--      - already in reveal_log     -> free repeat (allowed, -1), nothing spent.
--      - p_daily <= 0              -> metering OFF: always allowed, still logged.
--      - no such user              -> fail-open (allowed, -1), still logged;
--                                     the action ensureAccount()s first, so
--                                     this is defensive.
--      - p_today is 'YYYY-MM-DD' (the ET calendar day, computed by the app).
create or replace function reserve_reveal_quota(
  p_phone text,
  p_ad_id bigint,
  p_daily int,
  p_cap int,
  p_today text
) returns jsonb
language plpgsql
as $$
declare
  v_user uuid;
  v_balance int;
  v_day date;
  v_days int;
  v_today date := p_today::date;
begin
  if p_daily <= 0 then
    -- Metering off — the reveal still gets its permanent record.
    insert into reveal_log (phone, ad_id) values (p_phone, p_ad_id)
      on conflict (phone, ad_id) do nothing;
    return jsonb_build_object('allowed', true, 'remaining', -1);
  end if;

  select id into v_user from users where phone = p_phone;
  if v_user is null then
    insert into reveal_log (phone, ad_id) values (p_phone, p_ad_id)
      on conflict (phone, ad_id) do nothing;
    return jsonb_build_object('allowed', true, 'remaining', -1);
  end if;

  -- Serialize the whole check+accrue+spend for this user: without the lock,
  -- two concurrent first-reveals of the SAME ad could both pass the repeat
  -- check and burn two look-ups for one ad.
  perform pg_advisory_xact_lock(hashtext('revealquota:' || v_user::text));

  -- Free repeat: this member already paid a look-up for this ad.
  if exists (select 1 from reveal_log where phone = p_phone and ad_id = p_ad_id) then
    return jsonb_build_object('allowed', true, 'remaining', -1);
  end if;

  select coalesce(reveal_balance, 0), reveal_accrual_day
    into v_balance, v_day
    from users where id = v_user;

  -- Accrual (mirrors accruePicQuota in lib/pic-quota.ts, reveal-parameterized).
  if v_day is null then
    v_balance := least(p_cap, p_daily);
    v_day := v_today;
  else
    v_days := v_today - v_day;      -- whole calendar days elapsed
    if v_days > 0 then
      v_balance := least(p_cap, v_balance + v_days * p_daily);
      v_day := v_today;
    else
      -- Same day / clock skew: no grant, but clamp down to the current cap so
      -- a lowered admin cap takes effect on the next reveal.
      v_balance := least(p_cap, v_balance);
    end if;
  end if;

  if v_balance >= 1 then
    v_balance := v_balance - 1;
    update users set reveal_balance = v_balance, reveal_accrual_day = v_day where id = v_user;
    insert into reveal_log (phone, ad_id) values (p_phone, p_ad_id)
      on conflict (phone, ad_id) do nothing;
    return jsonb_build_object('allowed', true, 'remaining', v_balance);
  end if;

  update users set reveal_balance = v_balance, reveal_accrual_day = v_day where id = v_user;
  return jsonb_build_object('allowed', false, 'remaining', 0);
end;
$$;

-- 4) Admin-tunable config rows (defaults mirror lib/config.ts engineDefaults).
insert into config (key, value) values
  ('reveals_per_day',      '10'),
  ('reveal_bank_cap',      '30'),
  ('reveal_abuse_per_day', '25')
on conflict (key) do nothing;
