-- 0010_defer_starter_grant.sql
-- Defer the starter free-ad grant from account creation to the seller's FIRST
-- `AD NEW`. Previously ensureAccount / upsertAccountPassword granted
-- STARTER_FREE_ADS (3) and wrote a "Welcome" ledger row the moment an account
-- was minted — so any number that only ever texted SUBSCRIBE/CREDITS/MYADS
-- minted 3 free-ad passes it never earned. Now accounts start with ZERO passes
-- and lib/store(-supabase).grantStarterAdsIfFirst() applies the grant on the
-- first real post, stamping starter_granted_at so it never re-fires.
--
-- Re-runnable: safe to paste into the Supabase SQL editor more than once.

-- 1) The one-time grant marker. NULL = not yet granted.
alter table users add column if not exists starter_granted_at timestamptz;

-- 2) Backfill EXISTING accounts as already-granted, so the lazy grant never
--    re-fires for anyone who already received their passes under the old
--    create-time behavior. Those accounts are identified by their delta-0
--    "Welcome ..." grant ledger row. This guard is what makes the backfill
--    re-runnable: a NEW, not-yet-posted account has NO welcome row and its
--    starter_granted_at stays NULL (it gets the grant on its first AD NEW),
--    so re-running this file will not wrongly mark it as granted.
update users u
set starter_granted_at = u.created_at
where u.starter_granted_at is null
  and exists (
    select 1
    from credit_ledger l
    where l.user_id = u.id
      and l.kind = 'grant'
      and l.note like 'Welcome %'
  );

-- 3) New accounts default to zero passes (the app also sets free_ads = 0
--    explicitly on insert; this keeps any other insert path consistent).
alter table users alter column free_ads set default 0;
