-- 9963 — paced release: a backed-up queue trickles out instead of firing at once.
--
-- WHY (user decision, session 016): ads are held whenever the queue can't
-- move — an ads pause, an outage, the overnight window, a tripped budget —
-- and the moment the hold lifts the drain empties everything it can. A dozen
-- ads stored up over a launch hold meant every subscriber getting a dozen
-- texts back to back. That is a bad first impression, and on a new 10DLC
-- campaign a sudden burst is exactly the pattern carriers act on.
--
-- So: past a threshold, each ad gets its own release time, spaced by a
-- RANDOM gap in a configurable range (12-18 minutes by default). Random
-- rather than fixed because a metronome is itself a machine signature; human
-- traffic is uneven.
--
-- The threshold matters as much as the gap. Below it nothing is stamped at
-- all and ads keep going out the instant they're approved, which is the
-- behaviour the whole instant-send rework exists for. Pacing is what happens
-- when something went wrong, not the normal path.
--
-- Re-runnable.

-- When this row is allowed to send. NULL = now (the normal case: nothing is
-- stamped unless a backlog is being paced).
alter table digest_outbox add column if not exists release_at timestamptz;

create index if not exists digest_outbox_release_idx
  on digest_outbox (release_at)
  where release_at is not null;

-- The claim now skips rows that are not due yet. Everything else about it is
-- unchanged: FOR UPDATE SKIP LOCKED so overlapping cron ticks never claim the
-- same row, and a 'sending' row whose claim went stale is reclaimed.
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
      where (status = 'queued'
         or (status = 'sending' and claimed_at < now() - interval '10 minutes'))
        and (release_at is null or release_at <= now())
      order by part, id
      limit p_limit
      for update skip locked
   )
  returning o.*;
end;
$$;

/**
 * Stamp a release schedule across a backlog, if there is one worth pacing.
 *
 * Counts the DISTINCT ads waiting (one digest = one ad since instant send)
 * and, when that exceeds p_threshold, gives each a release time: the first
 * goes now, the second after one random gap, the third after two, and so on.
 * The gaps are cumulative so the order is monotonic — drawing an independent
 * random offset per ad would let the fifth ad overtake the second.
 *
 * Only ever touches rows with release_at IS NULL, so it is idempotent: an
 * overlapping cron tick re-running it cannot re-roll a schedule that is
 * already part-sent, and an ad that arrives later joins the tail rather than
 * disturbing what is already scheduled.
 *
 * Returns how many ads were scheduled (0 = nothing to pace).
 */
create or replace function stamp_release_schedule(
  p_threshold int,
  p_min_minutes numeric,
  p_max_minutes numeric
)
returns int
language plpgsql
as $$
declare
  v_pending int;
  v_scheduled int;
  v_min numeric := greatest(p_min_minutes, 0);
  v_max numeric := greatest(p_max_minutes, greatest(p_min_minutes, 0));
begin
  -- 0 (or less) turns pacing off entirely.
  if p_threshold <= 0 then
    return 0;
  end if;

  select count(distinct digest_id) into v_pending
    from digest_outbox
   where status = 'queued' and release_at is null;

  if v_pending <= p_threshold then
    return 0;
  end if;

  with d as (
    select digest_id, min(id) as first_id
      from digest_outbox
     where status = 'queued' and release_at is null
     group by digest_id
  ),
  ordered as (
    select digest_id,
           row_number() over (order by first_id) as rn,
           -- One draw per ad, inside the configured range.
           (v_min + random() * (v_max - v_min)) as gap
      from d
  ),
  cum as (
    select digest_id,
           -- Cumulative, minus this ad's own gap, so the FIRST ad releases
           -- immediately and only the ones behind it wait.
           coalesce(sum(gap) over (order by rn rows between unbounded preceding and current row), 0) - gap
             as offset_minutes
      from ordered
  )
  update digest_outbox o
     set release_at = now() + (c.offset_minutes * interval '1 minute')
    from cum c
   where o.digest_id = c.digest_id
     and o.status = 'queued'
     and o.release_at is null;

  get diagnostics v_scheduled = row_count;
  return v_pending;
end;
$$;

insert into config (key, value) values
  -- Pace only when MORE than this many ads are waiting. 0 = never pace.
  ('paced_release_over', '4'),
  -- The random gap between ads, in minutes.
  ('paced_gap_min_minutes', '12'),
  ('paced_gap_max_minutes', '18')
on conflict (key) do nothing;
