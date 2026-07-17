-- ============================================================
-- 9982 — digest numbers (FEATURES.md item 5, session 008)
--
-- Every SENT SMS digest (scheduled, early, or extra — anything with items)
-- gets a number, incrementing by 1 from 1. The counter starts fresh with
-- this migration ("reset the number now"): existing digests stay NULL and
-- the first digest composed after this lands is No. 1. The email edition
-- mirrors its SMS digest's number.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

alter table digests add column if not exists digest_no integer;

create unique index if not exists digests_digest_no_uniq
  on digests (digest_no)
  where digest_no is not null;
