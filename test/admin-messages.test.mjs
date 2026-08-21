// Scheduled ADMIN BROADCASTS (session 020, migration 9952) — the operator's own
// text to every SMS subscriber. Three rules, all the user's: everyone gets it
// individually, it only goes out during active hours, and it is scheduled.
// The pure parts of that are pinned here.
import {
  ADMIN_MESSAGE_MAX_CHARS,
  adminMessageDue,
  adminMessageSlotKey,
  broadcastCost,
  normalizeAdminMessage,
} from "../lib/admin-messages.ts";

export const name = "admin-messages";

const at = (iso) => new Date(iso);
const scheduled = (sendAfter) => ({ status: "scheduled", sendAfter });

export function run(t) {
  /* ---- "only during active hours" is the load-bearing rule ---- */
  const due = scheduled("2026-08-19T12:00:00Z");
  t.eq("due, and the window is open -> sends",
    adminMessageDue(due, at("2026-08-19T16:00:00Z"), true), true);
  t.eq("due, but the window is SHUT -> waits",
    adminMessageDue(due, at("2026-08-19T16:00:00Z"), false), false);
  t.eq("window open but not due yet -> waits",
    adminMessageDue(scheduled("2026-08-25T12:00:00Z"), at("2026-08-19T16:00:00Z"), true), false);
  // A message scheduled into a closed window is NOT lost — it goes the next
  // time the window opens. That is why the field reads "no earlier than".
  t.eq("scheduled into a Sunday, sent when the window next opens",
    adminMessageDue(scheduled("2026-08-23T12:00:00Z"), at("2026-08-24T11:00:00Z"), true), true);

  /* ---- a sent or canceled message never goes again ---- */
  t.eq("already sent -> never again",
    adminMessageDue({ status: "sent", sendAfter: "2026-08-19T12:00:00Z" }, at("2026-08-19T16:00:00Z"), true), false);
  t.eq("canceled -> never",
    adminMessageDue({ status: "canceled", sendAfter: "2026-08-19T12:00:00Z" }, at("2026-08-19T16:00:00Z"), true), false);

  /* ---- an unparseable time sends rather than stranding the message ---- */
  t.eq("junk send-after sends rather than stranding",
    adminMessageDue(scheduled("not a date"), at("2026-08-19T16:00:00Z"), true), true);

  /* ---- one key per message: composing twice is a no-op, so an overlapping
   * cron tick cannot text four hundred people twice ---- */
  t.eq("slot key is per message", adminMessageSlotKey(7), "admin#7");
  t.eq("different messages, different keys",
    adminMessageSlotKey(7) !== adminMessageSlotKey(8), true);

  /* ---- what it costs, before it is sent ---- */
  const short = broadcastCost("Thanks for being part of the community!", 400);
  t.eq("a short message is one segment each", short.segmentsEach, 1);
  t.eq("...times the list", short.segmentsTotal, 400);
  t.eq("...and stays GSM", short.encoding, "gsm");
  const long = broadcastCost("x".repeat(200), 400);
  t.eq("past 160 characters it is two segments each", long.segmentsEach, 2);
  t.eq("...which doubles the bill", long.segmentsTotal, 800);
  t.eq("an empty list costs nothing", broadcastCost("hello", 0).segmentsTotal, 0);
  t.eq("a negative count cannot go negative", broadcastCost("hello", -5).segmentsTotal, 0);

  /* ---- normalizing: a pasted smart quote must not double the bill ---- */
  t.eq("collapses whitespace", normalizeAdminMessage("  hello   there \n friend "), "hello there friend");
  t.eq("a smart quote is flattened, so the message stays GSM",
    broadcastCost(normalizeAdminMessage("Don’t miss it"), 1).encoding, "gsm");
  t.eq("...and that is the whole point — raw, it would be UCS-2",
    broadcastCost("Don’t miss it", 1).encoding, "ucs2");
  t.eq("clamped to the cap", normalizeAdminMessage("y".repeat(999)).length, ADMIN_MESSAGE_MAX_CHARS);
  t.eq("empty stays empty", normalizeAdminMessage("   "), "");
}
