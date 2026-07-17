-- ============================================================
-- The Plain Exchange — atomic login-code verification
--
-- The old verifyCode() read attempts, checked the cap, then wrote attempts+1
-- in a separate statement (TOCTOU): concurrent wrong-code guesses could all
-- read attempts < max and all proceed, amplifying a brute-force of the 6-digit
-- code toward account/admin takeover. This RPC does the whole check-and-burn
-- under a row lock (FOR UPDATE) so guesses serialize and the attempt cap is
-- exact. Re-runnable.
-- ============================================================

create or replace function verify_login_code(
  p_phone text,
  p_code_hash text,
  p_max_attempts int
)
returns text
language plpgsql
as $$
declare
  rec verification_codes%rowtype;
begin
  -- Lock the row so concurrent verifications for this phone serialize here.
  select * into rec from verification_codes where phone = p_phone for update;
  if not found then
    return 'none';
  end if;
  if rec.expires_at < now() then
    delete from verification_codes where phone = p_phone;
    return 'expired';
  end if;
  if rec.attempts >= p_max_attempts then
    delete from verification_codes where phone = p_phone;
    return 'attempts';
  end if;
  if rec.code_hash = p_code_hash then
    delete from verification_codes where phone = p_phone;  -- single-use
    return 'ok';
  end if;
  -- Wrong code: burn exactly one attempt atomically.
  update verification_codes set attempts = attempts + 1 where phone = p_phone;
  if rec.attempts + 1 >= p_max_attempts then
    delete from verification_codes where phone = p_phone;
    return 'attempts';
  end if;
  return 'wrong';
end;
$$;
