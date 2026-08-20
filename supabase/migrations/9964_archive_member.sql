-- 9964 — archiving a member (user request, session 016).
--
-- Two different needs, deliberately kept as two different things:
--
--   DELETE  = purge_member (migration 9966). Gone. No archive, no restore.
--             The right tool for your own test data.
--   ARCHIVE = this. Reversible. Nothing is destroyed; the member is set
--             aside — out of the subscriber lists, out of the ad rotation,
--             off the website — and can be put back exactly as they were.
--
-- Archive is the one to reach for with a REAL person: somebody who asked to
-- be taken off, a seller who has gone quiet, an account you want out of the
-- way while you work out what is going on. Delete is irreversible and the
-- decision cannot be walked back, so anything involving a real customer
-- should archive first and delete later, if ever.
--
-- What archiving does NOT do: it does not refund, it does not text them, and
-- it does not touch their ledger. Their money is still their money — restore
-- them and the balance is exactly where it was. That is the whole point of
-- doing this with a flag instead of a delete.
--
-- Re-runnable.

alter table users add column if not exists archived_at timestamptz;
alter table users add column if not exists archived_reason text;

-- Every "who should get this" query filters on this, so it is worth an index
-- even though the archived set will be small: it is the common case that the
-- column is null, and a partial index on the exceptions stays tiny.
create index if not exists users_archived_idx
  on users (archived_at)
  where archived_at is not null;

-- Archiving hides a member's live ads from the website and the send queue
-- without changing their status, so restoring puts them back exactly as they
-- were rather than reviving something the member had themselves marked sold
-- or the system had expired.
alter table ads add column if not exists owner_archived boolean not null default false;

create index if not exists ads_owner_archived_idx
  on ads (owner_archived)
  where owner_archived = true;

/**
 * Archive or restore in one statement, keeping users.archived_at and the
 * ads.owner_archived mirror in step.
 *
 * The mirror exists because the ad queries are hot and joining to users on
 * every one of them to ask "is the owner archived?" would cost more than
 * keeping one boolean honest here.
 */
create or replace function set_member_archived(
  p_phone text,
  p_archived boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ads integer;
begin
  select id into v_user_id from users where phone = p_phone;
  if v_user_id is null then
    return jsonb_build_object('found', false, 'phone', p_phone);
  end if;

  update users
     set archived_at = case when p_archived then now() else null end,
         archived_reason = case when p_archived then p_reason else null end
   where id = v_user_id;

  update ads set owner_archived = p_archived where user_id = v_user_id;
  get diagnostics v_ads = row_count;

  -- Queued sends for an archived member are dropped rather than left to fire
  -- the moment the queue drains. Restoring does not put them back: the ad is
  -- live again and rides the next pass on its own.
  if p_archived then
    delete from digest_outbox
     where address = p_phone and status = 'queued';
  end if;

  return jsonb_build_object(
    'found', true,
    'phone', p_phone,
    'archived', p_archived,
    'ads_touched', v_ads
  );
end;
$$;
