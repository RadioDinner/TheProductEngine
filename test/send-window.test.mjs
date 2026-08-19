// The SMS send window (session 016): ads text out the moment they're
// approved, but only 7am–9pm Monday–Saturday. Boundary math decides whether a
// paid ad goes now or waits until morning, and the label is what the seller
// is promised — both are pure, so both are pinned here.
import { etWeekday, hourLabel, nextSendLabel, smsWindowOpen } from "../lib/digest-engine.ts";

export const name = "send-window";

// America/New_York. August = EDT (UTC-4), so 11:00Z = 7am ET.
const ET = (isoUtc) => new Date(isoUtc);
const SETTINGS = { smsWindowStartHour: 7, smsWindowEndHour: 21, smsQuietDays: [0] };

export function run(t) {
  /* ---- weekday from an ET calendar day ---- */
  t.eq("2026-08-19 is a Wednesday", etWeekday("2026-08-19"), 3);
  t.eq("2026-08-23 is a Sunday", etWeekday("2026-08-23"), 0);
  t.eq("2026-08-22 is a Saturday", etWeekday("2026-08-22"), 6);

  /* ---- the window's edges (Wednesday 2026-08-19) ---- */
  t.eq("6:59am ET — shut", smsWindowOpen(ET("2026-08-19T10:59:00Z"), SETTINGS), false);
  t.eq("7:00am ET — open", smsWindowOpen(ET("2026-08-19T11:00:00Z"), SETTINGS), true);
  t.eq("noon ET — open", smsWindowOpen(ET("2026-08-19T16:00:00Z"), SETTINGS), true);
  t.eq("8:59pm ET — open (end hour is exclusive)", smsWindowOpen(ET("2026-08-19T00:59:00Z"), SETTINGS), true);
  t.eq("9:00pm ET — shut", smsWindowOpen(ET("2026-08-20T01:00:00Z"), SETTINGS), false);
  t.eq("3am ET — shut", smsWindowOpen(ET("2026-08-19T07:00:00Z"), SETTINGS), false);

  /* ---- Sunday never sends, at any hour ---- */
  t.eq("Sunday noon — shut", smsWindowOpen(ET("2026-08-23T16:00:00Z"), SETTINGS), false);
  t.eq("Sunday 10am — shut", smsWindowOpen(ET("2026-08-23T14:00:00Z"), SETTINGS), false);
  t.eq("Saturday noon — open", smsWindowOpen(ET("2026-08-22T16:00:00Z"), SETTINGS), true);

  /* ---- what the seller is told ---- */
  t.eq("mid-window", nextSendLabel(ET("2026-08-19T16:00:00Z"), SETTINGS), "in a few minutes");
  // The 5am poster — the case that prompted this message at all.
  t.eq("5am Wednesday -> later today", nextSendLabel(ET("2026-08-19T09:00:00Z"), SETTINGS), "at 7am");
  t.eq("10pm Wednesday -> tomorrow", nextSendLabel(ET("2026-08-20T02:00:00Z"), SETTINGS), "tomorrow at 7am");
  // Saturday night skips the quiet day entirely rather than promising Sunday.
  t.eq("Saturday 10pm -> Monday", nextSendLabel(ET("2026-08-23T02:00:00Z"), SETTINGS), "Monday at 7am");
  t.eq("Sunday morning -> tomorrow", nextSendLabel(ET("2026-08-23T14:00:00Z"), SETTINGS), "tomorrow at 7am");

  /* ---- the window is operator-editable, so labels must follow it ---- */
  const late = { smsWindowStartHour: 9, smsWindowEndHour: 17, smsQuietDays: [0] };
  t.eq("8am under a 9-5 window — shut", smsWindowOpen(ET("2026-08-19T12:00:00Z"), late), false);
  t.eq("9am under a 9-5 window — open", smsWindowOpen(ET("2026-08-19T13:00:00Z"), late), true);
  t.eq("label follows the setting", nextSendLabel(ET("2026-08-19T12:00:00Z"), late), "at 9am");
  const noQuietDays = { ...SETTINGS, smsQuietDays: [] };
  t.eq("Sunday sends when no day is quiet", smsWindowOpen(ET("2026-08-23T16:00:00Z"), noQuietDays), true);

  /* ---- spoken/written hours ---- */
  t.eq("7 -> 7am", hourLabel(7), "7am");
  t.eq("21 -> 9pm", hourLabel(21), "9pm");
  t.eq("12 -> 12pm", hourLabel(12), "12pm");
  t.eq("0 -> 12am", hourLabel(0), "12am");
  t.eq("13 -> 1pm", hourLabel(13), "1pm");
}
