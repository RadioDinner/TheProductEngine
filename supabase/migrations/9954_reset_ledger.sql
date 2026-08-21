-- 9954 — reset the money books to zero, keeping the welcome credit
--        (session 020, user decision — ⚠️ DESTRUCTIVE, RUNS ONCE)
--
-- WHY
-- ---
-- Pre-launch, every payment, spend and adjustment in the ledger was the
-- operator testing the service on themselves. /admin/money reads EVERY
-- credit_ledger row, all time, with no date filter, so the dashboard was
-- adding up a rehearsal and calling it income. The user's decision, asked and
-- answered this session: "I want to wipe to zero aside from the 40 dollar ad
-- credit", and "no real member money is in the system yet".
--
-- WHAT SURVIVES
-- -------------
-- The welcome credit, and only the welcome credit: rows where
--   kind = 'grant' AND note LIKE 'Welcome %'
-- That is what lib/store.ts starterCreditNote() writes ("Welcome credit —
-- $40 to spend on ads") and what migration 9990 already uses to recognise a
-- starter grant. Everything else goes: purchases, payments, spends, refunds,
-- payouts, admin invite credit, legacy adjustments.
--
-- After this runs, every member who has had their welcome credit sits at
-- exactly $40 of GRANTED balance and $0 cash, and the money dashboard reads
-- $0 collected, $0 earned, $0 owed, with credit issued = $40 × those members.
-- That is a clean opening position, not an empty one.
--
-- WHAT IT DOES *NOT* TOUCH — say the word if any of these should go too:
--   * ads. Their spend rows are deleted, so old test ads stay live on the
--     site but are no longer recorded as paid for. /admin/purge is the tool
--     for removing a test member and their ads together.
--   * business_packages (sponsor money has its own table and is not on
--     /admin/money), users.free_ads (legacy passes), users.starter_granted_at
--     (deliberately kept, so nobody is granted the welcome credit twice and
--     the 200-member launch-offer count stays honest).
--   * Stripe. Real charges live at Stripe and are untouched here; this only
--     forgets that the service recorded them.
--
-- ⚠️ RE-RUNNABLE BY DISARMING ITSELF, NOT BY REPEATING
-- ----------------------------------------------------
-- credit_ledger is APPEND-ONLY BY DESIGN (see 9966) and it is what every
-- member's balance is made of. A wipe that simply re-ran on every paste would
-- be a loaded gun sitting in the migrations folder: a future session told to
-- "paste the pending migrations" would destroy real money.
--
-- So the first run writes config.ledger_reset_at, and every run after that
-- checks for it and does NOTHING. Pasting this file twice is safe. Pasting it
-- in six months is safe. To deliberately reset the books AGAIN, delete that
-- config row first — an explicit act, which is the point.

do $$
declare
  v_already   timestamptz;
  v_deleted   bigint;
  v_kept      bigint;
  v_members   bigint;
begin
  select (value #>> '{}')::timestamptz into v_already
    from config where key = 'ledger_reset_at';

  if v_already is not null then
    raise notice 'Ledger was already reset at %. Nothing done. Delete the '
                 'config row ''ledger_reset_at'' first if you really mean to '
                 'reset the books again.', v_already;
    return;
  end if;

  -- What is about to be kept, counted BEFORE the delete so the notice is
  -- about this run rather than about whatever is left afterwards.
  select count(*) into v_kept
    from credit_ledger
   where kind = 'grant' and note like 'Welcome %';

  delete from credit_ledger
   where not (kind = 'grant' and note like 'Welcome %');
  get diagnostics v_deleted = row_count;

  select count(distinct user_id) into v_members from credit_ledger;

  insert into config (key, value, updated_at)
       values ('ledger_reset_at', to_jsonb(now()::text), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  raise notice 'Books reset: % ledger rows deleted, % welcome-credit rows kept '
               'across % member(s). /admin/money now reads $0 collected and '
               '$0 earned.', v_deleted, v_kept, v_members;
end $$;
