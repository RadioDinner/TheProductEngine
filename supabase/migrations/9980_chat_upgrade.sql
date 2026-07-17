-- ============================================================
-- 9980 — chat upgrade (FEATURES.md items 13, 14 & 15, session 009)
--
-- Item 13 (modern chat threads): members can report a message for operator
--   review (report state lives on the message row), and every chat message is
--   now copied into the `messages` audit log — which needs a 'chat' value on
--   the message_channel enum. This deliberately REVERSES the session-008
--   decision to keep chat out of the admin log: an operator asked to act on a
--   reported conversation has to be able to read it (documented on /admin/help).
--
-- Item 14 (pictures in chat): chat_messages.photo carries a re-hosted storage
--   URL (same byte-sniffed ingest as every other picture). Chat pictures live
--   on the WEBSITE ONLY — they never ride an outbound SMS.
--
-- Item 15 (messaging performance): send_chat() collapses the whole send path
--   (membership check + insert + thread bump + own-read watermark + other-
--   party lookup + audit copy) into ONE round trip, and users.chat_nudged_at
--   replaces the ILIKE body scan the nudge dedup used to run over `messages`.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- NOTE: the new enum value is added but never USED by another statement in
-- this same paste (Postgres forbids using a value added in the current
-- transaction) — send_chat only references it at call time, which is fine.
-- ============================================================

-- ---------- item 13: audit log channel ----------

alter type message_channel add value if not exists 'chat';

-- ---------- item 13: report-a-message ----------

alter table chat_messages add column if not exists reported_at timestamptz;
alter table chat_messages add column if not exists reported_by uuid references users (id);
alter table chat_messages add column if not exists report_resolved_at timestamptz;
alter table chat_messages add column if not exists report_resolution text; -- 'resolved' | 'dismissed'

-- The operator queue reads open reports only.
create index if not exists chat_messages_reported_idx
  on chat_messages (reported_at desc)
  where reported_at is not null and report_resolved_at is null;

-- ---------- item 14: pictures in chat ----------

alter table chat_messages add column if not exists photo text;

-- ---------- item 15: nudge dedup without the ILIKE scan ----------

alter table users add column if not exists chat_nudged_at timestamptz;

-- ---------- item 15: the send path in one round trip ----------
--
-- Returns jsonb (style of reserve_pic_quota):
--   { outcome: 'denied' }                          not a member / no such chat
--   { outcome: 'photocap' }                        thread already holds p_photo_cap pictures
--   { outcome: 'sent', id, at,                     the inserted message
--     other_phone, other_nudged_at }               for the post-send SMS nudge
--
-- The audit copy into `messages` happens here too, so the app's fallback
-- (pre-9980 multi-query path) is the only place that still audits from JS.
create or replace function send_chat(
  p_chat_id   bigint,
  p_phone     text,
  p_body      text,
  p_photo     text default null,
  p_photo_cap int  default 30
) returns jsonb
language plpgsql
as $$
declare
  v_user         uuid;
  v_chat         chats%rowtype;
  v_msg_id       bigint;
  v_msg_at       timestamptz;
  v_other        uuid;
  v_other_phone  text;
  v_other_nudged timestamptz;
begin
  select id into v_user from users where phone = p_phone;
  if v_user is null then
    return jsonb_build_object('outcome', 'denied');
  end if;

  select * into v_chat from chats where id = p_chat_id;
  if v_chat.id is null or (v_chat.a_user_id <> v_user and v_chat.b_user_id <> v_user) then
    return jsonb_build_object('outcome', 'denied');
  end if;

  -- Item 14: per-thread picture cap (p_photo_cap <= 0 turns the cap off).
  if p_photo is not null and p_photo_cap > 0 then
    if (select count(*) from chat_messages
          where chat_id = p_chat_id and photo is not null) >= p_photo_cap then
      return jsonb_build_object('outcome', 'photocap');
    end if;
  end if;

  insert into chat_messages (chat_id, from_user_id, body, photo)
    values (p_chat_id, v_user, p_body, p_photo)
    returning id, created_at into v_msg_id, v_msg_at;

  update chats set last_message_at = now() where id = p_chat_id;

  -- Your own send marks the thread read for you.
  insert into chat_reads (chat_id, user_id, last_read_message_id)
    values (p_chat_id, v_user, v_msg_id)
    on conflict (chat_id, user_id)
      do update set last_read_message_id = excluded.last_read_message_id;

  v_other := case when v_chat.a_user_id = v_user then v_chat.b_user_id
                  else v_chat.a_user_id end;
  select phone, chat_nudged_at into v_other_phone, v_other_nudged
    from users where id = v_other;

  -- Item 13: audit copy — every chat message lands in the operator's log.
  insert into messages (direction, channel, user_id, address, body, media)
    values ('inbound', 'chat', v_user, p_phone, p_body,
            case when p_photo is null then null else to_jsonb(array[p_photo]) end);

  return jsonb_build_object(
    'outcome',         'sent',
    'id',              v_msg_id,
    'at',              v_msg_at,
    'other_phone',     coalesce(v_other_phone, ''),
    'other_nudged_at', v_other_nudged
  );
end;
$$;
