import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { listChatMessages, listChatsFor, markChatRead } from "@/lib/store";
import { reportChatMessage, sendChat, sendChatPhoto, sharePickupAddress } from "@/lib/chat-actions";
import { chatSendNote } from "@/lib/chat";
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

/** One chat thread (FEATURES items 4 & 13). Membership is enforced by the store. */
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

  // Null = not a member of this thread (or it doesn't exist) — same 404 either
  // way, so member ids can't be probed.
  const messages = await listChatMessages(chatId, session.phone);
  if (messages === null) notFound();
  await markChatRead(chatId, session.phone);
  const summary = (await listChatsFor(session.phone)).find((c) => c.id === chatId);
  const { share, send, report } = await searchParams;
  const otherName = `Member ${summary?.otherMemberId ?? ""}`.trim();

  return (
    <div className="container account">
      <p className="backlink">
        <Link href="/account/messages">← All messages</Link>
      </p>
      <h1>
        Member {summary?.otherMemberId ?? "(new)"}
        {summary?.otherVerified && (
          <span className="verified-badge" title="Verified member">
            {" "}
            ✓
          </span>
        )}
        {summary?.adId ? (
          <>
            {" "}
            · <Link href={`/ad/${summary.adId}`}>ad #{summary.adId}</Link>
          </>
        ) : null}
      </h1>
      {messages.length === 0 && <p className="fine">Say hello — your message starts the conversation.</p>}
      <ul className="chat-thread">
        {messages.map((m) => (
          <li key={m.id} className={`chat-msg ${m.mine ? "chat-sent" : "chat-received"}`}>
            <p className="chat-meta">
              {m.mine ? "You" : otherName} · {when(m.at)}
            </p>
            {m.photo && (
              // Chat pictures are plain re-hosted storage URLs, like the
              // website-only ad extras — a plain img keeps them outside
              // next/image's host allowlist.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="chat-photo" src={m.photo} alt="Picture message" loading="lazy" />
            )}
            {m.body && <p className="chat-body">{m.body}</p>}
            {!m.mine &&
              (m.reported ? (
                <p className="chat-reported">Reported — the operator will take a look.</p>
              ) : (
                <form action={reportChatMessage}>
                  <input type="hidden" name="chatId" value={chatId} />
                  <input type="hidden" name="messageId" value={m.id} />
                  <button className="chat-report" type="submit">
                    Report this message
                  </button>
                </form>
              ))}
          </li>
        ))}
      </ul>
      {send && (
        <p className="form-error" role="alert">
          {chatSendNote(send)}
        </p>
      )}
      {report === "ok" && (
        <p className="notice" role="status">
          Thanks — the message was reported and the operator will review it.
        </p>
      )}
      {report === "unavailable" && (
        <p className="form-error" role="alert">
          Reporting isn&apos;t available just yet — please try again later.
        </p>
      )}
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
      <form action={sendChatPhoto} className="chat-photo-form">
        <input type="hidden" name="chatId" value={chatId} />
        <label className="fine" htmlFor="chat-photo">
          Send a picture — it shows here on the website only, never by text.
        </label>
        <div className="inline-fields">
          <input id="chat-photo" name="photo" type="file" accept="image/*" required />
          <button className="btn btn-sm btn-secondary" type="submit">
            Send picture
          </button>
        </div>
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
        conversation only. Never share bank or card numbers here, and links can&apos;t be sent
        in chat.
      </p>
    </div>
  );
}
