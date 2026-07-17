-- ============================================================
-- 9978 — business advertising packages (FEATURES.md item 17, session 009)
--
-- Businesses buy a package on /advertising (Stripe self-serve): their ad
-- rides the daily digest once a day as a clearly-labeled "Sponsor:" line,
-- OUTSIDE the cap-10 member ads. Tiers: 1 week $39.99, 2 weeks $59.99,
-- 1 month $89.99. Payment never skips review: the webhook stores the paid
-- package as pending_review and the operator approves or declines it on
-- /admin/business — the SAME human-review posture as regular ads.
--
-- The run clock starts at APPROVAL, not payment: approve sets starts_at and
-- the scheduled ends_at. The package truly expires when days_ran reaches
-- days_purchased — so a day whose digest never went out (pause, breaker,
-- empty day) does NOT eat a paid day; the run simply extends and the admin
-- page shows it as behind schedule.
--
-- stripe_ref (the payment-intent id) is UNIQUE: the webhook's insert is the
-- idempotency point, so Stripe retries/replays can never create two packages
-- for one payment (credit_ledger.ref-style dedup, own table).
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- RLS on with no policies: service-role access only, like every other table.
-- ============================================================

create table if not exists business_packages (
  id bigint generated always as identity primary key,
  business_name text not null,
  ad_text text not null,
  link text,                    -- the ONE allowed link (mayPostLinks seam; review is the gate)
  phone text,                   -- optional contact number (canonical 10-digit)
  tier text not null,           -- 'week' | 'twoweeks' | 'month' (lib/business-packages.ts)
  days_purchased integer not null,
  price_cents integer not null,
  stripe_ref text not null unique,  -- payment-intent id; the idempotency ref
  status text not null default 'pending_review'
    check (status in ('pending_review', 'active', 'declined', 'expired')),
  paid_at timestamptz not null default now(),
  approved_at timestamptz,
  starts_at timestamptz,        -- set at approval (the clock starts here)
  ends_at timestamptz,          -- scheduled end (starts_at + days) — display only;
                                -- the real end is days_ran = days_purchased
  days_ran integer not null default 0,
  last_ran_on text,             -- ET day (YYYY-MM-DD) the sponsor line last rode
  last_ran_key text,            -- that digest's slot key (the email edition mirrors by this)
  declined_at timestamptz,
  refunded_at timestamptz,      -- operator marked the MANUAL Stripe refund done (no auto-refund in v1)
  created_at timestamptz not null default now()
);

create index if not exists business_packages_status_idx on business_packages (status);

alter table business_packages enable row level security;
