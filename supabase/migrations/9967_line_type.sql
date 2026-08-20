-- 9967 — line-type lookup, so a disposable number can't farm the launch offer.
--
-- Signing up proves only that a number can receive one SMS: a Google Voice or
-- TextNow number passes exactly as well as a real mobile line. That put two
-- things at risk — the 200 starter-credit slots ($40 each, $8,000 of launch
-- offer) and sellers' phone numbers, which a burner account can harvest
-- through website look-ups.
--
-- The policy this feeds does NOT block VoIP signups. Blocking costs real
-- customers, and in a community running on shared phones and answering
-- services it would cost several. It withholds the two things worth abusing —
-- the FREE credit and the number look-ups — so a VoIP member can still sign
-- up, post and pay like anyone else, while the attacker's return goes to zero.
--
-- EVERYTHING BELOW DEFAULTS TO OFF/PERMISSIVE. Pasting this migration changes
-- no behaviour; the operator turns it on from /admin/settings once
-- TWILIO_ACCOUNT_SID is set. Re-runnable.

-- What Twilio told us, and when. Null = never checked (or the check failed,
-- which is deliberately NOT recorded — a Twilio outage must not brand a real
-- member as unverifiable forever; an unrecorded result is simply retried).
alter table users add column if not exists line_type text;
alter table users add column if not exists line_type_at timestamptz;

-- Finding every burner account is an operator question ("who signed up on an
-- app number?"), and the column is null for nearly everyone, so a partial
-- index stays tiny.
create index if not exists users_line_type_idx
  on users (line_type)
  where line_type is not null;

insert into config (key, value) values
  -- Master switch. false = no lookups are made and no policy below applies.
  -- Stays false until the operator has TWILIO_ACCOUNT_SID set and wants it.
  ('lookup_enabled', 'false'),
  -- What a POSITIVELY identified throwaway line (nonFixedVoip, voicemail,
  -- pager) may still do. Defaults are the recommended stance: keep them out
  -- of the free money and out of the seller directory, let them trade.
  ('voip_starter_credit', 'false'),
  ('voip_reveals', 'false'),
  ('voip_posting', 'true')
on conflict (key) do nothing;
