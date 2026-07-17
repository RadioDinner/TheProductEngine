/**
 * Pure chat rules shared by the server actions, the thread UI, and the unit
 * tests (FEATURES items 13–15). No IO here — keep this importable from client
 * components.
 */

/** Chat messages match the SMS-side cap: 1000 characters. */
export const CHAT_MAX_BODY = 1000;

/** Friendly notes for every way a send can be refused (item 13/14). */
export const CHAT_SEND_NOTES: Record<string, string> = {
  link: "Links can't be sent in chat — spell out the details in plain words instead.",
  denied: "That didn't go through — this conversation isn't available to you.",
  unsupported: "Messaging isn't available just yet — please try again later.",
  empty: "Write a message first.",
  photocap: "This conversation is at its picture limit — describe it in words instead.",
  devphotos: "Pictures need the live site — this development copy has nowhere to store them.",
  badphoto: "That file didn't look like a picture we can accept (jpg, png, gif, or webp up to 8 MB).",
  noaddress: "You haven't saved a pickup address yet — add one under Profile on your account page first.",
};

export function chatSendNote(code: string): string {
  return CHAT_SEND_NOTES[code] ?? CHAT_SEND_NOTES.unsupported;
}
