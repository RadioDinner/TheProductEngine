/**
 * The call log for the call-in card line — who called, when, how long, and
 * what came of it (user request, session 016). Rows are written by
 * /api/voice as the call happens; the authoritative total length arrives
 * from Twilio's status callback once the caller hangs up.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { OUTCOME_LABEL, formatDuration, listCalls } from "@/lib/call-log";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = { title: "Calls" };
export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminCalls({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  const params = await searchParams;
  const phone = normalizePhone(params.phone ?? "") ?? undefined;
  const calls = await listCalls(200, phone);

  return (
    <section>
      <h1>
        Calls <Tip k="calls.list" />
      </h1>
      <p className="fine">
        Every call to the card line, newest first — who called, when, how long they stayed on,
        and what came of it. Voicemail recordings live in the Twilio console; the link opens
        the audio. {phone && <>Filtered to {formatPhone(phone)} — <Link href="/admin/calls">show all</Link>.</>}
      </p>

      <form method="get" action="/admin/calls" className="review-form">
        <div className="inline-fields">
          <input name="phone" defaultValue={params.phone ?? ""} placeholder="Filter by phone" inputMode="tel" />
          <button className="btn btn-sm" type="submit">
            Filter
          </button>
        </div>
      </form>

      {!calls.length && (
        <p>
          No calls logged yet. (If the line is live and this stays empty, migration{" "}
          <code>9972_call_log.sql</code> may not be pasted — the call itself still works either
          way; only the history is missing.)
        </p>
      )}

      {calls.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who called</th>
              <th>Length</th>
              <th>What happened</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call.callSid}>
                <td>{when(call.createdAt)}</td>
                <td>
                  {call.fromPhone ? (
                    <Link href={`/admin/users?phone=${call.fromPhone}`}>
                      {formatPhone(call.fromPhone)}
                    </Link>
                  ) : (
                    <span className="fine">withheld</span>
                  )}
                </td>
                <td>{formatDuration(call.durationSeconds)}</td>
                <td>
                  {OUTCOME_LABEL[call.outcome] ?? call.outcome}
                  {call.detail && <div className="fine">{call.detail}</div>}
                  {call.recordingUrl && (
                    <div className="fine">
                      <a href={call.recordingUrl} target="_blank" rel="noreferrer">
                        Listen to the message
                      </a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
