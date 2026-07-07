import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listMessages } from "@/lib/engine-store";
import { emailDevEcho } from "@/lib/email";
import { devToolsEnabled } from "@/lib/env";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Email viewer — ${site.name}`,
  robots: { index: false },
};

export default async function EmailViewer({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (!emailDevEcho || !devToolsEnabled) notFound();

  const params = await searchParams;
  const emails = (await listMessages(undefined, 500)).filter((m) => m.channel === "email").reverse();
  const selected = params.id
    ? emails.find((m) => m.id === Number(params.id))
    : emails[0];

  return (
    <div className="container sim">
      <h1>Email viewer</h1>
      <p className="dev-notice">
        <strong>Development mode</strong> — no email provider is connected. Every email the
        system “sent” is listed here, rendered exactly as recipients will see it.
      </p>
      {emails.length === 0 && <p>No emails sent yet.</p>}
      <ul className="myads">
        {emails.map((m) => (
          <li key={m.id} className="myad-row">
            <p className="myad-title">
              <Link href={`/dev/email?id=${m.id}`}>
                {m.body.split("\n")[0] || "(no subject)"}
              </Link>
              {selected?.id === m.id && <span className="status-muted"> · showing below</span>}
            </p>
            <p className="myad-dates">
              To {m.address} ·{" "}
              {new Date(m.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/New_York",
              })}
              {m.digestId && " · digest"}
            </p>
          </li>
        ))}
      </ul>
      {selected?.html && (
        <>
          <h2 className="section-h">Preview</h2>
          <iframe className="email-preview" title="Email preview" srcDoc={selected.html} />
        </>
      )}
    </div>
  );
}
