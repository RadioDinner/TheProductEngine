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
import {
  operatorWindowLabel,
  nextSlotOccurrence,
  planBatches,
  selectQueuePreview,
  QUEUE_PREVIEW_LIMIT,
} from "@/lib/digest-engine";
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
import { textedAdPhotos } from "@/lib/photo-collage";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Batches — ${site.name} admin`,
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

/**
 * One panel's data, or the reason it couldn't be read. Never throws: the whole
 * point is that a broken query costs its own section and nothing else.
 *
 * The message is shown to the operator on purpose. "Batch history couldn't
 * load: relation admin_messages does not exist" is something they can paste to
 * whoever can fix it; a generic apology is not. This is an admin-only page —
 * `requireAdmin` gates the whole /admin layout — so a database message here
 * reaches nobody who shouldn't see it.
 */
type Panel<T> = { ok: true; value: T } | { ok: false; label: string; why: string };

async function panel<T>(label: string, read: () => Promise<T>): Promise<Panel<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    console.error(`[admin/batches] ${label} failed to load`, e);
    return { ok: false, label, why: e instanceof Error ? e.message : String(e) };
  }
}

function PanelError({ panel }: { panel: { label: string; why: string } }) {
  return (
    <p className="form-error" role="alert">
      Couldn&rsquo;t load {panel.label}: {panel.why}
    </p>
  );
}

function AdRow({
  ad,
  kind,
  position,
  count,
  ridesPicture,
}: {
  ad: StoredAd;
  kind: "new" | "bump";
  position: number;
  count: number;
  /** Does this ad add its own picture message to the batch? */
  ridesPicture: boolean;
}) {
  // The picture that BROADCASTS is the first texted one — the same
  // `textedAdPhotos(...)[0]` resolveBroadcastPictures sends, so what the
  // operator previews here is the picture subscribers actually receive.
  const broadcastPhoto = textedAdPhotos(ad.photo, ad.morePhotos)[0];
  return (
    <li className="batch-ad">
      <div className="batch-ad-main">
        {broadcastPhoto && (
          <a
            className="adcard-thumb"
            href={broadcastPhoto.src}
            target="_blank"
            rel="noreferrer"
            title={
              ridesPicture
                ? `Goes out as its own picture message, stamped AD ${ad.id}. Open full size.`
                : "Pictures are switched off for batches right now (Settings). Open full size."
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={broadcastPhoto.src} alt={broadcastPhoto.alt || `Picture on ad #${ad.id}`} />
            <span className="adcard-shot-tag">{ridesPicture ? `AD ${ad.id}` : "off"}</span>
          </a>
        )}
        <div className="batch-ad-copy">
          <p className="myad-title">
            #{ad.id} from{" "}
            <Link href={`/admin/users?phone=${ad.ownerPhone}`}>{formatPhone(ad.ownerPhone)}</Link>
            <span className="status-muted"> · {kind === "new" ? "new ad" : "bump"}</span>
          </p>
          <form action={adminEditAd} className="review-form">
            <input type="hidden" name="id" value={ad.id} />
            <input type="hidden" name="back" value="/admin/batches" />
            <label className="visually-hidden" htmlFor={`digest-body-${ad.id}`}>
              Ad text (editable)
            </label>
            <textarea id={`digest-body-${ad.id}`} name="body" rows={3} defaultValue={ad.body} />
            <button className="btn btn-sm" type="submit">
              Save text
            </button>
          </form>
        </div>
      </div>
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
              Skip next batch
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

export default async function AdminBatches({
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
    saved?: string;
    id?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  // The last unwrapped read on this page. Everything below is panelled, so a
  // failure here was the one remaining way for one query to blank the lot.
  const settingsPanel = await panel("settings", getEngineSettings);
  if (!settingsPanel.ok) {
    return (
      <>
        <h1>Batches</h1>
        <PanelError panel={settingsPanel} />
        <p className="fine">
          Settings drive every number on this page — the send window, the batch
          triggers, how many ads fit in a batch — so there is nothing trustworthy to
          show without them.
        </p>
      </>
    );
  }
  const settings = settingsPanel.value;
  // ⚠️ Every read below is INDEPENDENT and none of them may take the page down.
  //
  // This page has now gone dark in production twice: session 018's slot-key
  // bug, and session 022's — `listAdminMessages` threw instead of degrading
  // when migration 9952 was unpasted, because its "no such table" guard knew
  // Postgres's 42P01 but not PostgREST's PGRST205. One unrelated query took
  // out the queue, the send buttons and the history with it.
  //
  // Root cause is fixed in the store; this is the second line of defence. A
  // panel that cannot load now says so IN PLACE, naming the failure, so the
  // operator still gets the rest of the page AND something to report — rather
  // than an error screen that says nothing and hides everything.
  const [queue, held, queued, history, broadcasts, subscribers] = await Promise.all([
    panel("the queue", () => selectQueuePreview()),
    panel("held ads", listHeldNewAds),
    panel("the delivery count", queuedOutboxCount),
    panel("batch history", () => listRecentDigests(14)),
    panel("broadcasts", () => listAdminMessages(10)),
    panel("the subscriber count", listSmsSubscribers),
  ]);

  const newAds = queue.ok ? queue.value.newAds : [];
  const bumpAds = queue.ok ? queue.value.bumpAds : [];
  const batches = planBatches(newAds, bumpAds, settings);
  const subscriberCount = subscribers.ok ? subscribers.value.length : 0;

  const slots = [...settings.slots].sort((a, b) => a - b);
  const next = nextSlotOccurrence(slots);
  const nextSlotLabel = next
    ? `${slotLabel(next.slot)} (${next.day})`
    : "no slots configured";

  const total = newAds.length + bumpAds.length;

  return (
    <>
      <h1>Batches</h1>
      {params.sent && (
        <p className="fine">
          ✓ Sent the {params.sent === "extra" ? "extra edition" : "digest early"}: {params.items}{" "}
          ad{params.items === "1" ? "" : "s"} to {params.to} text subscriber
          {params.to === "1" ? "" : "s"} and {params.emails} email subscriber
          {params.emails === "1" ? "" : "s"}.
        </p>
      )}
      {params.senderror && <p className="fine">✗ Not sent: {params.senderror}</p>}
      {/* Editing an ad here redirects back with the same markers /admin/ads
          uses — a save that says nothing reads exactly like one that failed. */}
      {params.saved && (
        <p className="notice" role="status">
          Saved ad #{Number(params.saved) || params.saved}. The seller is not notified.
        </p>
      )}
      {params.error === "emptybody" && (
        <p className="form-error" role="alert">
          Ad #{Number(params.id) || params.id} was left blank, so nothing was saved — an ad
          needs some text.
        </p>
      )}
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
        {queued.ok && queued.value > 0 && (
          <>
            {" "}
            · <strong>{queued.value} queued deliveries still draining</strong>{" "}
            <Tip k="digests.draining" />
          </>
        )}
      </p>
      {!queued.ok && <PanelError panel={queued} />}

      <p className="fine">
        Email editions: {slots.length ? slots.map(slotLabel).join(", ") : "none"}{" "}
        <Tip k="digests.slots" /> · next email edition composes at <strong>{nextSlotLabel}</strong>
      </p>

      <h2>
        The queue ({total} ad{total === 1 ? "" : "s"}
        {batches.length > 1 ? ` → ${batches.length} batches` : ""}) <Tip k="digests.queue" />
      </h2>
      {!queue.ok && <PanelError panel={queue} />}
      {queue.ok && total === 0 && (
        <p>
          Nothing waiting — approved ads that haven&apos;t broadcast yet and queued bumps appear
          here. (An empty queue sends nothing.)
        </p>
      )}
      {queue.ok && queue.value.truncated && (
        <p className="form-error" role="alert">
          More than {QUEUE_PREVIEW_LIMIT} ads are waiting. Only the first{" "}
          {QUEUE_PREVIEW_LIMIT} are planned out below — the rest ride later batches on the
          same rules.
        </p>
      )}
      {total > 0 && (
        <>
          <p className="fine">
            One batch goes per run, so a backlog leaves as the batches below, in order{" "}
            <Tip k="digests.queue" />. New ads run first, oldest approval first{" "}
            <Tip k="digests.reorder" />; bumps only fill capacity left over once new ads run
            out. Edits save the public text — the seller&apos;s original stays in the audit
            record. Skip next batch holds an ad out one batch <Tip k="digests.skipNext" />;
            Back to review reverts it to pending <Tip k="digests.backToReview" />.
          </p>
          {batches.map((batch) => (
            <section key={batch.number} className="batch" aria-label={`Batch ${batch.number}`}>
              <div className="batch-head">
                <span className="batch-no">Batch {batch.number}</span>
                <span className="adcard-tag">
                  {batch.number === 1 ? "goes next" : `after batch ${batch.number - 1}`}
                </span>
                {/* What this batch COSTS to send, in messages per subscriber —
                    the number that decides the phone bill, and the reason a
                    picture ad is the premium product. */}
                <span className="batch-cost">
                  {batch.items.length} ad{batch.items.length === 1 ? "" : "s"} ·{" "}
                  {batch.messages} message{batch.messages === 1 ? "" : "s"} each
                  {batch.pictures > 0
                    ? ` (1 list + ${batch.pictures} picture${batch.pictures === 1 ? "" : "s"})`
                    : " (list only)"}
                </span>
              </div>
              <ul className="sim-pending">
                {batch.items.map((item) => (
                  <AdRow
                    key={item.ad.id}
                    ad={item.ad}
                    kind={item.kind}
                    ridesPicture={item.ridesPicture}
                    // Reordering only ever moves an ad among the NEW ads, which
                    // is the order the composer reads; the arrows are hidden on
                    // bumps for exactly that reason.
                    position={newAds.findIndex((a) => a.id === item.ad.id)}
                    count={newAds.length}
                  />
                ))}
              </ul>
            </section>
          ))}
          <div className="sim-actions">
            <form action={adminSendDigest}>
              <input type="hidden" name="edition" value="early" />
              <button className="btn btn-sm" type="submit">
                Send now — this IS the {next ? slotLabel(next.slot) : "next"} edition, sent early
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
        <span className="status-muted">(a bump only rides once the new ads ahead of it have gone)</span>.
      </p>

      {!held.ok && <PanelError panel={held} />}
      {held.ok && held.value.length > 0 && (
        <>
          <h2>
            Held — skipping the next batch ({held.value.length}) <Tip k="digests.skipNext" />
          </h2>
          <ul className="sim-pending">
            {held.value.map((ad) => (
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
      {!broadcasts.ok && <PanelError panel={broadcasts} />}
      {broadcasts.ok && broadcasts.value.length > 0 && (
        <ul className="myads">
          {broadcasts.value.map((m) => (
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
        Recent batches <Tip k="digests.history" />
      </h2>
      {!history.ok && <PanelError panel={history} />}
      {history.ok && history.value.length === 0 && <p>No batches composed yet.</p>}
      {history.ok && history.value.length > 0 && (
        <ul className="myads">
          {history.value.map((d) => (
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
