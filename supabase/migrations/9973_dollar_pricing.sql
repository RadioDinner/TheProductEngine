-- ============================================================
-- 9973 — DOLLAR PRICING (session 016 overhaul; see docs/pricing.md)
--
-- The credit system is replaced by dollar-denominated ad credit:
--   * credit_ledger.delta becomes CENTS (existing credit-era rows are
--     converted once at $1/credit — guarded by the money_unit marker).
--   * Remaining free-ad passes convert to dollars at $60/pass (a pass
--     covered any ad kind; $60 = the new picture-ad price) and free_ads
--     is zeroed. The column stays (harmless) but nothing reads it.
--   * New price config keys (values in cents); the credit-era keys are
--     REMOVED so a stale 2/10 row can never be misread as cents. The
--     deployed code reads ONLY the new keys and falls back to correct
--     dollar defaults, so running this before or after the deploy is safe.
--   * users.auto_topup — the automatic saved-card top-up consent toggle
--     (default true; the code FAILS CLOSED and never auto-charges a card
--     until this column exists).
--   * ads.web_listing — the website-listing add-on flag (default true =
--     listed; only meaningful once web_addon_cents is set above 0).
--   * The dead seeded `packs` table is dropped (never read by any code —
--     confirmed in the session-013 audit; credit packs no longer exist).
--
-- Re-runnable: every step is guarded (marker row, IF NOT EXISTS, IF EXISTS).
-- Hand-paste into the Supabase SQL editor; never `supabase db push`.
-- Verify afterward: /api/health -> migration9973 {applied: true}.
-- ============================================================

-- 1) One-time money conversion, guarded by the money_unit marker.
do $$
begin
  if not exists (select 1 from config where key = 'money_unit') then
    -- Credit-era ledger rows become cents at $1 per credit.
    update credit_ledger set delta = delta * 100;

    -- Remaining free-ad passes become dollars ($60 each — the picture price,
    -- since a pass covered either ad kind; generous by design).
    insert into credit_ledger (user_id, delta, kind, note)
    select id,
           free_ads * 6000,
           'grant',
           'Converted ' || free_ads || ' free ad pass(es) to dollars — pricing overhaul'
    from users
    where free_ads > 0;

    update users set free_ads = 0 where free_ads > 0;

    insert into config (key, value) values ('money_unit', '"cents"');
  end if;
end $$;

-- 2) New price keys (cents). Insert-only: a later operator edit wins.
insert into config (key, value) values
  ('ad_price_text_cents',   '4500'),
  ('ad_price_photo_cents',  '6000'),
  ('web_addon_cents',       '0'),
  ('starter_credit_cents',  '15000')
on conflict (key) do nothing;

-- 3) Retire the credit-era keys so nothing can ever read them as prices.
delete from config where key in (
  'credit_cost_text',
  'credit_cost_photo',
  'bump_cost',
  'saved_card_discount_percent',
  'starter_free_ads',
  'max_queued_bumps_per_ad'
);

-- 4) Automatic top-up consent (default ON for members with a saved card;
--    the /account and /admin/users toggles flip it).
alter table users add column if not exists auto_topup boolean not null default true;

-- 5) Website-listing add-on flag. true/null = listed (every existing ad
--    keeps listing); false = off the public site (only set once the add-on
--    is priced).
alter table ads add column if not exists web_listing boolean not null default true;

-- 6) The dead seeded packs table (never read by any code).
drop table if exists packs;
