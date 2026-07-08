-- ============================================================
-- The Plain Exchange — number blocklist + operator control config
--
-- Adds the UNDER ATTACK blocklist and seeds the config rows for the new
-- operator kill switches so /admin/settings shows them. A blocked number is
-- dropped at the top of the inbound engine (no account, no reply, no charge)
-- and excluded from every outbound send. Re-runnable.
-- RLS on, no policies — service role only, like every other table.
-- ============================================================

create table if not exists blocked_numbers (
  phone text primary key,             -- app-canonical 10-digit form
  reason text not null default 'Blocked from admin',
  created_by text,                    -- admin phone that added it, if known
  created_at timestamptz not null default now()
);

comment on table blocked_numbers is
  'UNDER ATTACK blocklist: inbound from these numbers is dropped before any processing; they receive no outbound. Managed at /admin/insights.';

alter table blocked_numbers enable row level security;

-- ---------- operator control config rows ----------
-- getEngineSettings falls back to code defaults when a row is absent, so these
-- are for visibility/editing at /admin/settings. Values are jsonb.
--   pause_mode: "off" | "bulk" (partial) | "all" (full outbound kill)
--   under_attack: boolean
--   outbound_throttle_per_min: global sends/min ceiling while under_attack

insert into config (key, value) values
  ('pause_mode', '"off"'),
  ('under_attack', 'false'),
  ('outbound_throttle_per_min', '60')
on conflict (key) do nothing;
