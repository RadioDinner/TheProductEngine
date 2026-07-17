-- ============================================================
-- The Plain Exchange — digest outbox (columnar delivery)
--
-- Replaces the serial in-request digest send loop with a durable queue:
-- composing a digest enqueues one row per (recipient, message part); the
-- cron drains bounded batches ordered by part, so every subscriber gets
-- part 1 before anyone gets part 2, and a timeout mid-send resumes on the
-- next run instead of silently dropping the rest of the list. Re-runnable.
-- RLS on, no policies — service role only, like every other table.
-- ============================================================

-- Digest item count, persisted so "first digest of the day with items"
-- (the Reply-STOP footer rule) can be answered without joining items/bumps.
alter table digests add column if not exists item_count integer not null default 0;

-- ---------- the outbox ----------

create table if not exists digest_outbox (
  id bigint generated always as identity primary key,
  digest_id bigint not null references digests (id) on delete cascade,
  channel message_channel not null default 'sms',   -- 'sms' | 'email'
  address text not null,          -- phone number or email address
  part integer not null,          -- 1-based message part within the digest
  parts integer not null,         -- total parts for this digest
  subject text,                   -- email only
  body text not null,             -- SMS text / email plain-text
  html text,                      -- email only
  segments integer not null default 0,  -- billed SMS segments (0 for email)
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (digest_id, address, part)  -- enqueue is idempotent / resumable
);

-- Drain order: columnar (all part 1s first), FIFO within a part.
create index if not exists digest_outbox_drain_idx
  on digest_outbox (part, id)
  where status in ('queued', 'sending');

-- Budget window: billed segments actually sent in the last 24h.
create index if not exists digest_outbox_sent_idx
  on digest_outbox (sent_at)
  where status = 'sent';

alter table digest_outbox enable row level security;

-- ---------- atomic claim ----------
-- Flips a batch of queued rows to 'sending' under SKIP LOCKED so two
-- overlapping cron runs never double-send a row. Rows stuck in 'sending'
-- (a run that died mid-batch) are reclaimed after 10 minutes.

create or replace function claim_digest_outbox(p_limit int)
returns setof digest_outbox
language plpgsql
as $$
begin
  return query
  update digest_outbox o
     set status = 'sending', claimed_at = now()
   where o.id in (
     select id from digest_outbox
      where status = 'queued'
         or (status = 'sending' and claimed_at < now() - interval '10 minutes')
      order by part, id
      limit p_limit
      for update skip locked
   )
  returning o.*;
end;
$$;

-- ---------- config: the digest circuit breaker ----------
-- Billed segments the digest broadcaster may send per rolling 24h window
-- (admin-tunable at /admin/settings; 0 pauses digest sending). Inserted here
-- because seed-production.sql already ran in prod.

insert into config (key, value) values ('digest_daily_segment_budget', '12000')
on conflict (key) do nothing;

-- ---------- budget accounting ----------
-- Billed segments delivered since a moment in time — the drain loop checks
-- this against the admin-set daily segment budget (rolling 24h window).

create or replace function outbox_segments_since(p_since timestamptz)
returns int
language sql
as $$
  select coalesce(sum(segments), 0)::int
    from digest_outbox
   where status = 'sent' and sent_at >= p_since;
$$;
