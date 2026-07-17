-- 9989_pic_quota.sql
-- PIC (picture pull) daily allowance + rolling/sinking bank — the real MMS cost
-- control. Every number gets `pic_daily_allowance` photo pulls per ET calendar
-- day; unused pulls bank up to `pic_bank_cap`. The per-number hourly PIC cap
-- (sms_pics_per_hour) stays on top as a burst limiter. See lib/pic-quota.ts.
--
-- Re-runnable: safe to paste into the Supabase SQL editor more than once
-- (add-column IF NOT EXISTS, create-or-replace function, on-conflict config).

-- 1) Per-account bank state.
--    pic_balance      = pulls available right now.
--    pic_accrual_day  = ET day (date) the balance was last accrued to; NULL =
--                       never accrued (the next pull seeds one day's allowance).
alter table users add column if not exists pic_balance integer not null default 0;
alter table users add column if not exists pic_accrual_day date;

-- 2) Atomic accrue-then-spend, serialized per user so a burst of concurrent PIC
--    requests can't overspend the bank (same advisory-lock pattern as
--    reserve_sms / spend_credits, migration 9995). Returns
--    { allowed: bool, remaining: int }.
--      - p_daily <= 0            -> quota OFF: always allowed, remaining -1.
--      - no such user            -> fail-open (allowed, -1); the engine
--                                   ensureAccount()s first, so this is defensive.
--      - p_today is 'YYYY-MM-DD' (the ET calendar day, computed by the app).
create or replace function reserve_pic_quota(
  p_phone text,
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
    return jsonb_build_object('allowed', true, 'remaining', -1);
  end if;

  select id into v_user from users where phone = p_phone;
  if v_user is null then
    return jsonb_build_object('allowed', true, 'remaining', -1);
  end if;

  -- Serialize accrue+spend for this user so the bank can't be overspent.
  perform pg_advisory_xact_lock(hashtext('picquota:' || v_user::text));

  select coalesce(pic_balance, 0), pic_accrual_day
    into v_balance, v_day
    from users where id = v_user;

  -- Accrual (mirrors accruePicQuota in lib/pic-quota.ts).
  if v_day is null then
    v_balance := least(p_cap, p_daily);
    v_day := v_today;
  else
    v_days := v_today - v_day;      -- whole calendar days elapsed
    if v_days > 0 then
      v_balance := least(p_cap, v_balance + v_days * p_daily);
      v_day := v_today;
    else
      -- Same day / clock skew: no grant, but clamp down to the current cap so a
      -- lowered admin cap takes effect on the next pull.
      v_balance := least(p_cap, v_balance);
    end if;
  end if;

  if v_balance >= 1 then
    v_balance := v_balance - 1;
    update users set pic_balance = v_balance, pic_accrual_day = v_day where id = v_user;
    return jsonb_build_object('allowed', true, 'remaining', v_balance);
  end if;

  update users set pic_balance = v_balance, pic_accrual_day = v_day where id = v_user;
  return jsonb_build_object('allowed', false, 'remaining', 0);
end;
$$;

-- 3) Admin-tunable config rows (defaults mirror lib/config.ts engineDefaults).
insert into config (key, value) values
  ('pic_daily_allowance', '3'),
  ('pic_bank_cap',        '20')
on conflict (key) do nothing;
