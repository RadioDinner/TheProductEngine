import type { Metadata } from "next";
import { listMessages } from "@/lib/engine-store";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Messages — ${site.name} admin`,
};

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminMessages({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  const params = await searchParams;
  const phone = params.phone ? normalizePhone(params.phone) : null;
  const messages = (await listMessages(phone ?? undefined, 300)).slice().reverse();

  return (
    <>
      <h1>Message audit log</h1>
      <form className="search" action="/admin/messages" method="get">
        <label className="visually-hidden" htmlFor="phone">
          Filter by phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={phone ? formatPhone(phone) : ""}
          placeholder="Filter by number — blank for all"
        />
        <button type="submit">Filter</button>
      </form>
      <p className="fine">
        Newest first · every message in and out is recorded, including each subscriber's copy
        of every digest.
      </p>
      {messages.length === 0 && <p>No messages logged yet.</p>}
      <ul className="sim-thread admin-log">
        {messages.map((m) => (
          <li key={m.id} className={`sim-msg sim-${m.direction}`}>
            <p className="sim-meta">
              {m.direction === "inbound" ? "From" : "To"} {formatPhone(m.address)} ·{" "}
              {stamp(m.createdAt)}
              {m.channel === "mms" && " · MMS"}
              {m.channel === "chat" && " · chat (on-site)"}
              {m.digestId && " · digest"}
            </p>
            <p className="sim-body">{m.body || "(no text)"}</p>
            {m.media && m.media.length > 0 && (
              <p className="sim-meta">
                {m.media.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noreferrer">
                    📷 attachment {i + 1}{" "}
                  </a>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
