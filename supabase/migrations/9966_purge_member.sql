-- 9966 — purge a member and everything they touched (features 37/38).
--
-- WHY: pre-launch testing left real rows in the database — test ads, test
-- texts, test ledger entries — and every Insights figure is derived LIVE from
-- those rows. There is no stored number to correct: "money spent", "ads
-- served" and the ad funnel are computed on the fly, so the only honest way
-- to fix them is to remove the rows that shouldn't be there. Then every
-- figure comes right at once, everywhere — Insights, the funnel, the ledger,
-- the audit log — and stays right.
--
-- User decision (session 016) after being offered a cutoff date and per-row
-- manual offsets instead: purge the data.
--
-- WHY A DATABASE FUNCTION rather than a series of deletes from the app:
--   * ATOMICITY. A plpgsql function runs in one transaction. A half-finished
--     purge — ads gone, ledger kept — would leave the books in a state
--     nothing in the app expects, and would be worse than not purging.
--   * ORDER. Some children cascade from ads (photos, bumps, sales, ratings,
--     submissions, sms_contexts) and some deliberately do NOT (digest_items,
--     offenses reference ads with no cascade). Getting that order right once,
--     here, beats re-deriving it at every call site.
--   * AN HONEST PREVIEW. The preview and the purge count the same rows with
--     the same predicates, so the confirmation screen cannot promise one
--     thing and do another.
--
-- ⚠️ THIS DELETES FROM credit_ledger, which is append-only BY DESIGN — it is
-- the reconstructable record of every cent. That rule is suspended here on
-- purpose and only here: the entries being removed are test entries that
-- never represented real money. Do not reach for this function to "fix" a
-- real member's balance; use an adjusting ledger entry, which is what the
-- append-only design is for.
--
-- Re-runnable.

create or replace function purge_member(p_phone text, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_ad_ids bigint[];
  v_chat_ids bigint[];
  v_counts jsonb;
begin
  select id into v_user_id from users where phone = p_phone;
  if v_user_id is null then
    return jsonb_build_object('found', false, 'phone', p_phone);
  end if;

  select coalesce(array_agg(id), '{}') into v_ad_ids from ads where user_id = v_user_id;
  select coalesce(array_agg(id), '{}') into v_chat_ids
    from chats where a_user_id = v_user_id or b_user_id = v_user_id;

  -- Count FIRST, with exactly the predicates the deletes use below. The
  -- preview and the real thing therefore cannot disagree.
  v_counts := jsonb_build_object(
    'found', true,
    'phone', p_phone,
    'ads', (select count(*) from ads where user_id = v_user_id),
    'messages', (select count(*) from messages where user_id = v_user_id or address = p_phone),
    'ledger_entries', (select count(*) from credit_ledger where user_id = v_user_id),
    'ledger_net_cents', (select coalesce(sum(delta), 0) from credit_ledger where user_id = v_user_id),
    'offenses', (select count(*) from offenses where user_id = v_user_id or ad_id = any(v_ad_ids)),
    'chats', coalesce(array_length(v_chat_ids, 1), 0),
    'reveals', (select count(*) from reveal_log where phone = p_phone or ad_id = any(v_ad_ids)),
    'ratings', (select count(*) from ratings where rater_user_id = v_user_id or rated_user_id = v_user_id),
    'sales', (select count(*) from sales where seller_user_id = v_user_id or buyer_user_id = v_user_id),
    'events', (select count(*) from events where owner_phone = p_phone),
    'calls', (select count(*) from call_log where from_phone = p_phone),
    'queued_sends', (select count(*) from digest_outbox where address = p_phone)
  );

  if p_dry_run then
    return v_counts || jsonb_build_object('deleted', false);
  end if;

  -- ---- deletes, children before parents ----

  -- Rows that reference ads WITHOUT a cascade. These must go before the ads
  -- do, or the ad delete fails on a foreign key.
  delete from digest_items where ad_id = any(v_ad_ids);
  delete from offenses where user_id = v_user_id or ad_id = any(v_ad_ids);

  -- reveal_log.ad_id carries no foreign key at all, so orphans would simply
  -- linger and keep inflating the look-up figures. Both directions go: their
  -- look-ups, and look-ups of their ads.
  delete from reveal_log where phone = p_phone or ad_id = any(v_ad_ids);

  -- Ratings and sales reference users directly as well as ads, so the ad
  -- cascade alone would leave the ones attached to OTHER people's ads.
  delete from ratings where rater_user_id = v_user_id or rated_user_id = v_user_id;
  delete from sales where seller_user_id = v_user_id or buyer_user_id = v_user_id;

  -- Chats: messages and reads cascade from the chat row, but rows this member
  -- wrote in OTHER people's chats do not, so clear those explicitly first.
  delete from chat_reads where user_id = v_user_id;
  delete from chat_messages where from_user_id = v_user_id;
  delete from chats where id = any(v_chat_ids);

  -- sms_contexts cascades from ads, but a context pointing AT this member
  -- (they were named as the buyer) hangs off someone else's ad.
  delete from sms_contexts where phone = p_phone or other_phone = p_phone;

  -- Now the ads themselves: ad_photos, bumps, ad_photo_submissions and any
  -- remaining sms_contexts cascade away with them.
  delete from ads where user_id = v_user_id;

  -- Everything else keyed to the person rather than an ad.
  delete from credit_ledger where user_id = v_user_id;
  delete from messages where user_id = v_user_id or address = p_phone;
  delete from digest_outbox where address = p_phone;
  delete from verification_codes where phone = p_phone;
  delete from code_requests where phone = p_phone;
  delete from events where owner_phone = p_phone;
  delete from call_log where from_phone = p_phone;

  -- The account row LAST, and only once nothing references it.
  --
  -- Its user id is deliberately NOT returned to the free pool: migration 9986
  -- retires ids for a year so a number that comes back can't be handed
  -- somebody else's old identity. retired_user_ids is best-effort — if 9986
  -- hasn't been pasted the table doesn't exist, and a purge must not fail
  -- over bookkeeping.
  -- users.user_id is the SIX-DIGIT member id (text); users.id is the uuid the
  -- rest of this function keys on. The alias keeps the insert's target column
  -- and the source column from resolving to each other.
  begin
    insert into retired_user_ids (user_id, retired_at)
    select u.user_id, now() from users u where u.id = v_user_id and u.user_id is not null
    on conflict do nothing;
  exception
    when undefined_table or undefined_column then null;
  end;

  delete from users where id = v_user_id;

  return v_counts || jsonb_build_object('deleted', true);
end;
$$;
