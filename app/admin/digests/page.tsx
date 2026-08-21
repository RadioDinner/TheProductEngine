import type { Metadata } from "next";
import Link from "next/link";
import {
  adminDelayAd,
  adminEditAd,
  adminMoveAd,
  adminReleaseAd,
  adminRevertAd,
  adminSendDigest,
  adminScheduleMessage,
  adminCancelMessage,
} from "@/lib/admin-actions";
import { operatorWindowLabel, selectDigestItems, nextSlotOccurrence } from "@/lib/digest-engine";
import {
  listHeldNewAds,
  listRecentDigests,
  queuedOutboxCount,
  type StoredAd,
  listAdminMessages,
} from "@/lib/engine-store";
import { getEngineSettings } from "@/lib/settings";
import { ADMIN_MESSAGE_MAX_CHARS } from "@/lib/admin-messages";
import { listSmsSubscribers } from "@/lib/store";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Digests — ${site.name} admin`,
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function slotLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? "AM" : "PM"} ET`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function AdRow({
  ad,
  kind,
  position,
  count,
}: {
  ad: StoredAd;
  kind: "new" | "bump";
  position: number;
  count: number;
}) {
  return (
    <li className="myad-row">
      <p className="myad-title">
        #{ad.id} from{" "}
        <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
        <span className="status-muted"> · {kind === "new" ? "new ad" : "bump"}</span>
        {ad.photo && <span className="ad-sold"> 📷 Picture</span>}
      </p>
      <form action={adminEditAd} className="review-form">
        <input type="hidden" name="id" value={ad.id} />
        <input type="hidden" name="back" value="/admin/digests" />
        <label className="visually-hidden" htmlFor={`digest-body-${ad.id}`}>
          Ad text (editable)
        </label>
        <textarea id={`digest-body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
        <button className="btn btn-sm" type="submit">
          Save text
        </button>
      </form>
      {kind === "new" && (
        <div className="sim-actions">
          {position > 0 && (
            <form action={adminMoveAd}>
              <input type="hidden" name="id" value={ad.id} />
              <input type="hidden" name="dir" value="up" />
              <button className="btn btn-sm btn-secondary" type="submit">
                ↑ Move up
              </button>
            </form>
          )}
          {position < count - 1 && (
            <form action={adminMoveAd}>
              <input type="hidden" name="id" value={ad.id} />
              <input type="hidden" name="dir" value="down" />
              <button className="btn btn-sm btn-secondary" type="submit">
                ↓ Move down
              </button>
            </form>
          )}
          <form action={adminDelayAd}>
            <input type="hidden" name="id" value={ad.id} />
            <button className="btn btn-sm btn-secondary" type="submit">
              Skip next digest
            </button>
          </form>
          <form action={adminRevertAd}>
            <input type="hidden" name="id" value={ad.id} />
            <button className="btn btn-sm btn-secondary" type="submit">
              Back to review
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

export default async function AdminDigests({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    items?: string;
    to?: string;
    emails?: string;
    senderror?: string;
    msgqueued?: string;
    msgcanceled?: string;
    msgerror?: string;
  }>;
}) {
  const params = await searchParams;
  const settings = await getEngineSettings();
  const { newAds, bumpAds } = await selectDigestItems(settings.digestCap);
  const held = await listHeldNewAds();
  const queued = await queuedOutboxCount();
  const history = await listRecentDigests(14);
  // Operator broadcasts (session 020). Both degrade to empty/zero when 9952 is
  // not pasted, so the page still renders and says why.
  const broadcasts = await listAdminMessages(10);
  const subscriberCount = (await listSmsSubscribers()).length;

  const slots = [...settings.slots].sort((a, b) => a - b);
  const next = nextSlotOccurrence(slots);
  const nextSlotLabel = next
    ? `${slotLabel(next.slot)} (${next.day})`
    : "no slots configured";

  const total = newAds.length + bumpAds.length;

  return (
    <>
      <h1>Digests</h1>
      {params.sent && (
        <p className="fine">
          ✓ Sent the {params.sent === "extra" ? "extra edition" : "digest early"}: {params.items}{" "}
          ad{params.items === "1" ? "" : "s"} to {params.to} text subscriber
          {params.to === "1" ? "" : "s"} and {params.emails} email subscriber
          {params.emails === "1" ? "" : "s"}.
        </p>
      )}
      {params.senderror && <p className="fine">✗ Not sent: {params.senderror}</p>}
      <p>
        Batches go out{" "}
        <strong>
          {settings.batchMinAds > 0
            ? `as soon as ${settings.batchMinAds} ads are waiting`
            : "on the timer only"}
          {settings.batchMaxWaitMinutes > 0
            ? `, or ${settings.batchMaxWaitMinutes} minutes after the oldest was approved`
            : ""}
        </strong>{" "}
        <Tip k="settings.batchTriggers" /> — inside the send window only (
        {operatorWindowLabel(settings)}) · capacity {settings.digestCap} ads per
        batch, each picture ad adding its own picture message
        {queued > 0 && (
          <>
            {" "}
            · <strong>{queued} queued deliveries still draining</strong>{" "}
            <Tip k="digests.draining" />
          </>
        )}
      </p>

      <p className="fine">
        Email editions: {slots.length ? slots.map(slotLabel).join(", ") : "none"}{" "}
        <Tip k="digests.slots" /> · next email edition composes at <strong>{nextSlotLabel}</strong>
      </p>

      <h2>
        Queued for the next batch ({total}) <Tip k="digests.queue" />
      </h2>
      {total === 0 && (
        <p>
          Nothing waiting — approved ads that haven&apos;t broadcast yet and queued bumps appear
          here. (An empty queue sends nothing.)
        </p>
      )}
      {total > 0 && (
        <>
          <p className="fine">
            New ads run first (top to bottom below) <Tip k="digests.reorder" />; bumps fill
            what&apos;s left. Edits save the public text — the seller&apos;s original stays in
            the audit record. Skip next digest holds an ad out one edition{" "}
            <Tip k="digests.skipNext" />; Back to review reverts it to pending{" "}
            <Tip k="digests.backToReview" />.
          </p>
          <ul className="sim-pending">
            {newAds.map((ad, i) => (
              <AdRow key={ad.id} ad={ad} kind="new" position={i} count={newAds.length} />
            ))}
            {bumpAds.map((ad) => (
              <AdRow key={ad.id} ad={ad} kind="bump" position={0} count={1} />
            ))}
          </ul>
          <div className="sim-actions">
            <form action={adminSendDigest}>
              <input type="hidden" name="edition" value="early" />
              <button className="btn btn-sm" type="submit">
                Send early — this IS the {next ? slotLabel(next.slot) : "next"} digest, sent now
              </button>
            </form>
            <form action={adminSendDigest}>
              <input type="hidden" name="edition" value="extra" />
              <button className="btn btn-sm btn-secondary" type="submit">
                Send extra — sends now AND the queue still runs at {next ? slotLabel(next.slot) : "the next slot"}
              </button>
            </form>
            <Tip k="digests.sendEarly" />
          </div>
        </>
      )}
      <p className="fine">
        Need to add something? Queue a bump from the{" "}
        <Link href="/admin/ads?status=approved">Ads tab</Link>{" "}
        <span className="status-muted">(bumps here ride the next digest after new ads)</span>.
      </p>

      {held.length > 0 && (
        <>
          <h2>
            Held — skipping the next digest ({held.length}) <Tip k="digests.skipNext" />
          </h2>
          <ul className="sim-pending">
            {held.map((ad) => (
              <li key={ad.id} className="myad-row">
                <p className="myad-title">
                  #{ad.id} from{" "}
                  <Link href={`/admin/users?phone=${ad.ownerPhone}`}>
                    {formatPhone(ad.ownerPhone)}
                  </Link>
                  <span className="status-muted">
                    {" "}
                    · returns to the queue {ad.holdUntil ? stamp(ad.holdUntil) : "soon"}
                  </span>
                </p>
                <p className="sim-body">{ad.body}</p>
                <form action={adminReleaseAd} className="sim-actions">
                  <input type="hidden" name="id" value={ad.id} />
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Release now
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------------- admin broadcasts (session 020) ---------------- */}
      <h2>
        Message every subscriber <Tip k="digests.adminMessage" />
      </h2>
      <p className="fine">
        Your own message, sent as its OWN text to every SMS subscriber — not a line
        riding an ad batch. It goes out <strong>during sending hours only</strong> (
        {operatorWindowLabel(settings)}), so a time outside them means the next time the
        window is open, never a message that quietly doesn&rsquo;t send. Category choices
        don&rsquo;t apply: those are about which <em>ads</em> a member wants, and this is a
        note from you about the service.
      </p>
      {params.msgqueued && (
        <p className="notice" role="status">
          Scheduled as broadcast #{Number(params.msgqueued) || params.msgqueued}. It goes out
          on the next run inside the window.
        </p>
      )}
      {params.msgcanceled && (
        <p className="notice" role="status">Broadcast canceled — nothing was sent.</p>
      )}
      {params.msgerror === "empty" && (
        <p className="form-error" role="alert">Type a message first.</p>
      )}
      {params.msgerror === "when" && (
        <p className="form-error" role="alert">
          That date and time didn&rsquo;t read as a real moment — pick it again.
        </p>
      )}
      {params.msgerror === "unsupported" && (
        <p className="form-error" role="alert">
          Migration <code>9952_admin_messages.sql</code> hasn&rsquo;t been pasted yet, so
          there is nowhere to store the message.
        </p>
      )}
      <form action={adminScheduleMessage}>
        <div className="field">
          <label htmlFor="body">The message</label>
          <textarea
            id="body"
            name="body"
            rows={3}
            maxLength={ADMIN_MESSAGE_MAX_CHARS}
            placeholder="Are you liking The Plain Exchange? Feel free to call and leave a voice message with feedback! Thank you for being a great part of our community."
          />
          <p className="fine">
            Up to {ADMIN_MESSAGE_MAX_CHARS} characters. Every subscriber is billed
            separately, so anything over 160 characters costs two segments each —{" "}
            <strong>
              {subscriberCount.toLocaleString()} subscriber
              {subscriberCount === 1 ? "" : "s"}
            </strong>{" "}
            right now.
          </p>
        </div>
        <div className="field">
          <label htmlFor="sendAfter">Send no earlier than (Eastern Time)</label>
          <input id="sendAfter" name="sendAfter" type="datetime-local" />
          <p className="fine">Leave blank to send at the next opportunity.</p>
        </div>
        <button className="btn" type="submit">
          Schedule the message
        </button>
      </form>
      {broadcasts.length > 0 && (
        <ul className="myads">
          {broadcasts.map((m) => (
            <li key={m.id} className="myad-row">
              <p className="myad-title">
                #{m.id} <span className="status-muted">· {m.status}</span>
                {m.status === "sent" && (
                  <span className="status-muted">
                    {" "}
                    · {m.recipients.toLocaleString()} recipient
                    {m.recipients === 1 ? "" : "s"} · {m.segments.toLocaleString()} segments
                    {m.sentAt ? ` · ${stamp(m.sentAt)}` : ""}
                  </span>
                )}
                {m.status === "scheduled" && (
                  <span className="status-muted"> · no earlier than {stamp(m.sendAfter)}</span>
                )}
              </p>
              <p className="fine">{m.body}</p>
              {m.status === "scheduled" && (
                <form action={adminCancelMessage} className="inline-form">
                  <input type="hidden" name="id" value={m.id} />
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>
        Recent digests <Tip k="digests.history" />
      </h2>
      {history.length === 0 && <p>No digests composed yet.</p>}
      {history.length > 0 && (
        <ul className="myads">
          {history.map((d) => (
            <li key={d.id} className="myad-row">
              <p className="myad-title">
                {d.digestNo ? `No. ${d.digestNo} · ` : ""}
                {d.slotKey} <span className="status-muted">· {d.channel}</span> · {d.itemCount} ad
                {d.itemCount === 1 ? "" : "s"}
                <span className="status-muted">
                  {" "}
                  · {d.sentAt ? `composed ${stamp(d.sentAt)}` : "not finalized"}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
