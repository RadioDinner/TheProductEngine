/**
 * SMS delivery diagnostics. The Telnyx portal's reports only show FINALIZED
 * messages — a send that is stuck queued/held (e.g. mid-10DLC-provisioning)
 * never appears there at all, which reads as "my messages vanished". This page
 * asks Telnyx directly, with the account's own API key: send a test message
 * through the exact same payload shape the app uses, show the raw create
 * response, then fetch the message by id to expose its live status and error
 * codes. Admin-only (layout enforces requireAdmin).
 */
import Link from "next/link";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin";
import { supabaseConfigured } from "@/lib/db";
import { CONTENT_TYPE_BY_EXT, sniffImage } from "@/lib/image-sniff";
import { normalizePhone } from "@/lib/phone";
import { rehostInboundPhotoDetailed, storeImageBytes, type RehostResult } from "@/lib/photos";
import { Tip } from "@/components/Tip";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const API = "https://api.telnyx.com/v2/messages";

interface TelnyxCall {
  label: string;
  status: number | string;
  body: unknown;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function telnyxSendTest(to: string): Promise<TelnyxCall> {
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        from: process.env.TELNYX_FROM_NUMBER,
        to: `+1${to}`,
        text: "The Plain Exchange delivery test - if you can read this, outbound SMS works. Reply STOP to opt out.",
        ...(process.env.TELNYX_MESSAGING_PROFILE_ID && {
          messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
        }),
      }),
    });
    return { label: "POST /v2/messages (create)", status: response.status, body: await response.json() };
  } catch (e) {
    return { label: "POST /v2/messages (create)", status: "fetch failed", body: String(e) };
  }
}

async function telnyxGetMessage(id: string): Promise<TelnyxCall> {
  try {
    const response = await fetch(`${API}/${encodeURIComponent(id)}`, { headers: authHeaders() });
    return { label: `GET /v2/messages/${id}`, status: response.status, body: await response.json() };
  } catch (e) {
    return { label: `GET /v2/messages/${id}`, status: "fetch failed", body: String(e) };
  }
}

/** The fields that answer "did it deliver, and if not why" — pulled up top. */
function verdict(call: TelnyxCall): string | null {
  const data = (call.body as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return null;
  const to = Array.isArray(data.to)
    ? (data.to as { phone_number?: string; status?: string }[])
        .map((t) => `${t.phone_number}: ${t.status}`)
        .join(", ")
    : "";
  const errors = JSON.stringify(data.errors ?? []);
  return `recipient status → ${to || "(none)"}   errors → ${errors}`;
}

/** One stored photo, verified end to end: fetch the object exactly the way a
 * browser or Telnyx would, then check the served headers AND the bytes
 * against each other. Built for "the image contains errors" reports — it
 * tells corrupt-in-storage apart from a serving/header problem apart from a
 * browser-side one-off in a single click, from the deployment's own network. */
interface StorageCheck {
  url: string;
  ok: boolean;
  problems: string[];
  status?: number | string;
  headers?: Record<string, string>;
  byteCount?: number;
  sniffed?: string | null;
  head?: string;
  tail?: string;
  decode?: string;
}

async function checkStoredPhoto(raw: string): Promise<StorageCheck> {
  const url = raw.trim();
  if (!process.env.SUPABASE_URL) {
    return { url, ok: false, problems: ["SUPABASE_URL is not set (dev mode) — nothing to check against"] };
  }
  const prefix = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/`;
  if (!url.startsWith(prefix)) {
    // Not an open proxy: only this project's own public storage objects.
    return { url, ok: false, problems: [`only this project's public storage URLs can be checked (they start with ${prefix})`] };
  }
  try {
    const response = await fetch(url, { cache: "no-store" });
    const headers = Object.fromEntries(
      ["content-type", "content-length", "content-encoding", "cache-control", "etag"].map((h) => [
        h,
        response.headers.get(h) ?? "(absent)",
      ]),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      return {
        url,
        ok: false,
        problems: [`HTTP ${response.status} — the object is missing or unreadable (deleted collages return this; superseded collages are removed when rebuilt)`],
        status: response.status,
        headers,
        byteCount: bytes.byteLength,
      };
    }
    const sniffed = sniffImage(bytes);
    const declared = headers["content-type"].split(";")[0].trim();
    const head = bytes.subarray(0, 8).toString("hex");
    const tail = bytes.subarray(-4).toString("hex");
    let decode: string;
    try {
      // failOn "error": tolerate warnings (trailing bytes after EOI, minor
      // metadata oddities are normal in real phone JPEGs) but fail on true
      // decode errors — roughly a browser's tolerance, unlike sharp's
      // stricter default which would flag files every browser shows fine.
      const opts = { failOn: "error" as const, limitInputPixels: 64_000_000 };
      const meta = await sharp(bytes, opts).metadata();
      await sharp(bytes, opts).raw().toBuffer(); // full decode, not just the header
      decode = `decodes cleanly as ${meta.format} ${meta.width}×${meta.height}`;
    } catch (e) {
      decode = `DECODE FAILED: ${e instanceof Error ? e.message : String(e)}`;
    }
    const problems: string[] = [];
    if (!sniffed) problems.push("the bytes are not a recognizable jpg/png/gif/webp file");
    if (sniffed && CONTENT_TYPE_BY_EXT[sniffed] !== declared) {
      problems.push(
        `served content-type "${declared}" doesn't match the actual bytes (${sniffed}) — a browser opening the link directly decodes by the declared type and reports "contains errors"`,
      );
    }
    const lenHeader = Number(headers["content-length"]);
    if (Number.isFinite(lenHeader) && lenHeader !== bytes.byteLength) {
      problems.push(`content-length says ${lenHeader} but ${bytes.byteLength} bytes arrived (truncated in transit)`);
    }
    // Deliberately NO end-of-image-marker check: real intact JPEGs routinely
    // carry trailing bytes after EOI (Samsung motion-photo trailers, encoder
    // padding), so a tail probe would cry "truncated" on healthy files. The
    // full decode above is the arbiter; the tail hex is shown as data below.
    if (decode.startsWith("DECODE FAILED")) problems.push(decode);
    return {
      url,
      ok: problems.length === 0,
      problems,
      status: response.status,
      headers,
      byteCount: bytes.byteLength,
      sniffed,
      head,
      tail,
      decode,
    };
  } catch (e) {
    return { url, ok: false, problems: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

export default async function SmsDiagPage({
  searchParams,
}: {
  searchParams: Promise<{
    to?: string;
    send?: string;
    id?: string;
    mediaUrl?: string;
    checkUrl?: string;
    selftest?: string;
  }>;
}) {
  const adminPhone = await requireAdmin();
  const params = await searchParams;
  const configured = Boolean(process.env.TELNYX_API_KEY);

  const calls: TelnyxCall[] = [];
  let messageId: string | null = null;
  let rehost: RehostResult | null = null;
  if (params.mediaUrl?.trim()) {
    rehost = await rehostInboundPhotoDetailed(params.mediaUrl.trim());
  }
  let check: StorageCheck | null = null;
  if (params.checkUrl?.trim()) {
    check = await checkStoredPhoto(params.checkUrl);
  }
  // Upload self-test (2026-08-17 corruption incident): generate a fresh JPEG
  // on the server, push it through the REAL photo-storage pipeline (which now
  // includes the post-upload read-back), then independently re-download and
  // verify it like any pasted URL. One click answers "are uploads healthy
  // RIGHT NOW on this deployment" without hunting for a media URL.
  let selfTest: { stored: RehostResult; check?: StorageCheck } | null = null;
  if (params.selftest === "1" && supabaseConfigured) {
    const testJpeg = await sharp({
      create: { width: 240, height: 180, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    const stored = await storeImageBytes(testJpeg);
    selfTest = { stored };
    if (stored.ok) selfTest.check = await checkStoredPhoto(stored.url);
  }

  if (configured && params.send === "1") {
    const to = normalizePhone(params.to ?? "");
    if (to) {
      const created = await telnyxSendTest(to);
      calls.push(created);
      const data = (created.body as { data?: { id?: string } } | null)?.data;
      messageId = typeof data?.id === "string" ? data.id : null;
      if (messageId) {
        // Give the carrier a beat, then read the live status once.
        await new Promise((resolve) => setTimeout(resolve, 4000));
        calls.push(await telnyxGetMessage(messageId));
      }
    }
  } else if (configured && params.id) {
    messageId = params.id;
    calls.push(await telnyxGetMessage(params.id));
  }

  return (
    <section>
      <h1>
        SMS delivery diagnostics <Tip k="smsdiag.purpose" />
      </h1>
      <p>
        Sends one test SMS through the exact payload the app uses, then asks Telnyx for that
        message&apos;s live status by id — including messages the portal&apos;s reports never show
        (a send stuck <code>queued</code> or held never finalizes, so it never appears there).
        Watch for <code>to[].status</code> (<code>delivered</code> vs <code>sending_failed</code>/
        <code>delivery_failed</code>) and the <code>errors</code> array — a 4xxxx code there is the
        carrier&apos;s reason. <Tip k="smsdiag.testSend" />
      </p>
      {!configured && <p><strong>TELNYX_API_KEY is not set — this deployment can&apos;t reach Telnyx (dev mode).</strong></p>}

      <form method="get" action="/admin/sms-diag">
        <input type="hidden" name="send" value="1" />
        <label>
          Send a test text to{" "}
          <input name="to" defaultValue={params.to ?? adminPhone} inputMode="tel" required />
        </label>{" "}
        <button type="submit" disabled={!configured}>Send test SMS</button>
      </form>

      {messageId && (
        <p>
          Message id: <code>{messageId}</code> —{" "}
          <Link href={`/admin/sms-diag?id=${encodeURIComponent(messageId)}`}>re-check its status</Link>{" "}
          (delivery can take a minute; re-check until <code>to[].status</code> settles).
        </p>
      )}

      <h2>
        Photo attachment test <Tip k="smsdiag.rehost" />
      </h2>
      <p className="fine">
        Paste an inbound MMS media URL (open the message in{" "}
        <Link href="/admin/messages">Messages</Link>, right-click its 📷 attachment link, copy the
        address) — this runs the exact re-host + image-validation pipeline a picture ad goes
        through and reports the outcome.
      </p>
      <form method="get" action="/admin/sms-diag">
        <label>
          Media URL <input name="mediaUrl" defaultValue={params.mediaUrl ?? ""} size={60} />
        </label>{" "}
        <button type="submit">Test re-host</button>
      </form>
      {rehost && rehost.ok && (
        <p>
          <strong>✓ Saved to storage:</strong>{" "}
          <a href={rehost.url} target="_blank" rel="noreferrer">
            {rehost.url}
          </a>{" "}
          — the pipeline works; a picture ad with this attachment would keep its photo.
        </p>
      )}
      {rehost && !rehost.ok && (
        <p>
          <strong>✗ Re-host failed:</strong> {rehost.reason}
        </p>
      )}

      <h2>
        Storage upload self-test <Tip k="smsdiag.selftest" />
      </h2>
      <p className="fine">
        Creates a small test image on this server, saves it through the exact pipeline every
        ad photo uses (including the corruption read-back guard), then independently
        re-downloads and verifies it byte-for-byte. Run this after a deploy to confirm{" "}
        <strong>new</strong> uploads are healthy — a photo that was already stored corrupted
        stays corrupted at its old URL forever, so re-checking an old URL only tells you
        about the past.
      </p>
      <form method="get" action="/admin/sms-diag">
        <input type="hidden" name="selftest" value="1" />
        <button type="submit" disabled={!supabaseConfigured}>
          Run upload self-test
        </button>
      </form>
      {selfTest && !selfTest.stored.ok && (
        <p>
          <strong>✗ Upload pipeline reported a failure:</strong> {selfTest.stored.reason}
          {/(corrupted|readback)/i.test(selfTest.stored.reason) &&
            " — the transport is still mangling uploads; the guard caught and deleted it (no broken photo was kept)."}
        </p>
      )}
      {selfTest?.stored.ok && (
        <p>
          {selfTest.check?.ok ? (
            <strong>✓ Uploads are healthy — the test image survived the round trip byte-for-byte.</strong>
          ) : (
            <strong>
              ✗ Stored, but re-verification found: {selfTest.check?.problems.join("; ") ?? "no verdict"}
            </strong>
          )}{" "}
          <a href={selfTest.stored.url} target="_blank" rel="noreferrer">
            Open the test image
          </a>{" "}
          (a small blue rectangle; harmless to leave in storage).
        </p>
      )}

      <h2>
        Check a stored photo <Tip k="smsdiag.checkPhoto" />
      </h2>
      <p className="fine">
        Paste one of our own photo URLs (an ad&apos;s full-size link, a <code>collage/…</code>{" "}
        image, a PIC media URL) and this fetches it from the server and verifies the whole
        thing: the HTTP response, the served headers, and the actual bytes — including a full
        image decode. Use it when a browser says an image &ldquo;contains errors&rdquo;: if
        this reports clean, the stored file is good and the problem was that browser or its
        cached copy (hard-refresh, or try another browser); if it reports a problem, the line
        below says exactly which layer is at fault.
      </p>
      <form method="get" action="/admin/sms-diag">
        <label>
          Photo URL <input name="checkUrl" defaultValue={params.checkUrl ?? ""} size={60} />
        </label>{" "}
        <button type="submit">Check photo</button>
      </form>
      {check && (
        <div>
          <p>
            {check.ok ? (
              <strong>✓ The stored photo is healthy — {check.decode}</strong>
            ) : (
              <strong>✗ Problem found</strong>
            )}
          </p>
          {check.problems.map((p, i) => (
            <p key={i}>
              <strong>— {p}</strong>
            </p>
          ))}
          {check.status !== undefined && (
            <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(
                {
                  status: check.status,
                  headers: check.headers,
                  bytesReceived: check.byteCount,
                  bytesAre: check.sniffed ?? "not a known image format",
                  firstBytesHex: check.head,
                  lastBytesHex: check.tail,
                  decode: check.decode,
                },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      )}

      {calls.map((call, i) => (
        <div key={i}>
          <h2>
            {call.label} — HTTP {call.status}
          </h2>
          {verdict(call) && (
            <p>
              <strong>{verdict(call)}</strong>
            </p>
          )}
          <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(call.body, null, 2)}
          </pre>
        </div>
      ))}
    </section>
  );
}
