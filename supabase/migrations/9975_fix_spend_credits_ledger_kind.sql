-- 9975_fix_spend_credits_ledger_kind.sql
--
-- FIX (prod ad-posting outage, session 011): the spend_credits RPC (9995)
-- inserted its p_kind TEXT parameter straight into credit_ledger.kind, which
-- is the ledger_kind ENUM (9999_init line 17). Postgres does NOT implicitly
-- cast a text *variable* to an enum, so every credit-charged spend raised
--   42804: column "kind" is of type ledger_kind but expression is of type text
-- That threw on the web post (raw crash) and — via the inbound retry-swallow —
-- silently ate the SMS "AD NEW" that spent credits. Free-ad-pass posts use a
-- direct PostgREST insert (addLedgerEntry), which coerces the string to the
-- enum, so they were unaffected — which is why this stayed latent until a
-- seller's free passes ran out and the first real credit charge hit this RPC.
--
-- The ONLY change from 9995 is p_kind -> p_kind::ledger_kind. Same signature,
-- so create-or-replace swaps the body in place; re-runnable by design.

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
    values (v_user, -p_amount, p_kind::ledger_kind, p_note);
  return true;
end;
$$;
