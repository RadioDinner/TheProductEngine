-- ============================================================
-- The Plain Exchange — batched ads with numbered pictures (session 018)
--
-- ⚠️ USER MUST PASTE THIS into the Supabase SQL Editor. Never `supabase db
-- push` — the CLI applies in ascending order, which under this repo's
-- DESCENDING scheme (new_session_instructions.md §4) is newest-first.
--
-- Re-runnable: every statement is add-if-not-exists / create-if-not-exists /
-- an idempotent config upsert, so pasting it twice is harmless.
--
-- ────────────────────────────────────────────────────────────
-- WHAT CHANGES, AND WHY
-- ────────────────────────────────────────────────────────────
-- Ads go out in BATCHES again (user decision, after a competitor's): one text
-- listing several ads by AD NUMBER, then one picture message per picture ad,
-- each picture carrying its ad number burned into the bottom-right corner.
-- Session 016's one-text-per-ad instant send is retired.
--
-- 1. digests.slot_key — the identity a batch is composed under.
--
--    Until now a digest's identity was its scheduled_for timestamp, and the
--    slot key was squeezed into one: "2026-08-20#7" became the timestamp
--    2026-08-20T07:00:00Z. That works for a key built from a calendar day and
--    an hour. It does NOT work for anything else, and session 016 quietly
--    started passing something else: the per-ad key "ad#1022" turned into the
--    string "adT1022:00:00Z", which Postgres rejects as a timestamp. Every
--    instant-send compose therefore threw in production while working
--    perfectly against the development file store, which keys on the raw
--    string. Ads paused for the pre-launch hold is the only reason this was
--    not noticed.
--
--    A batch has the same problem with an extra twist: two batches can fall
--    inside the same hour, so an hour-shaped identity would silently treat the
--    second as "already sent". So the slot key gets its own column and its own
--    uniqueness, and scheduled_for goes back to being an ordinary timestamp.
--
-- 2. photos_in_broadcast = true — each picture ad's photo rides its batch.
--
--    It has been false since it was introduced (an MMS to every subscriber is
--    the most expensive thing this service sends). The user's decision is that
--    a picture ad is the premium product and the picture has to be seen. Only
--    the FIRST picture goes out; PIC pulls up to two more on request.
--
-- 3. batch_min_ads / batch_max_wait_minutes — when a batch goes out.
--    "Every hour, or as soon as I have 3 or 4 ads" (user), whichever first.
--
-- 4. digest_daily_segment_budget raised — pictures now cost against it.
--    A picture message counts as 3 segments (MMS_SEGMENT_COST in
--    lib/digest-engine.ts, roughly Telnyx's own MMS-to-segment ratio). At the
--    old 12,000 the breaker would have tripped most days and halted sending,
--    which is a stopper, not a safety net. 40,000 leaves headroom for a few
--    hundred subscribers taking several batches a day, and is still a hard
--    ceiling on a runaway.
--
-- UNTIL THIS IS PASTED: everything still works. createDigestIfAbsent detects
-- the missing column, logs once, and falls back to a synthetic (valid)
-- scheduled_for identity — which also fixes the "adT1022" crash above. The
-- three config values fall back to the code defaults in lib/config.ts, which
-- already carry the new values. /api/health reports `migration9960`.
-- ============================================================

-- ---------- 1. the batch's identity ----------

alter table digests add column if not exists slot_key text;

-- Unique per channel, and only for rows that have one: every digest written
-- before this migration keeps its scheduled_for identity and is untouched.
create unique index if not exists digests_slot_key_idx
  on digests (channel, slot_key)
  where slot_key is not null;

comment on column digests.slot_key is
  'The composition key a batch was built under (batch#<head ad>#<head bump>, or <day>#<hour> for an email edition). Identity: composing the same key twice is a no-op.';

-- ---------- 2-4. settings ----------

-- Pictures ride the batch. This one IS the change, and the stored row says
-- false, so it is overwritten rather than left alone.
insert into config (key, value) values ('photos_in_broadcast', 'true')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- The two new triggers. do-nothing: once the operator tunes them on
-- /admin/settings, re-pasting this file must not undo that.
insert into config (key, value) values
  ('batch_min_ads', '3'),
  ('batch_max_wait_minutes', '60')
on conflict (key) do nothing;

-- Raise the cost breaker ONLY while it still holds the pre-picture default.
-- A conditional update rather than an upsert for the same reason: an operator
-- who has since set their own ceiling keeps it, however often this is pasted.
update config
   set value = '40000', updated_at = now()
 where key = 'digest_daily_segment_budget'
   and value = '12000';
