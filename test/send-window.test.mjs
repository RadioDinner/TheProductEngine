// The SMS send window. Session 016 set it up (each ad texts the moment it is
// approved, inside a daily window); session 020 moved the published close from
// 9pm to 6pm and gave SATURDAY its own, earlier close — 5pm, deliberately
// unpublished. Boundary math decides whether a paid ad goes now or waits until
// Monday, and the labels are what a seller is promised, so both are pinned here.
import {
  closedEarly,
  etWeekday,
  hourLabel,
  nextSendLabel,
  operatorWindowLabel,
  saturdayClosesEarly,
  smsWindowOpen,
  windowEndHourFor,
} from "../lib/digest-engine.ts";

export const name = "send-window";

// America/New_York. August = EDT (UTC-4), so 11:00Z = 7am ET.
const ET = (isoUtc) => new Date(isoUtc);
// The shipped defaults: published 7am–6pm, Saturday really stops at 5pm.
const SETTINGS = {
  smsWindowStartHour: 7,
  smsWindowEndHour: 18,
  smsSaturdayEndHour: 17,
  smsQuietDays: [0],
};

export function run(t) {
  /* ---- weekday from an ET calendar day ---- */
  t.eq("2026-08-19 is a Wednesday", etWeekday("2026-08-19"), 3);
  t.eq("2026-08-23 is a Sunday", etWeekday("2026-08-23"), 0);
  t.eq("2026-08-22 is a Saturday", etWeekday("2026-08-22"), 6);

  /* ---- the window's edges (Wednesday 2026-08-19) ---- */
  t.eq("6:59am ET — shut", smsWindowOpen(ET("2026-08-19T10:59:00Z"), SETTINGS), false);
  t.eq("7:00am ET — open", smsWindowOpen(ET("2026-08-19T11:00:00Z"), SETTINGS), true);
  t.eq("noon ET — open", smsWindowOpen(ET("2026-08-19T16:00:00Z"), SETTINGS), true);
  t.eq("5:59pm ET — open (end hour is exclusive)", smsWindowOpen(ET("2026-08-19T21:59:00Z"), SETTINGS), true);
  t.eq("6:00pm ET — shut", smsWindowOpen(ET("2026-08-19T22:00:00Z"), SETTINGS), false);
  t.eq("8pm ET — shut (the old 9pm close is gone)", smsWindowOpen(ET("2026-08-20T00:00:00Z"), SETTINGS), false);
  t.eq("3am ET — shut", smsWindowOpen(ET("2026-08-19T07:00:00Z"), SETTINGS), false);

  /* ---- Sunday never sends, at any hour ---- */
  t.eq("Sunday noon — shut", smsWindowOpen(ET("2026-08-23T16:00:00Z"), SETTINGS), false);
  t.eq("Sunday 10am — shut", smsWindowOpen(ET("2026-08-23T14:00:00Z"), SETTINGS), false);

  /* ---- Saturday closes an hour early (2026-08-22) ---- */
  t.eq("Saturday noon — open", smsWindowOpen(ET("2026-08-22T16:00:00Z"), SETTINGS), true);
  t.eq("Saturday 4:59pm — open", smsWindowOpen(ET("2026-08-22T20:59:00Z"), SETTINGS), true);
  t.eq("Saturday 5:00pm — SHUT, an hour before the published close",
    smsWindowOpen(ET("2026-08-22T21:00:00Z"), SETTINGS), false);
  t.eq("Saturday 5:30pm — shut", smsWindowOpen(ET("2026-08-22T21:30:00Z"), SETTINGS), false);
  // The same clock hour on a weekday still sends — the shortening is Saturday's alone.
  t.eq("Friday 5:30pm — still open", smsWindowOpen(ET("2026-08-21T21:30:00Z"), SETTINGS), true);

  /* ---- the per-weekday close ---- */
  t.eq("Monday closes at the published hour", windowEndHourFor(1, SETTINGS), 18);
  t.eq("Friday closes at the published hour", windowEndHourFor(5, SETTINGS), 18);
  t.eq("Saturday closes early", windowEndHourFor(6, SETTINGS), 17);
  t.eq("Saturday is flagged as closing early", saturdayClosesEarly(SETTINGS), true);

  // The Saturday hour may only ever SHORTEN Saturday. A later value (a
  // fat-fingered 20 on Settings) is pulled back to the published close, because
  // texting past the published hours breaks a promise the shortening never
  // needed to touch.
  const overrun = { ...SETTINGS, smsSaturdayEndHour: 20 };
  t.eq("a LATER Saturday hour is clamped to the published close", windowEndHourFor(6, overrun), 18);
  t.eq("clamped means Saturday is not 'closing early'", saturdayClosesEarly(overrun), false);
  t.eq("7pm Saturday stays shut even with a 8pm setting",
    smsWindowOpen(ET("2026-08-22T23:00:00Z"), overrun), false);

  // Settings saved before session 020 have no Saturday hour at all: Saturday
  // then simply runs to the published close, never "closed all day".
  const legacy = { smsWindowStartHour: 7, smsWindowEndHour: 18, smsQuietDays: [0] };
  t.eq("no Saturday hour set — Saturday runs to the published close",
    windowEndHourFor(6, legacy), 18);
  t.eq("no Saturday hour set — 5:30pm Saturday still sends",
    smsWindowOpen(ET("2026-08-22T21:30:00Z"), legacy), true);
  // Equal hours = the shortening is switched off, the documented way to do it.
  const noShortening = { ...SETTINGS, smsSaturdayEndHour: 18 };
  t.eq("Saturday hour equal to the published one turns the shortening off",
    saturdayClosesEarly(noShortening), false);

  /* ---- closedEarly: the hour copy must not quote the published window ---- */
  t.eq("Saturday 5:30pm — closed EARLY", closedEarly(ET("2026-08-22T21:30:00Z"), SETTINGS), true);
  t.eq("Saturday 4:30pm — still open, not closed early",
    closedEarly(ET("2026-08-22T20:30:00Z"), SETTINGS), false);
  t.eq("Saturday 6:30pm — shut, but the published window agrees",
    closedEarly(ET("2026-08-22T22:30:00Z"), SETTINGS), false);
  t.eq("Friday 5:30pm — open, nothing to hide", closedEarly(ET("2026-08-21T21:30:00Z"), SETTINGS), false);
  t.eq("Friday 6:30pm — shut on the published hour", closedEarly(ET("2026-08-21T22:30:00Z"), SETTINGS), false);
  t.eq("Saturday 5am — before opening, not closed early",
    closedEarly(ET("2026-08-22T09:00:00Z"), SETTINGS), false);
  t.eq("Sunday is quiet, never 'closed early'", closedEarly(ET("2026-08-23T21:30:00Z"), SETTINGS), false);
  t.eq("no Saturday hour set — nothing is ever closed early",
    closedEarly(ET("2026-08-22T21:30:00Z"), legacy), false);

  /* ---- what the seller is told ---- */
  t.eq("mid-window", nextSendLabel(ET("2026-08-19T16:00:00Z"), SETTINGS), "in a few minutes");
  // The 5am poster — the case that prompted this message at all.
  t.eq("5am Wednesday -> later today", nextSendLabel(ET("2026-08-19T09:00:00Z"), SETTINGS), "at 7am");
  t.eq("7pm Wednesday -> tomorrow", nextSendLabel(ET("2026-08-19T23:00:00Z"), SETTINGS), "tomorrow at 7am");
  // Saturday night skips the quiet day entirely rather than promising Sunday —
  // and now that starts at five, not nine.
  t.eq("Saturday 5:30pm -> Monday", nextSendLabel(ET("2026-08-22T21:30:00Z"), SETTINGS), "Monday at 7am");
  t.eq("Saturday 10pm -> Monday", nextSendLabel(ET("2026-08-23T02:00:00Z"), SETTINGS), "Monday at 7am");
  t.eq("Sunday morning -> tomorrow", nextSendLabel(ET("2026-08-23T14:00:00Z"), SETTINGS), "tomorrow at 7am");

  /* ---- the operator's label tells the truth; nothing else does ---- */
  t.eq("operator label spells Saturday out", operatorWindowLabel(SETTINGS), "7am–6pm Mon–Fri · 7am–5pm Sat");
  t.eq("no shortening -> the plain label", operatorWindowLabel(legacy), "7am–6pm, Mon–Sat");
  t.eq("a clamped overrun reads as no shortening", operatorWindowLabel(overrun), "7am–6pm, Mon–Sat");

  /* ---- the window is operator-editable, so labels must follow it ---- */
  const late = { smsWindowStartHour: 9, smsWindowEndHour: 17, smsQuietDays: [0] };
  t.eq("8am under a 9-5 window — shut", smsWindowOpen(ET("2026-08-19T12:00:00Z"), late), false);
  t.eq("9am under a 9-5 window — open", smsWindowOpen(ET("2026-08-19T13:00:00Z"), late), true);
  t.eq("label follows the setting", nextSendLabel(ET("2026-08-19T12:00:00Z"), late), "at 9am");
  const noQuietDays = { ...SETTINGS, smsQuietDays: [] };
  t.eq("Sunday sends when no day is quiet", smsWindowOpen(ET("2026-08-23T16:00:00Z"), noQuietDays), true);

  /* ---- spoken/written hours ---- */
  t.eq("7 -> 7am", hourLabel(7), "7am");
  t.eq("17 -> 5pm", hourLabel(17), "5pm");
  t.eq("18 -> 6pm", hourLabel(18), "6pm");
  t.eq("21 -> 9pm", hourLabel(21), "9pm");
  t.eq("12 -> 12pm", hourLabel(12), "12pm");
  t.eq("0 -> 12am", hourLabel(0), "12am");
  t.eq("13 -> 1pm", hourLabel(13), "1pm");
}
