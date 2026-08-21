-- =====================================================================
-- 9951 — an ad is paid for when it RUNS, not when it is written.
--
-- "When people create an ad, and have a card on file, I want the
--  confirmation message to include that the card won't be charged until the
--  ad is run. Make the system honor the truth of this message."
--                                             (user, session 021)
--
-- and, the same session, on an ad that was approved without being paid for:
--
-- "I approved the ad, but it wasn't paid, I want the status to go to
--  'approved, pending payment' but I want the message that the seller gets,
--  to remind them to pay up"
--
-- WHAT CHANGES
--
-- Until now an ad was charged the instant it arrived. That took money for ads
-- the service had not yet run and sometimes never would — an ad turned down at
-- review was charged and then refunded, a round trip through the member's
-- balance for something that never happened.
--
-- Now the ad carries its QUOTED PRICE in `owed_cents` from the moment it is
-- written down, and the batch that carries it out to subscribers is what
-- collects. `owed_cents is not null` means "not paid for yet", whatever the
-- status; the collection clears it.
--
-- Two consequences worth knowing before reading the code:
--
--   * The price is FROZEN at the quote. An ad written on Monday costs Monday's
--     price however long it waits, exactly like the held-ad price 9953 stores.
--   * An unpaid ad is still RESERVED against its member's balance, so $40 of
--     credit still buys exactly two $20 ads however many are in flight. Not
--     charging is not the same as not counting.
--
-- Ads posted BEFORE this migration have no owed_cents and were charged at
-- submission; they run for nothing more, which is correct — they are paid up.
--
-- Re-runnable: every statement is guarded.
-- =====================================================================

-- The quoted price still to collect. Null = nothing owing (it ran, it was
-- collected for, or it predates this migration).
alter table ads add column if not exists owed_cents integer;

comment on column ads.owed_cents is
  'Session 021: the frozen quoted price this ad still owes. Set when the ad is accepted, cleared by the batch that collects for it. Not null = not paid for yet. Reserved against the member''s balance while it stands.';

-- A collection IN PROGRESS. Stamped while one pass is taking the money and
-- cleared when it finishes, either way.
--
-- Three states are needed, not two. "owed_cents is null" alone would mean both
-- "nothing owing, run it free" and "somebody is charging for it right now",
-- and a second pass reading during the first one's Stripe round trip would
-- carry the ad as a freebie. With the claim stamped and the price left in
-- place, the second pass sees an ad that owes money, fails the claim, and
-- leaves it alone.
alter table ads add column if not exists charge_claimed_at timestamptz;

comment on column ads.charge_claimed_at is
  'Session 021: set while a batch is collecting for this ad, cleared when it finishes. A claim older than the staleness window is ignored, so a pass that died mid-collection cannot strand an ad forever.';

-- The back-off after a collection FAILED. Deliberately its own column rather
-- than reusing hold_until: that one belongs to the operator ("skip the next
-- digest"), and money arriving must not silently cancel a hold they put on an
-- ad by hand.
alter table ads add column if not exists charge_hold_until timestamptz;

comment on column ads.charge_hold_until is
  'Session 021: keeps an ad out of batch selection for a few hours after a collection failed, so a declined card is not presented again every five minutes. Cleared the moment the member pays. Separate from hold_until, which is the operator''s own hold.';

-- Held ads written under 9953 carry their quote in unpaid_cents. Move it
-- across so the reservation and the collection can see it. Guarded on the
-- column existing at all, because 9953 may not have been pasted here.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'ads' and column_name = 'unpaid_cents'
  ) then
    update ads
       set owed_cents = unpaid_cents
     where owed_cents is null
       and unpaid_cents is not null
       and unpaid_cents > 0
       and broadcast_at is null;
  end if;
end $$;

-- The two questions asked of this column, both hot:
--   "what does this member still owe?"  — the reservation, on every post
--   "what does this batch owe?"         — the collection, on every send
-- A partial index keeps both to the handful of rows that are actually owing;
-- the overwhelming majority of ads have run and are null here.
create index if not exists ads_owed_idx
  on ads (user_id)
  where owed_cents is not null;

-- ---------- settings ----------

-- How many ads one number may have sitting in the review queue waiting on
-- money before further posts are held out of it. The guard on "an unfunded ad
-- is reviewed like any other": reviewing is hand work, and a number with no
-- money and no card should not be able to fill a morning with it. 0 = no cap.
insert into config (key, value)
values ('max_ads_awaiting_payment', '3'::jsonb)
on conflict (key) do nothing;

-- Hours an ad stays out of batch selection after a collection failed, so a
-- declined card is not presented again every five minutes. Any payment lifts
-- the back-off immediately, so this only governs the do-nothing case.
insert into config (key, value)
values ('charge_retry_hours', '6'::jsonb)
on conflict (key) do nothing;

-- Text the seller when their ad goes out and the money moves. This is the
-- receipt that makes "nothing is charged until your ad runs" checkable rather
-- than merely stated. One segment per ad that runs.
insert into config (key, value)
values ('ad_ran_receipt', 'true'::jsonb)
on conflict (key) do nothing;
