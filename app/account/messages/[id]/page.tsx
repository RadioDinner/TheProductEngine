import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { openChatThread } from "@/lib/store";
import ChatThread from "@/components/ChatThread";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Conversation — ${site.name}`,
  robots: { index: false },
};

/**
 * One chat thread (FEATURES items 4, 13, 14 & 15). The server owns the data:
 * openChatThread fetches this ONE chat's summary + messages (no listChatsFor
 * scan) and marks it read; the client component handles optimistic sends.
 * Membership is enforced by the store — null gets the same 404 as a missing
 * chat, so member ids can't be probed.
 */
export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string; send?: string; report?: string }>;
}) {
  const session = await readSession();
  const { id: rawId } = await params;
  const chatId = Number(rawId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/account/messages/${rawId}`)}`);
  if (!Number.isInteger(chatId)) notFound();

  const thread = await openChatThread(chatId, session.phone);
  if (thread === null) notFound();
  const { summary, messages } = thread;
  const { share, send, report } = await searchParams;

  return (
    <div className="container account">
      <p className="backlink">
        <Link href="/account/messages">← All messages</Link>
      </p>
      <h1>
        Member {summary.otherMemberId ?? "(new)"}
        {summary.otherVerified && (
          <span className="verified-badge" title="Verified member">
            {" "}
            ✓
          </span>
        )}
        {summary.adId ? (
          <>
            {" "}
            · <Link href={`/ad/${summary.adId}`}>ad #{summary.adId}</Link>
          </>
        ) : null}
      </h1>
      <ChatThread
        chatId={chatId}
        initialMessages={messages}
        otherName={`Member ${summary.otherMemberId ?? ""}`.trim()}
        initialSendNote={send ?? null}
        initialReportNote={report ?? null}
        initialShareNote={share ?? null}
      />
    </div>
  );
}
