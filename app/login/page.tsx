import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  requestCode,
  submitCode,
  submitPassword,
  submitPhone,
  submitSetPassword,
} from "@/lib/auth-actions";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { readSession } from "@/lib/session";
import { peekDevEcho } from "@/lib/store";
import { smsDevEcho } from "@/lib/sms";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Sign in — ${site.name}`,
  robots: { index: false },
};

const ERRORS: Record<string, string> = {
  phone: "That doesn’t look like a phone number — enter the 10-digit number, like 330-555-0142.",
  rate: "Too many codes requested for this number. Wait an hour and try again.",
  code: "That code didn’t match. Check the text and try again.",
  expired: "That code has expired — send yourself a new one below.",
  attempts: "Too many tries with that code — send yourself a new one below.",
  password: "Wrong password. Try again, or text yourself a code instead.",
  weak: "Passwords need at least 8 characters.",
  ticket: "That step timed out — start again with your phone number.",
  sms: "We couldn't send a text message just now. Wait a few minutes and try again, or call us for help.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; phone?: string; next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const rawNext = params.next ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const session = await readSession();
  if (session) redirect(next === "/" ? "/account" : next);

  const phone = params.phone ? normalizePhone(params.phone) : null;
  const step = phone && params.step ? params.step : "phone";
  const error = params.error ? ERRORS[params.error] : null;
  const devEcho =
    step === "code" && phone && smsDevEcho ? await peekDevEcho(phone) : null;

  return (
    <div className="container auth">
      <h1>Member sign-in</h1>

      {step === "phone" && (
        <>
          <p className="auth-intro">
            Sign in with your phone number — the same number you text ads from. First time
            here? The same steps set up your account.
          </p>
          <form action={submitPhone}>
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="330-555-0142"
                required
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-block" type="submit">
              Continue
            </button>
          </form>
        </>
      )}

      {step === "password" && phone && (
        <>
          <p className="auth-intro">
            Welcome back. Enter the password for <strong>{formatPhone(phone)}</strong>.
          </p>
          <form action={submitPassword}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={phone} />
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-block" type="submit">
              Sign in
            </button>
          </form>
          <form className="auth-alt" action={requestCode}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={phone} />
            <p>
              Forgot your password?{" "}
              <button className="link-button" type="submit">
                Text me a sign-in code instead
              </button>
            </p>
          </form>
          <p className="auth-alt">
            Not your number? <Link href={`/login?next=${encodeURIComponent(next)}`}>Start over</Link>
          </p>
        </>
      )}

      {step === "code" && phone && (
        <>
          <p className="auth-intro">
            We texted a 6-digit code to <strong>{formatPhone(phone)}</strong>. Enter it here —
            it’s good for 5 minutes.
          </p>
          {devEcho && (
            <p className="dev-notice">
              <strong>Development mode</strong> — no SMS service is connected yet, so here’s
              your code: <strong className="dev-code">{devEcho}</strong>
            </p>
          )}
          <form action={submitCode}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={phone} />
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-block" type="submit">
              Continue
            </button>
          </form>
          <form className="auth-alt" action={requestCode}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={phone} />
            <p>
              Didn’t get it?{" "}
              <button className="link-button" type="submit">
                Send a new code
              </button>
            </p>
          </form>
        </>
      )}

      {step === "set-password" && phone && (
        <>
          <p className="auth-intro">
            Code confirmed. Now choose a password for <strong>{formatPhone(phone)}</strong> —
            you’ll use it to sign in from now on. At least 8 characters.
          </p>
          <form action={submitSetPassword}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="phone" value={phone} />
            <div className="field">
              <label htmlFor="new-password">Choose a password</label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-block" type="submit">
              Save password and sign in
            </button>
          </form>
        </>
      )}

      <p className="auth-alt">
        New to {site.name}? <Link href="/how-it-works">How it works</Link>
      </p>
    </div>
  );
}
