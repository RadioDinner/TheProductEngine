import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmailToken } from "@/lib/email";
import { subscribeEmailOnly } from "@/lib/store";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Email confirmed — ${site.name}`,
  robots: { index: false },
};

export default async function ConfirmEmail({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>;
}) {
  const params = await searchParams;
  const address = params.e?.trim().toLowerCase() ?? "";
  const valid = Boolean(address && params.t && verifyEmailToken("confirm", address, params.t));
  if (valid) await subscribeEmailOnly(address);

  return (
    <div className="container auth">
      {valid ? (
        <>
          <h1>You’re on the list.</h1>
          <p className="auth-intro">
            The ads will come to <strong>{address}</strong> with each email edition. Every
            message has an unsubscribe link if you change your mind.{" "}
            <Link href="/">See the latest ads</Link> in the meantime.
          </p>
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
