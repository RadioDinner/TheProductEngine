import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmailToken } from "@/lib/email";
import { unsubscribeEmailAction } from "@/lib/email-actions";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Unsubscribe — ${site.name}`,
  robots: { index: false },
};

export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string; ok?: string }>;
}) {
  const params = await searchParams;

  // The unsubscribe happens in the action (a button POST), never on this GET,
  // so an email link scanner / prefetcher can't silently unsubscribe someone.
  if (params.ok === "1") {
    return (
      <div className="container auth">
        <h1>You’re unsubscribed.</h1>
        <p className="auth-intro">
          No more email editions will go out. Changed your mind?{" "}
          <Link href="/email">Sign up again any time</Link> — or text <strong>SUBSCRIBE</strong>{" "}
          to <strong>{site.smsNumber}</strong> for the text digests.
        </p>
      </div>
    );
  }
  if (params.ok === "0") {
    return (
      <div className="container auth">
        <h1>That link didn’t check out.</h1>
        <p className="auth-intro">
          The unsubscribe link is invalid or was copied incompletely. Use the link at the bottom
          of any email edition.
        </p>
      </div>
    );
  }

  const address = params.e?.trim().toLowerCase() ?? "";
  const token = params.t ?? "";
  const valid = Boolean(address && token && verifyEmailToken("unsub", address, token));

  return (
    <div className="container auth">
      {valid ? (
        <>
          <h1>Unsubscribe?</h1>
          <p className="auth-intro">
            Tap to stop the email editions to <strong>{address}</strong>.
          </p>
          <form action={unsubscribeEmailAction}>
            <input type="hidden" name="e" value={address} />
            <input type="hidden" name="t" value={token} />
            <button className="btn btn-block" type="submit">
              Unsubscribe
            </button>
          </form>
        </>
      ) : (
        <>
          <h1>That link didn’t check out.</h1>
          <p className="auth-intro">
            The unsubscribe link is invalid or was copied incompletely. Use the link at the bottom
            of any email edition.
          </p>
        </>
      )}
    </div>
  );
}
