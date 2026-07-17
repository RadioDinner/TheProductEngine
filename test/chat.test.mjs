// Chat rules (FEATURES items 13–15): the link block reuses the ad content
// filter, every refusal has a friendly note, and the SMS nudge dedup window
// is pure date math (no more ILIKE scans over the message log).
import { hasLink } from "../lib/content-filter.ts";
import { CHAT_SEND_NOTES, chatSendNote } from "../lib/chat.ts";

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
}
