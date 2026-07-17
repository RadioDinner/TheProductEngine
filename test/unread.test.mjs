// Unread-chat count behind the header badge (FEATURES item 12) — the shared
// watermark math both stores feed (lib/unread.ts).
import { unreadChatCount } from "../lib/unread.ts";

export const name = "unread";

// Chats I belong to, with my last-read message id per chat.
const myChats = (entries) => new Map(entries);
const msg = (chatId, id, fromOther) => ({ chatId, id, fromOther });

export function run(t) {
  // Empty worlds.
  t.eq("no chats, no messages", unreadChatCount([], myChats([])), 0);
  t.eq("chats but no messages", unreadChatCount([], myChats([[1, 0]])), 0);

  // The basic unread: other party's message above my watermark.
  t.eq("other above watermark = unread", unreadChatCount([msg(1, 5, true)], myChats([[1, 0]])), 1);
  t.eq("other at watermark = read", unreadChatCount([msg(1, 5, true)], myChats([[1, 5]])), 0);
  t.eq("other below watermark = read", unreadChatCount([msg(1, 4, true)], myChats([[1, 5]])), 0);

  // My own sends never count, however new.
  t.eq("own send never unread", unreadChatCount([msg(1, 9, false)], myChats([[1, 0]])), 0);
  t.eq(
    "own send after their read one stays read",
    unreadChatCount([msg(1, 9, false), msg(1, 5, true)], myChats([[1, 5]])),
    0,
  );

  // Chats count once no matter how many unread messages pile up.
  t.eq(
    "three unread messages, one chat",
    unreadChatCount([msg(1, 3, true), msg(1, 4, true), msg(1, 5, true)], myChats([[1, 0]])),
    1,
  );

  // Distinct chats each count.
  t.eq(
    "two chats unread, one read",
    unreadChatCount(
      [msg(1, 5, true), msg(2, 7, true), msg(3, 2, true)],
      myChats([
        [1, 0],
        [2, 0],
        [3, 2],
      ]),
    ),
    2,
  );

  // Messages for chats absent from the watermark map (not mine) are ignored.
  t.eq("someone else's chat ignored", unreadChatCount([msg(99, 5, true)], myChats([[1, 0]])), 0);

  // Missing chat_reads row = watermark 0 = everything from them is unread.
  t.eq("never-read chat counts", unreadChatCount([msg(1, 1, true)], myChats([[1, 0]])), 1);
}
