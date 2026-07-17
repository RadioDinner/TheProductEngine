/**
 * Light unread-chat count for the header badge poll (FEATURES item 12).
 * Session-cookie guarded (readSession works in route handlers) — 401 JSON
 * when signed out, never a redirect: the caller is a fetch() poller.
 * Deliberately lean: countUnreadChats, not the full listChatsFor.
 */
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { countUnreadChats } from "@/lib/store";

export async function GET(): Promise<NextResponse> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ unread: 0 }, { status: 401 });
  }
  try {
    const unread = await countUnreadChats(session.phone);
    return NextResponse.json({ unread });
  } catch (error) {
    // A polled badge must never 500 — count 0 and try again next tick.
    console.error("unread count failed", error);
    return NextResponse.json({ unread: 0 });
  }
}
