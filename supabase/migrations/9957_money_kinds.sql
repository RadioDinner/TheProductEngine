-- 9957 — split the catch-all `adjustment` ledger kind (session 019)
--
-- WHY
-- ---
-- `adjustment` meant two opposite things. "A $50 cheque arrived" is real money
-- collected; "here's $10 for the trouble" is a marketing cost. Both were
-- written as `adjustment` and told apart only by the free-text note, which made
-- two questions unanswerable:
--
--   1. How much cash has actually been collected? (Insights counted only
--      Stripe `purchase`, so every cheque and cash payment was invisible.)
--   2. How much of a member's balance may be refunded to their card?
--
-- The second is the one that costs money. A member who adds $20 and receives
-- the $40 starter credit has a $60 balance, of which only $20 was ever theirs.
-- Refunds are operator-manual, so nothing but the operator's memory stopped
-- $60 going back for a $20 payment.
--
-- WHAT
-- ----
-- Three new values on `ledger_kind`:
--
--   payment   real money in that did NOT come through Stripe — a cheque, cash,
--             a phone order the operator keyed. Counts as CASH: refundable.
--   courtesy  goodwill credit, a make-good, a correction upward. Counts as
--             GRANTED: a marketing cost, never refundable as cash.
--   payout    money actually sent back out to a card or by cheque. Reduces the
--             refundable cash so the same money cannot go out twice.
--
-- `adjustment` is KEPT and stays legal — every row already written uses it, and
-- rewriting history to guess which ones were cheques would be inventing facts.
-- lib/money.ts treats legacy rows conservatively instead: a positive one counts
-- as GRANTED (so it can never fund a refund) and a negative one as PAID OUT (so
-- it can never be refunded twice). Both err toward refunding less, and the
-- admin money report shows the unclassified total separately rather than
-- folding a guess into a number that looks exact.
--
-- RE-RUNNABLE: `add value if not exists` is a no-op on a second paste.
--
-- NOTE FOR WHOEVER PASTES THIS: in Postgres 12+ a new enum value cannot be
-- USED in the same transaction that adds it. Adding is all this file does, so
-- pasting it whole is fine — but do not staple an INSERT using these kinds onto
-- the end of it.

alter type ledger_kind add value if not exists 'payment';
alter type ledger_kind add value if not exists 'courtesy';
alter type ledger_kind add value if not exists 'payout';

comment on type ledger_kind is
  'grant/courtesy = credit given away (never refundable as cash). purchase/payment = real money in (refundable). spend = an ad charge. refund = credit returned to the BALANCE when an ad did not run. payout = money sent back out to a card. adjustment = the pre-session-019 catch-all, kept for history and treated conservatively by lib/money.ts.';
