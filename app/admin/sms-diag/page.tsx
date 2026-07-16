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
import { requireAdmin } from "@/lib/admin";
import { normalizePhone } from "@/lib/phone";
import { rehostInboundPhotoDetailed, type RehostResult } from "@/lib/photos";

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

export default async function SmsDiagPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; send?: string; id?: string; mediaUrl?: string }>;
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
      <h1>SMS delivery diagnostics</h1>
      <p>
        Sends one test SMS through the exact payload the app uses, then asks Telnyx for that
        message&apos;s live status by id — including messages the portal&apos;s reports never show
        (a send stuck <code>queued</code> or held never finalizes, so it never appears there).
        Watch for <code>to[].status</code> (<code>delivered</code> vs <code>sending_failed</code>/
        <code>delivery_failed</code>) and the <code>errors</code> array — a 4xxxx code there is the
        carrier&apos;s reason.
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

      <h2>Photo attachment test</h2>
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
