import type { Metadata } from "next";
import { emailSignup } from "@/lib/email-actions";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Ads by email — ${site.name}`,
  description: `Get ${site.name}'s classified ads by email, pictures included — twice a day.`,
};

export default async function EmailSignup({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; dev?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="container auth">
      <h1>Get the ads by email</h1>
      <p className="auth-intro">
        The email edition carries the same ads as the text digests — with the pictures right
        in the message — twice a day. It's free, and every email has an unsubscribe link.
      </p>

      {params.sent ? (
        <>
          <p className="notice" role="status">
            Check your email — we sent a confirmation link. Click it and the ads start
            coming.
          </p>
          {params.dev && (
            <p className="dev-notice">
              <strong>Development mode</strong> — no email service is connected yet, so here's
              your confirmation link: <a href={params.dev}>confirm this email</a>
            </p>
          )}
        </>
      ) : (
        <form action={emailSignup}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          {params.error && (
            <p className="form-error" role="alert">
              That doesn’t look like an email address — check it and try again.
            </p>
          )}
          <button className="btn btn-block" type="submit">
            Send me the confirmation link
          </button>
        </form>
      )}

      <p className="auth-alt">
        Rather have it by text? Text <strong>SUBSCRIBE</strong> to{" "}
        <strong>{site.smsNumber}</strong> — free, up to four digests a day.
      </p>
    </div>
  );
}
