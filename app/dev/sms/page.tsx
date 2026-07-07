import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  simApprove,
  simRejectBenign,
  simRejectViolation,
  simRunDigests,
  simSend,
} from "@/lib/dev-actions";
import { getPendingAds, listMessages } from "@/lib/engine-store";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { smsDevEcho } from "@/lib/sms";
import { devToolsEnabled } from "@/lib/env";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `SMS simulator — ${site.name}`,
  robots: { index: false },
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function SmsSimulator({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; ran?: string }>;
}) {
  if (!smsDevEcho || !devToolsEnabled) notFound();

  const params = await searchParams;
  const from = params.from ? normalizePhone(params.from) : null;
  const messages = from ? await listMessages(from) : [];
  const pending = await getPendingAds();

  return (
    <div className="container sim">
      <h1>SMS simulator</h1>
      <p className="dev-notice">
        <strong>Development mode</strong> — no SMS provider is connected. Messages sent here go
        through the exact same engine the Telnyx webhook will use, and the conversation below
        is read from the real message audit log.
      </p>

      <form className="sim-picker" action="/dev/sms" method="get">
        <div className="field">
          <label htmlFor="from">Texting from</label>
          <div className="inline-fields">
            <input
              id="from"
              name="from"
              type="tel"
              defaultValue={from ? formatPhone(from) : ""}
              placeholder="330-555-1234 — any number"
            />
            <button className="btn" type="submit">
              Open
            </button>
          </div>
        </div>
      </form>

      {from && (
        <>
          <h2 className="section-h">Conversation with {formatPhone(from)}</h2>
          {messages.length ? (
            <ul className="sim-thread">
              {messages.map((m) => (
                <li key={m.id} className={`sim-msg sim-${m.direction}`}>
                  <p className="sim-meta">
                    {m.direction === "inbound" ? "You" : site.name} · {timeLabel(m.createdAt)}
                    {m.channel === "mms" && " · photo attached"}
                    {m.digestId && " · digest"}
                  </p>
                  <p className="sim-body">{m.body || "(no text)"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No messages yet from this number. Try texting SUBSCRIBE or HELP.</p>
          )}

          <form action={simSend}>
            <input type="hidden" name="from" value={from} />
            <div className="field">
              <label htmlFor="text">Message</label>
              <textarea id="text" name="text" rows={3} placeholder="AD NEW Hay wagon, $500…" />
            </div>
            <label className="sim-photo-toggle">
              <input type="checkbox" name="photo" /> Attach a sample photo (simulated MMS)
            </label>
            <button className="btn btn-block" type="submit">
              Send text
            </button>
          </form>
        </>
      )}

      <h2 className="section-h">Review queue</h2>
      {params.ran && (
        <p className="notice" role="status">
          Digest run: {params.ran}
        </p>
      )}
      {pending.length ? (
        <ul className="sim-pending">
          {pending.map((ad) => (
            <li key={ad.id} className="myad-row">
              <p className="myad-title">
                #{ad.id} from {formatPhone(ad.ownerPhone)}
                {ad.flagged && <span className="ad-sold"> Flagged</span>}
                {ad.photo && <span className="status-muted"> · photo</span>}
              </p>
              <p className="sim-body">{ad.body}</p>
              <div className="sim-actions">
                <form action={simApprove}>
                  <input type="hidden" name="id" value={ad.id} />
                  {from && <input type="hidden" name="from" value={from} />}
                  <button className="btn btn-sm" type="submit">
                    Approve
                  </button>
                </form>
                <form action={simRejectBenign}>
                  <input type="hidden" name="id" value={ad.id} />
                  {from && <input type="hidden" name="from" value={from} />}
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Reject (benign)
                  </button>
                </form>
                <form action={simRejectViolation}>
                  <input type="hidden" name="id" value={ad.id} />
                  {from && <input type="hidden" name="from" value={from} />}
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Reject (violation)
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing waiting for review.</p>
      )}

      <h2 className="section-h">Digests</h2>
      <form action={simRunDigests}>
        {from && <input type="hidden" name="from" value={from} />}
        <button className="btn" type="submit">
          Run due digest slots now
        </button>
      </form>
      <p className="fine">
        Slots: {site.name} sends at 7am, noon, 4pm, and 8pm ET. Running twice is safe — each
        slot fires once.
      </p>
    </div>
  );
}
