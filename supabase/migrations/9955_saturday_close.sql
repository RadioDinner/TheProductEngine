-- 9955 — the send window moves to 7am–6pm, and Saturday closes at 5
--        (session 020, user decision)
--
-- WHY
-- ---
-- Community advice the user brought back: "9pm is way too late to send ads on
-- Saturday nights, and 6 would work for the week days." A Plain household's
-- Saturday evening runs into the rest day, and a 9pm text lands in the middle
-- of it.
--
-- The user went one step further than the advice, and the two halves are
-- deliberately different numbers:
--
--   PUBLISHED: "I'll publish that the ads run 7am to 6pm Monday to Saturday"
--   ACTUAL:    "but I want to secretly stop sending ads by 5pm on Saturdays"
--
-- So 6pm is the promise every member-facing page and every compliance line
-- makes, and 5pm is what Saturday really does. Under-delivering on the
-- published hours is safe; over-delivering would not be, which is why
-- windowEndHourFor() in lib/digest-engine.ts clamps the Saturday hour so it
-- can only ever pull the close EARLIER than the published one.
--
-- WHAT
-- ----
-- 1. sms_window_end_hour: 21 -> 18. End EXCLUSIVE, so the last weekday text
--    leaves at 5:59pm. This is the PUBLISHED end, and member-facing copy reads
--    it straight out of this row.
--
-- 2. sms_saturday_end_hour: new, 17. End EXCLUSIVE, so the last Saturday text
--    leaves at 4:59pm. Editable on /admin/settings; set it equal to
--    sms_window_end_hour to run Saturday like any other day.
--
-- Nothing else changes: the 7am open, the Sunday quiet day and the email
-- edition times are all untouched. The window is an SMS rule only — email
-- rows have always been exempt from it ("an inbox has no bedtime").
--
-- RE-RUNNABLE
-- -----------
-- The end-hour update is guarded on the OLD value, so a re-paste after the
-- operator has since chosen their own hour on /admin/settings leaves that
-- choice alone instead of stamping 18 back over it. The new row is a plain
-- on-conflict-do-nothing insert.

-- The published close: 9pm -> 6pm, only while the row still holds the old 9pm.
update config
   set value = '18'::jsonb,
       updated_at = now()
 where key = 'sms_window_end_hour'
   and value = '21'::jsonb;

-- Saturday's real, unpublished close.
--
-- NOTE, because it is the opposite of what you would guess: DELETING this row
-- does NOT turn the shortening off. getEngineSettings falls back to the code
-- default in lib/config.ts (17) for any config key with no row, so an absent
-- row leaves Saturday closing at 5pm — which is why the shortening is live the
-- moment the code deploys, migration or no migration. The row exists so the
-- hour is EDITABLE on /admin/settings, not so it can be switched off by
-- removal. To run Saturday full hours, set this to the same value as
-- sms_window_end_hour.
insert into config (key, value) values
  ('sms_saturday_end_hour', '17')
on conflict (key) do nothing;
