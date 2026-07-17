"use client";

/**
 * The chat thread body (FEATURES item 15) — the repo's first client
 * component. The server page (app/account/messages/[id]) still owns the
 * data: it passes the fetched messages down, and every mutation goes through
 * a server action. This component only adds the modern feel on top:
 *
 *  - optimistic append: your message shows the moment you press Send, then
 *    swaps for the server-confirmed row (or backs out with a friendly note);
 *  - inline notes for refused sends (links, capped pictures, dev mode);
 *  - report / share-address without a full page round trip.
 *
 * Confirmed rows are merged with the server-rendered list BY ID, so a
 * same-URL refresh (or the no-JS form fallbacks, which redirect) never
 * duplicates a message.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessageView } from "@/lib/store";
import {
  reportChat,
  reportChatMessage,
  sendChat,
  sendChatPhoto,
  sendChatPhotoForm,
  sendChatText,
  shareAddress,
  sharePickupAddress,
} from "@/lib/chat-actions";
import { chatSendNote } from "@/lib/chat";
import { hasLink } from "@/lib/content-filter";

type LocalMsg = ChatMessageView & { pending?: boolean };

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default function ChatThread({
  chatId,
  initialMessages,
  otherName,
  initialSendNote,
  initialReportNote,
  initialShareNote,
}: {
  chatId: number;
  initialMessages: ChatMessageView[];
  otherName: string;
  /** ?send= / ?report= / ?share= query notes from the no-JS form fallbacks. */
  initialSendNote?: string | null;
  initialReportNote?: string | null;
  initialShareNote?: string | null;
}) {
  const [local, setLocal] = useState<LocalMsg[]>([]);
  const [body, setBody] = useState("");
  const [note, setNote] = useState<string | null>(
    initialSendNote ? chatSendNote(initialSendNote) : null,
  );
  const [reportNote, setReportNote] = useState<string | null>(
    initialReportNote === "ok"
      ? "Thanks — the message was reported and the operator will review it."
      : initialReportNote === "unavailable"
        ? "Reporting isn't available just yet — please try again later."
        : null,
  );
  const [reportedIds, setReportedIds] = useState<ReadonlySet<number>>(new Set());
  const [photoBusy, setPhotoBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const tempIdRef = useRef(-1);
  const nextTempId = () => tempIdRef.current--;

  // Server list is the base; locally confirmed/pending rows merge in by id,
  // so a refresh that already includes them can't double-render.
  const messages = useMemo<LocalMsg[]>(() => {
    const seen = new Set(initialMessages.map((m) => m.id));
    return [...initialMessages, ...local.filter((m) => !seen.has(m.id))];
  }, [initialMessages, local]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    if (hasLink(text)) {
      setNote(chatSendNote("link"));
      return;
    }
    setNote(null);
    const temp: LocalMsg = {
      id: nextTempId(),
      mine: true,
      body: text,
      photo: null,
      at: new Date().toISOString(),
      pending: true,
    };
    setLocal((l) => [...l, temp]);
    setBody("");
    const result = await sendChatText(chatId, text);
    if (result.ok) {
      setLocal((l) => l.map((m) => (m === temp ? result.message : m)));
    } else {
      setLocal((l) => l.filter((m) => m !== temp));
      setBody(text); // hand the draft back
      setNote(chatSendNote(result.error));
    }
  }

  async function handlePhoto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("chatId", String(chatId));
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) return;
    setNote(null);
    setPhotoBusy(true);
    const previewUrl = URL.createObjectURL(file);
    const temp: LocalMsg = {
      id: nextTempId(),
      mine: true,
      body: "",
      photo: previewUrl,
      at: new Date().toISOString(),
      pending: true,
    };
    setLocal((l) => [...l, temp]);
    try {
      const result = await sendChatPhoto(formData);
      if (result.ok) {
        setLocal((l) => l.map((m) => (m === temp ? result.message : m)));
        form.reset();
      } else {
        setLocal((l) => l.filter((m) => m !== temp));
        setNote(chatSendNote(result.error));
      }
    } finally {
      URL.revokeObjectURL(previewUrl);
      setPhotoBusy(false);
    }
  }

  async function handleShare(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNote(null);
    const result = await shareAddress(chatId);
    if (result.ok) {
      setLocal((l) => [...l, result.message]);
    } else {
      setNote(chatSendNote(result.error));
    }
  }

  async function handleReport(e: React.FormEvent<HTMLFormElement>, messageId: number) {
    e.preventDefault();
    const result = await reportChat(chatId, messageId);
    if (result.ok) {
      setReportedIds((s) => new Set(s).add(messageId));
      setReportNote("Thanks — the message was reported and the operator will review it.");
    } else {
      setReportNote(
        result.error === "unsupported"
          ? "Reporting isn't available just yet — please try again later."
          : "That message couldn't be reported.",
      );
    }
  }

  return (
    <>
      {messages.length === 0 && (
        <p className="fine">Say hello — your message starts the conversation.</p>
      )}
      <ul className="chat-thread" ref={listRef}>
        {messages.map((m) => (
          <li
            key={m.id}
            className={`chat-msg ${m.mine ? "chat-sent" : "chat-received"}${m.pending ? " chat-pending" : ""}`}
          >
            <p className="chat-meta">
              {m.mine ? "You" : otherName} · {m.pending ? "sending…" : when(m.at)}
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
              (m.reported || reportedIds.has(m.id) ? (
                <p className="chat-reported">Reported — the operator will take a look.</p>
              ) : (
                <form action={reportChatMessage} onSubmit={(e) => handleReport(e, m.id)}>
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
      {note && (
        <p className="form-error" role="alert">
          {note}
        </p>
      )}
      {reportNote && (
        <p className="notice" role="status">
          {reportNote}
        </p>
      )}
      <form action={sendChat} onSubmit={handleSend}>
        <input type="hidden" name="chatId" value={chatId} />
        <div className="field">
          <label htmlFor="body">Your message</label>
          <textarea
            id="body"
            name="body"
            rows={3}
            maxLength={1000}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button className="btn" type="submit">
          Send message
        </button>
      </form>
      <form action={sendChatPhotoForm} onSubmit={handlePhoto} className="chat-photo-form">
        <input type="hidden" name="chatId" value={chatId} />
        <label className="fine" htmlFor="chat-photo">
          Send a picture — it shows here on the website only, never by text.
        </label>
        <div className="inline-fields">
          <input id="chat-photo" name="photo" type="file" accept="image/*" required />
          <button className="btn btn-sm btn-secondary" type="submit" disabled={photoBusy}>
            {photoBusy ? "Sending…" : "Send picture"}
          </button>
        </div>
      </form>
      {initialShareNote === "noaddress" && (
        <p className="form-error" role="alert">
          You haven&apos;t saved a pickup address yet — add one under Profile on your account
          page first.
        </p>
      )}
      <form action={sharePickupAddress} onSubmit={handleShare} className="sim-actions">
        <input type="hidden" name="chatId" value={chatId} />
        <button className="btn btn-sm btn-secondary" type="submit">
          Share my pickup address
        </button>
      </form>
      <p className="fine">
        Your pickup address stays private until you press that button — it&apos;s sent into
        this conversation only. Never share bank or card numbers here, and links can&apos;t be
        sent in chat.
      </p>
    </>
  );
}
