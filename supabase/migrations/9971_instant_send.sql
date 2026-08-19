-- 9971 — ads send the moment they're approved (session 016, user decision).
--
-- SMS stops being a batched digest: an approved ad is texted immediately, one
-- text per ad, inside a daily window (7am–9pm ET, Monday–Saturday). The
-- DIGEST survives for EMAIL only — "if I send an email every time an ad is
-- listed, it'll get spammy."
--
-- Two things this needs:
--   1. ads.emailed_at — the email edition used to mirror an SMS slot digest
--      (getSmsDigestAdIds). With no SMS slots left to mirror, each email
--      edition instead carries the ads already TEXTED but not yet emailed,
--      and stamps them here. Null = still owed an email.
--   2. the window config rows, so the hours are operator-editable on
--      /admin/settings like every other tunable.
--
-- Re-runnable: guarded column, upserted config.

alter table ads add column if not exists emailed_at timestamptz;

-- The email pass asks for "texted, not yet emailed" every slot.
create index if not exists ads_emailed_at_idx
  on ads (emailed_at)
  where emailed_at is null;

-- Picture ads now BROADCAST their photo (user decision, session 016): the ad
-- and its picture arrive together as MMS instead of "Reply PIC 12". PIC stays
-- alive as a command for looking again, it just leaves the marketing copy.
alter table digest_outbox add column if not exists media text[];

-- A picture ad must not reach the review queue while more pictures may still
-- be coming: it waits for the combine window to go quiet (10 minutes) or for
-- the 4-picture maximum. Null = nothing to wait for (text ads, older rows).
alter table ads add column if not exists photos_settle_at timestamptz;

-- Send window. Hours are America/New_York, start inclusive, end EXCLUSIVE:
-- 7..21 means the last text can go out at 8:59pm.
insert into config (key, value) values
  ('sms_window_start_hour', '7'),
  ('sms_window_end_hour', '21'),
  -- Days that never send, 0 = Sunday. The Plain community's rest day; ads
  -- approved on a quiet day wait for the next open morning.
  ('sms_quiet_days', '[0]')
on conflict (key) do nothing;
