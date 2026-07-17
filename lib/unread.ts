/**
 * Unread-chat math for the header badge (FEATURES item 12), shared by both
 * stores. A chat is unread when the OTHER party has a message newer than my
 * read watermark (chat_reads / chatReads — the last message id I've seen).
 * Pure and import-free so `npm test` can exercise it directly.
 */

/** A recent chat message, reduced to what the unread test needs. */
export interface UnreadMessageRow {
  chatId: number;
  /** Message id — monotonically increasing per store, compared to the watermark. */
  id: number;
  /** True when the other party (not me) sent it. */
  fromOther: boolean;
}

/**
 * Number of distinct chats with an unread message. `lastReadByChat` must hold
 * an entry for every chat the member belongs to (0 = never read); messages
 * for chats absent from the map are ignored — they're someone else's threads.
 */
export function unreadChatCount(
  messages: Iterable<UnreadMessageRow>,
  lastReadByChat: ReadonlyMap<number, number>,
): number {
  const unread = new Set<number>();
  for (const m of messages) {
    const watermark = lastReadByChat.get(m.chatId);
    if (watermark === undefined) continue;
    if (m.fromOther && m.id > watermark) unread.add(m.chatId);
  }
  return unread.size;
}
