// Town hall events board (FEATURES item 18, v1): event-date validation, the
// upcoming filter/sort (nearest first; past events auto-drop with no cron),
// and the no-links rule reusing the ad content filter.
import { hasLink } from "../lib/content-filter.ts";
import {
  EVENT_MAX_DAYS_AHEAD,
  daysBetween,
  eventDateVerdict,
  formatEventDay,
  isValidEventDay,
  upcomingEvents,
} from "../lib/town-hall.ts";

export const name = "town-hall";

export function run(t) {
  // Strict YYYY-MM-DD, real calendar days only.
  t.eq("plain day valid", isValidEventDay("2026-08-02"), true);
  t.eq("leap day valid", isValidEventDay("2028-02-29"), true);
  t.eq("non-leap Feb 29 invalid", isValidEventDay("2026-02-29"), false);
  t.eq("month 13 invalid", isValidEventDay("2026-13-01"), false);
  t.eq("day 32 invalid", isValidEventDay("2026-07-32"), false);
  t.eq("US format invalid", isValidEventDay("07/20/2026"), false);
  t.eq("garbage invalid", isValidEventDay("next Saturday"), false);
  t.eq("empty invalid", isValidEventDay(""), false);

  t.eq("daysBetween forward", daysBetween("2026-07-17", "2026-07-20"), 3);
  t.eq("daysBetween across DST", daysBetween("2026-10-30", "2026-11-02"), 3);
  t.eq("daysBetween backward", daysBetween("2026-07-17", "2026-07-16"), -1);

  // Submission verdicts, seen from ET-today.
  const today = "2026-07-17";
  t.eq("today is ok", eventDateVerdict("2026-07-17", today), "ok");
  t.eq("tomorrow is ok", eventDateVerdict("2026-07-18", today), "ok");
  t.eq("yesterday is past", eventDateVerdict("2026-07-16", today), "past");
  t.eq("bad date is invalid", eventDateVerdict("2026-02-30", today), "invalid");
  t.eq(
    "exactly a year out is ok",
    eventDateVerdict("2027-07-17", today),
    "ok",
  );
  t.eq(
    "past the year window is toofar",
    eventDateVerdict("2027-07-19", today),
    "toofar",
  );
  t.eq("window constant sane", EVENT_MAX_DAYS_AHEAD, 366);

  // Display rule: approved events sort nearest-first, past ones auto-drop.
  const board = [
    { id: 4, eventDate: "2026-08-01" },
    { id: 1, eventDate: "2026-07-16" }, // yesterday — must drop
    { id: 3, eventDate: "2026-07-17" }, // today — still shows
    { id: 2, eventDate: "2026-08-01" }, // same day as #4 — submission order
    { id: 5, eventDate: "2026-07-20" },
  ];
  t.eq(
    "upcoming: past dropped, nearest first, id breaks ties",
    upcomingEvents(board, today).map((e) => e.id),
    [3, 5, 2, 4],
  );
  t.eq("all past → empty board", upcomingEvents(board, "2027-01-01"), []);
  t.eq("input order untouched", board.map((e) => e.id), [4, 1, 3, 2, 5]);

  // Day rendering is pure calendar math — no timezone can shift the day.
  t.eq("formatEventDay", formatEventDay("2026-08-01"), "Sat, Aug 1");
  t.eq("formatEventDay new year", formatEventDay("2027-01-01"), "Fri, Jan 1");

  // The v1 content rule: NO links in event text (stricter than ads' flag).
  t.eq("event link caught", hasLink("Sign up at www.benefit-supper.com"), true);
  t.eq("plain event text fine", hasLink("Supper 4-7 pm. Call 330-600-1834."), false);
}
