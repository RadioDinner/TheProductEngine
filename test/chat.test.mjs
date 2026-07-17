// Chat rules (FEATURES items 13–15): the link block reuses the ad content
// filter, every refusal has a friendly note, and the SMS nudge dedup window
// is pure date math (no more ILIKE scans over the message log).
import { hasLink } from "../lib/content-filter.ts";
import {
  CHAT_NUDGE_WINDOW_MS,
  CHAT_PHOTO_CAP,
  CHAT_SEND_NOTES,
  MAX_CHAT_PHOTO_BYTES,
  chatSendNote,
  nudgeWindowOpen,
} from "../lib/chat.ts";

export const name = "chat";

export function run(t) {
  // Link blocking (item 13) — same hasLink the ad pipeline uses.
  t.eq("scheme URL blocked", hasLink("buy it at https://example.com/x"), true);
  t.eq("www host blocked", hasLink("see www.holmes-deals.net for more"), true);
  t.eq("bare domain blocked", hasLink("message me on facebook.com"), true);
  t.eq("price + phone allowed", hasLink("$50. Call 330-600-1834 after 5"), false);
  t.eq("address allowed", hasLink("Pickup at 4880 Township Rd 366, Millersburg"), false);
  t.eq("sentence punctuation allowed", hasLink("Runs great. Needs a battery."), false);

  // Every refusal code carries a member-facing note (no raw codes in the UI).
  for (const code of ["link", "denied", "unsupported", "photocap", "devphotos", "badphoto", "noaddress"]) {
    t.eq(`note for '${code}' exists`, typeof CHAT_SEND_NOTES[code] === "string" && CHAT_SEND_NOTES[code].length > 0, true);
  }
  t.eq("unknown code falls back", chatSendNote("nonsense"), CHAT_SEND_NOTES.unsupported);

  // Pictures in chat (item 14).
  t.eq("per-thread photo cap is a positive integer", Number.isInteger(CHAT_PHOTO_CAP) && CHAT_PHOTO_CAP > 0, true);
  t.eq("photo byte cap matches the shared 8 MB ingest limit", MAX_CHAT_PHOTO_BYTES, 8 * 1024 * 1024);

  // Nudge dedup window math (item 15 — replaces the ILIKE scan).
  const now = Date.parse("2026-07-17T12:00:00Z");
  const hours = (n) => n * 60 * 60 * 1000;
  t.eq("window is one day", CHAT_NUDGE_WINDOW_MS, hours(24));
  t.eq("never nudged → open", nudgeWindowOpen(null, now), true);
  t.eq("nudged 1h ago → closed", nudgeWindowOpen(new Date(now - hours(1)).toISOString(), now), false);
  t.eq("nudged 23h59m ago → closed", nudgeWindowOpen(new Date(now - hours(24) + 60_000).toISOString(), now), false);
  t.eq("nudged exactly 24h ago → open", nudgeWindowOpen(new Date(now - hours(24)).toISOString(), now), true);
  t.eq("nudged 3 days ago → open", nudgeWindowOpen(new Date(now - hours(72)).toISOString(), now), true);
  t.eq("garbage timestamp fails open", nudgeWindowOpen("not-a-date", now), true);
  t.eq("future timestamp (clock skew) → closed", nudgeWindowOpen(new Date(now + hours(1)).toISOString(), now), false);
  t.eq("custom window honored", nudgeWindowOpen(new Date(now - hours(2)).toISOString(), now, hours(1)), true);
}
