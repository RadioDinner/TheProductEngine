import type { Metadata } from "next";
import Link from "next/link";
import { listEmailSubscribers, listSmsSubscribers } from "@/lib/store";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Subscribers — ${site.name} admin`,
};

export const dynamic = "force-dynamic";

function stamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function AdminSubscribers() {
  const [sms, email] = await Promise.all([listSmsSubscribers(), listEmailSubscribers()]);

  return (
    <>
      <h1>Subscribers</h1>
      <p className="fine">
        Everyone currently receiving digests, newest first. The date is when their current
        subscription started (a STOP clears it; a later re-subscribe starts a fresh date). Trends
        and weekly counts live on <Link href="/admin/reports">Reports</Link>.
      </p>

      <h2>Text subscribers ({sms.length})</h2>
      {sms.length === 0 && <p>No SMS subscribers yet.</p>}
      {sms.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Phone</th>
              <th>Subscribed (ET)</th>
            </tr>
          </thead>
          <tbody>
            {sms.map((s) => (
              <tr key={s.phone}>
                <td>
                  <Link href={`/admin/users?phone=${s.phone}`}>{formatPhone(s.phone)}</Link>
                </td>
                <td>{stamp(s.subscribedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Email subscribers ({email.length})</h2>
      {email.length === 0 && <p>No email subscribers yet.</p>}
      {email.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Subscribed (ET)</th>
            </tr>
          </thead>
          <tbody>
            {email.map((s) => (
              <tr key={s.email}>
                <td>{s.email}</td>
                <td>{stamp(s.subscribedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
