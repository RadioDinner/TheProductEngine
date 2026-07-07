import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmailToken } from "@/lib/email";
import { unsubscribeEmail } from "@/lib/store";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Unsubscribed — ${site.name}`,
  robots: { index: false },
};

export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>;
}) {
  const params = await searchParams;
  const address = params.e?.trim().toLowerCase() ?? "";
  const valid = Boolean(address && params.t && verifyEmailToken("unsub", address, params.t));
  if (valid) await unsubscribeEmail(address);

  return (
    <div className="container auth">
      {valid ? (
        <>
          <h1>You’re unsubscribed.</h1>
          <p className="auth-intro">
            No more email editions will go to <strong>{address}</strong>. Changed your mind?{" "}
            <Link href="/email">Sign up again any time</Link> — or text{" "}
            <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> for the text
            digests.
          </p>
        </>
      ) : (
        <>
          <h1>That link didn’t check out.</h1>
          <p className="auth-intro">
            The unsubscribe link is invalid or was copied incompletely. Use the link at the
            bottom of any email edition.
          </p>
        </>
      )}
    </div>
  );
}
