-- 9968 — the three-way pause mode became two independent switches.
--
-- Was: pause_mode = 'off' | 'bulk' | 'all'. Now (user decision, session 016):
--
--   ads_paused       no ad goes out; approved ads queue and ride when it
--                    clears, nothing is dropped
--   outbound_paused  member-facing NON-ad messages stop (command replies,
--                    PIC pictures, moderation notices) while ADS KEEP GOING —
--                    "I want the ads still to go off" — and so do critical
--                    sends: sign-in codes, operator alerts, and the outage
--                    notice subscribers get when a switch is turned on.
--
-- Both default to false in code, so the absent keys already read as "not
-- paused"; this only retires the row that no longer means anything.
--
-- Re-runnable.

delete from config where key = 'pause_mode';
