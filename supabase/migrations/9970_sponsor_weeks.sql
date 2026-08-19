-- 9970 — sponsorships are sold by the WEEK, with a fair queue (session 016).
--
-- The user's rules:
--   * unlimited businesses may buy, but only FIVE run in any given week;
--   * a sponsor buying several weeks holds its slot in each of them, so a
--     2-week buyer taking the 5th slot this week automatically holds a slot
--     next week — later buyers wait for the first week with room;
--   * while running, a sponsor's line rides ONE ad text a day, spread
--     through the day, and its banner rotates through the email editions
--     (one sponsor per email).
--
-- Days keep doing the work they already did: a "week" is six sending days
-- (Sunday never sends), and days_ran/last_ran_on remain the once-a-day ride
-- ledger. What is new is WHICH weeks a package is entitled to run in.
--
-- Re-runnable: every statement is guarded.

alter table business_packages add column if not exists weeks_purchased integer;
-- The Monday (ET, YYYY-MM-DD) this package's first reserved week begins.
-- Null = not yet scheduled: it is in the queue waiting for a week with room.
alter table business_packages add column if not exists start_week text;
-- Email banner rotation: how many editions this package's banner has ridden,
-- and the last edition key, so a re-composed edition can't double-count.
alter table business_packages add column if not exists email_rides integer not null default 0;
alter table business_packages add column if not exists last_email_key text;

-- "Who is reserved in week X" is the capacity question, asked on every
-- approval and every send.
create index if not exists business_packages_start_week_idx
  on business_packages (start_week)
  where start_week is not null;

-- How many sponsors may run in one week. Operator-editable like every other
-- tunable; the fairness rule is only as good as the number being honest.
insert into config (key, value) values ('sponsor_weekly_slots', '5')
on conflict (key) do nothing;
