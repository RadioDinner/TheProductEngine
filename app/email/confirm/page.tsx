import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmailToken } from "@/lib/email";
import { confirmEmailAction } from "@/lib/email-actions";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Confirm your email — ${site.name}`,
  robots: { index: false },
};

export default async function ConfirmEmail({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string; ok?: string }>;
}) {
  const params = await searchParams;

  // Post-action states (the subscribe happens in the action, never on this GET,
  // so a link scanner / prefetcher can't silently confirm an address).
  if (params.ok === "1") {
    return (
      <div className="container auth">
        <h1>You’re on the list.</h1>
        <p className="auth-intro">
          The ads will come with each email edition. Every message has an unsubscribe link if you
          change your mind. <Link href="/">See the latest ads</Link> in the meantime.
        </p>
      </div>
    );
  }
  if (params.ok === "0") {
    return (
      <div className="container auth">
        <h1>That link didn’t check out.</h1>
        <p className="auth-intro">
          The confirmation link is invalid or expired. <Link href="/email">Request a fresh one</Link>.
        </p>
      </div>
    );
  }

  const address = params.e?.trim().toLowerCase() ?? "";
  const token = params.t ?? "";
  const valid = Boolean(address && token && verifyEmailToken("confirm", address, token));

  return (
    <div className="container auth">
      {valid ? (
        <>
          <h1>Confirm your email</h1>
          <p className="auth-intro">
            Tap the button to start getting {site.name}’s ads at <strong>{address}</strong>.
          </p>
          <form action={confirmEmailAction}>
            <input type="hidden" name="e" value={address} />
            <input type="hidden" name="t" value={token} />
            <button className="btn btn-block" type="submit">
              Confirm subscription
            </button>
          </form>
        </>
      ) : (
        <>
          <h1>That link didn’t check out.</h1>
          <p className="auth-intro">
            The confirmation link is invalid or was copied incompletely.{" "}
            <Link href="/email">Request a fresh one</Link> and try again.
          </p>
        </>
      )}
    </div>
  );
}
