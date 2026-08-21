/**
 * Scheduled ADMIN MESSAGES — the operator's own text, to every SMS subscriber
 * (session 020, user request; migration 9952).
 *
 * The user's example is the shape to keep in mind: "Are you liking The Plain
 * Exchange? Feel free to call 330-960-7170 and leave a voice message with
 * feedback! Thank you for being a great part of our community." A note to the
 * community, not an ad — so it is its own message rather than a line riding an
 * ad batch (business sponsors are the thing that rides batches).
 *
 * Three rules, all of them the user's:
 *   1. Every SMS subscriber gets it, individually.
 *   2. It only goes out during ACTIVE HOURS — the same send window ads obey,
 *      Saturday's early close included. Nothing at nine at night, nothing on a
 *      Sunday.
 *   3. It is scheduled: `sendAfter` is the earliest it may go.
 *
 * `sendAfter` is a floor, not an appointment. The window, the five-minute cron
 * tick and the segment budget decide the real moment — so a message scheduled
 * for 6am on a Sunday goes out on Monday morning instead of quietly missing
 * its slot. That is the behaviour to preserve if this ever gets a "send at
 * exactly" mode: an operator who schedules into a closed window must never
 * lose the message.
 *
 * Delivery reuses the digest outbox on purpose. The blocklist, the rolling
 * 24h segment budget, paced release, retries and the resumable drain are all
 * already there and all already correct; a broadcast with its own sending path
 * would have to re-earn every one of them, and would be the one path that
 * forgets the blocklist.
 */
import { gsmSanitize, segmentation } from "@/lib/sms-segments";

/** The most characters an operator may schedule in one broadcast. Four
 * segments to every subscriber is already a real bill; past that it wants to
 * be an ad or an email, not a notice. */
export const ADMIN_MESSAGE_MAX_CHARS = 480;

export interface AdminMessage {
  id: number;
  body: string;
  sendAfter: string;
  status: "scheduled" | "sent" | "canceled";
  recipients: number;
  segments: number;
  sentAt?: string | null;
  createdAt: string;
}

/**
 * Clean an operator's typed message into what will actually be sent.
 *
 * GSM-sanitised for the same reason every other outbound string is: a smart
 * quote pasted from a word processor silently flips the whole message to UCS-2
 * and doubles the bill to every subscriber on the list.
 */
export function normalizeAdminMessage(raw: string): string {
  return gsmSanitize(String(raw ?? "").replace(/\s+/g, " ").trim()).slice(
    0,
    ADMIN_MESSAGE_MAX_CHARS,
  );
}

/** What one broadcast will cost, in billed segments, before it is sent. The
 * admin page shows this next to the compose box — the operator should know
 * they are about to buy 400 × 2 segments BEFORE they press the button. */
export function broadcastCost(
  body: string,
  subscribers: number,
): { segmentsEach: number; segmentsTotal: number; encoding: "gsm" | "ucs2" } {
  const seg = segmentation(body);
  return {
    segmentsEach: seg.segments,
    segmentsTotal: seg.segments * Math.max(0, subscribers),
    encoding: seg.encoding,
  };
}

/**
 * Is this message due to be composed right now?
 *
 * Pure, so every boundary is testable without a clock or a database: due means
 * scheduled, past its send-after time, AND inside the send window. The window
 * check is the user's "only during active hours" — and it is checked HERE, at
 * compose, as well as at drain, so a broadcast is never even built outside
 * hours. Building it early would stamp a paced-release schedule across time
 * nothing could send in.
 */
export function adminMessageDue(
  message: Pick<AdminMessage, "status" | "sendAfter">,
  now: Date,
  windowOpen: boolean,
): boolean {
  if (message.status !== "scheduled") return false;
  if (!windowOpen) return false;
  const after = Date.parse(message.sendAfter);
  if (!Number.isFinite(after)) return true; // unparseable: send, don't strand
  return now.getTime() >= after;
}

/**
 * The outbox slot key for a broadcast. One key per message id, so composing
 * the same message twice is a no-op at the digest layer and a cron tick that
 * overlaps its predecessor cannot double-send to four hundred people.
 */
export function adminMessageSlotKey(id: number): string {
  return `admin#${id}`;
}
