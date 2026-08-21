-- ============================================================
-- 9953 — an ad with no money behind it is HELD, not lost (session 020)
--
-- The user's rule, replacing a $50 debt allowance they cancelled the same
-- session: "if someone has no card saved, and no balance for credit, reply to
-- the user that their ad is saved, but they need to call in and add a card to
-- their account before it gets sent out."
--
-- Until now an unfunded post was simply refused — the seller's text was gone
-- and they had to type the whole thing again from a flip phone. It is now
-- written down and parked in a new 'unpaid' status, outside the review queue
-- and off the website, until the money arrives. Adding a card on the phone
-- releases it (the IVR charges and posts everything waiting), and so does
-- topping up on the web.
--
-- unpaid_cents is the price QUOTED when the ad was held. The release charges
-- that, not a freshly computed price: an ad held on Monday must not cost more
-- on Wednesday because the operator edited the price list in between, and the
-- seller was told a number when they posted.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
--
-- ⚠️ If the editor rejects the second statement with "unsafe use of new value
--    of enum type", run the ALTER TYPE on its own first, then the rest.
--    Postgres will not let a brand-new enum value be USED in the transaction
--    that created it. Nothing below uses the literal, so this should not
--    happen — the note is here because the next person to add a status will
--    hit it.
-- ============================================================

alter type ad_status add value if not exists 'unpaid';

-- The price the seller was quoted, in cents. NULL for every ad that was never
-- held (i.e. all of them before this migration).
alter table ads add column if not exists unpaid_cents integer;

comment on column ads.unpaid_cents is
  'Price in cents quoted when an ad was held unpaid; charged as-is on release.';

-- Listing a member's held ads rides the existing ads_user_idx (user_id).
-- No partial index on status = ''unpaid'' on purpose: it would use the new
-- enum value in this same transaction, which Postgres refuses.
