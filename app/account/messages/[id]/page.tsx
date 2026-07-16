import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { listChatMessages, listChatsFor, markChatRead } from "@/lib/store";
import { sendChat, sharePickupAddress } from "@/lib/account-actions";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Conversation — ${site.name}`,
  robots: { index: false },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** One chat thread (FEATURES item 4). Membership is enforced by the store. */
export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const session = await readSession();
  const { id: rawId } = await params;
  const chatId = Number(rawId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/account/messages/${rawId}`)}`);
  if (!Number.isInteger(chatId)) notFound();

  // Null = not a member of this thread (or it doesn't exist) — same 404 either
  // way, so member ids can't be probed.
  const messages = await listChatMessages(chatId, session.phone);
  if (messages === null) notFound();
  await markChatRead(chatId, session.phone);
  const summary = (await listChatsFor(session.phone)).find((c) => c.id === chatId);
  const share = (await searchParams).share;

  return (
    <div className="container account">
      <p className="backlink">
        <Link href="/account/messages">← All messages</Link>
      </p>
      <h1>
        Member {summary?.otherMemberId ?? "(new)"}
        {summary?.adId ? (
          <>
            {" "}
            · <Link href={`/ad/${summary.adId}`}>ad #{summary.adId}</Link>
          </>
        ) : null}
      </h1>
      {messages.length === 0 && <p className="fine">Say hello — your message starts the conversation.</p>}
      <ul className="sim-thread">
        {messages.map((m) => (
          <li key={m.id} className={`sim-msg ${m.mine ? "sim-inbound" : "sim-outbound"}`}>
            <p className="sim-meta">
              {m.mine ? "You" : `Member ${summary?.otherMemberId ?? ""}`} · {when(m.at)}
            </p>
            <p className="sim-body">{m.body}</p>
          </li>
        ))}
      </ul>
      <form action={sendChat}>
        <input type="hidden" name="chatId" value={chatId} />
        <div className="field">
          <label htmlFor="body">Your message</label>
          <textarea id="body" name="body" rows={3} maxLength={1000} required />
        </div>
        <button className="btn" type="submit">
          Send message
        </button>
      </form>
      {share === "noaddress" && (
        <p className="form-error" role="alert">
          You haven&apos;t saved a pickup address yet — add one under Profile on{" "}
          <Link href="/account#profile">your account page</Link> first.
        </p>
      )}
      <form action={sharePickupAddress} className="sim-actions">
        <input type="hidden" name="chatId" value={chatId} />
        <button className="btn btn-sm btn-secondary" type="submit">
          Share my pickup address
        </button>
      </form>
      <p className="fine">
        Your pickup address stays private until you press that button — it&apos;s sent into this
        conversation only. Never share bank or card numbers here.
      </p>
    </div>
  );
}
