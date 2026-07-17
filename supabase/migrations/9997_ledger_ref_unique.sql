-- ============================================================
-- The Plain Exchange — credit_ledger.ref idempotency guard
-- Makes credit grants safe against duplicate/concurrent Stripe webhook
-- deliveries: the app pre-checks the ref, but only a DB unique constraint
-- closes the check-then-insert race. addLedgerEntry treats a 23505 on this
-- index as "already granted." Re-runnable.
-- ============================================================

create unique index if not exists credit_ledger_ref_uniq
  on credit_ledger (ref)
  where ref is not null;
