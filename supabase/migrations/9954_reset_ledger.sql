-- 9954 — reset the money books: nobody has paid anything in, everybody holds
--        the welcome credit (session 020, user decision — ⚠️ DESTRUCTIVE)
--
-- WHY
-- ---
-- Pre-launch, every payment, spend and adjustment in the ledger was the
-- operator testing the service on themselves. /admin/money reads EVERY
-- credit_ledger row, all time, with no date filter, so the dashboard was
-- adding up a rehearsal and calling it income — $130 collected, $250 paid
-- back out, $256 issued, $16 earned.
--
-- The user's stated end state, which is what this file produces:
--   "Everyone, all 4 users should have paid nothing in, and have 40 in
--    credit. My total credits given out should be 160 total."
--
-- WHY THIS WIPES AND RE-GRANTS RATHER THAN KEEPING WHAT IS THERE
-- --------------------------------------------------------------
-- The first draft of this migration kept the existing welcome-credit rows and
-- deleted the rest. That is NOT the same thing, and it would have missed:
-- the dashboard showed $120 still unspent — three members' worth of $40, not
-- four — so a keep-what-exists reset lands on $120 across 3 members. Some
-- members' welcome credit had been partly spent, some never had a welcome row
-- at all. Reconstructing the intended state is the only way to reach it
-- exactly, so this deletes everything and writes ONE fresh welcome grant per
-- member. The end state is then a function of the users table, not of
-- whatever mess the ledger happened to hold.
--
-- WHAT IT DOES
-- ------------
--   1. Deletes every credit_ledger row.
--   2. Writes one grant per user in the users table, for
--      config.starter_credit_cents (falling back to the code default, 4000 =
--      $40), with the exact note lib/store.ts starterCreditNote() writes, so
--      the row is indistinguishable from one the app granted itself.
--   3. Stamps users.starter_granted_at so the app never grants a second
--      welcome credit to these members, and so the 200-member launch-offer
--      count (starterCreditAvailable) stays honest.
--
-- ⚠️ Step 3 means every existing member counts as having had their welcome
--    credit, including any who never posted. That is deliberate — it is what
--    "everyone has 40 in credit" means — but it is a departure from the normal
--    rule that the grant lands on a member's FIRST post, not at signup.
--
-- ⚠️ RUN THE PREVIEW FIRST. The total is (number of users) × $40, so if the
--    users table holds more than the 4 members expected, the total will not be
--    $160. Before pasting this, run:
--
--      select count(*) as users,
--             count(*) * coalesce((select (value #>> '{}')::int from config
--                                   where key = 'starter_credit_cents'), 4000)
--               / 100.0 as total_credit_dollars
--        from users;
--
--    If that does not say 4 and 160.00, stop and say so — do not paste this.
--
-- WHAT IT DOES NOT TOUCH — say the word if any of these should go too:
--   * ads. Their spend rows are deleted, so old test ads stay live on the site
--     but are no longer recorded as paid for. /admin/purge removes a test
--     member and their ads together.
--   * business_packages (sponsor money has its own table, not on /admin/money),
--     users.free_ads (legacy passes).
--   * Stripe. Real charges live at Stripe and are untouched; this only makes
--     the service forget it recorded them.
--
-- ⚠️ RE-RUNNABLE BY DISARMING ITSELF, NOT BY REPEATING
-- ----------------------------------------------------
-- credit_ledger is APPEND-ONLY BY DESIGN (see 9966) and it is what every
-- member's balance is MADE of. A wipe that simply re-ran on every paste would
-- be a loaded gun in the migrations folder: a future session told to "paste
-- the pending migrations" would destroy real money.
--
-- So the marker config.ledger_reset_at records WHICH reset ran, as
-- {"at": <timestamp>, "shape": "wipe-and-grant-v2"}. A run whose shape already
-- matches does nothing. An earlier v1 marker does NOT block this, so a
-- database that got the superseded draft still lands on the right state.
-- To reset deliberately again, delete that config row first.

do $$
declare
  v_shape    constant text := 'wipe-and-grant-v2';
  v_marker   jsonb;
  v_amount   integer;
  v_label    text;
  v_deleted  bigint;
  v_granted  bigint;
begin
  select value into v_marker from config where key = 'ledger_reset_at';

  if v_marker is not null and jsonb_typeof(v_marker) = 'object'
     and v_marker ->> 'shape' = v_shape then
    raise notice 'Books were already reset in this shape at %. Nothing done. '
                 'Delete the config row ''ledger_reset_at'' first if you '
                 'really mean to reset the books again.', v_marker ->> 'at';
    return;
  end if;

  -- The welcome credit, from Settings, so this writes whatever the service
  -- currently grants rather than a number frozen into a migration.
  select coalesce((select (value #>> '{}')::int from config
                    where key = 'starter_credit_cents'), 4000)
    into v_amount;
  if v_amount <= 0 then
    raise exception 'starter_credit_cents is %, so there is no welcome credit '
                    'to grant. Set it before running this.', v_amount;
  end if;

  -- formatPrice() in lib/config.ts: whole dollars print without decimals.
  v_label := case when v_amount % 100 = 0
                  then '$' || (v_amount / 100)::text
                  else '$' || to_char(v_amount / 100.0, 'FM999999990.00') end;

  delete from credit_ledger;
  get diagnostics v_deleted = row_count;

  -- One grant per member, worded exactly as starterCreditNote() writes it so
  -- the row reads identically to one the app granted on a first post.
  insert into credit_ledger (user_id, delta, kind, note)
  select u.id, v_amount, 'grant',
         'Welcome credit — ' || v_label || ' to spend on ads'
    from users u;
  get diagnostics v_granted = row_count;

  -- Nobody gets a second welcome credit, and the launch-offer count is honest.
  update users set starter_granted_at = coalesce(starter_granted_at, now());

  insert into config (key, value, updated_at)
       values ('ledger_reset_at',
               jsonb_build_object('at', now()::text, 'shape', v_shape),
               now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  raise notice 'Books reset: % ledger row(s) deleted; % member(s) granted % '
               'each (% total). /admin/money now reads $0 collected, $0 '
               'earned, $0 owed.',
               v_deleted, v_granted, v_label,
               case when (v_granted * v_amount) % 100 = 0
                    then '$' || ((v_granted * v_amount) / 100)::text
                    else '$' || to_char((v_granted * v_amount) / 100.0,
                                        'FM999999990.00') end;
end $$;
