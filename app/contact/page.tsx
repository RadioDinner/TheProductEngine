import type { Metadata } from "next";
import Link from "next/link";
import { readSession } from "@/lib/session";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { getAccount } from "@/lib/store";
import { submitFeedback } from "@/lib/contact-actions";
import { CONTACT_MAX, NAME_MAX } from "@/lib/contact-details";

export const metadata: Metadata = {
  title: `Ask a question or suggest a feature — ${site.name}`,
  description: `Send ${site.name} a question or a feature idea — we read every one and get back to you.`,
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await readSession();
  await recordVisit("/contact");

  // Signed in? Fill the contact fields in for them (user request, session
  // 018). The NAME is never prefilled because an account does not carry one —
  // and guessing a name from a phone number would be worse than asking.
  let memberEmail = "";
  if (session) {
    try {
      memberEmail = (await getAccount(session.phone))?.email ?? "";
    } catch {
      memberEmail = "";
    }
  }

  const isIdea = params.type === "idea";
  const kind = isIdea ? "idea" : "question";
  const heading = isIdea ? "Suggest a feature" : "Ask a question";

  return (
    <div className="container account">
      <h1>{heading}</h1>

      {params.sent ? (
        <div className="notice" role="status">
          <p>
            <strong>Thank you — we got it.</strong> We&rsquo;ll reach out using the
            contact info you left. In a hurry? Call us at {site.supportPhone}.
          </p>
          <p>
            <Link href="/">← Back to the ads</Link>
          </p>
        </div>
      ) : (
        <>
          <p>
            {isIdea
              ? `Have an idea for a feature that would make ${site.name} better? Tell us — we read every one.`
              : `Have a question? Send it our way and we&rsquo;ll get back to you.`}{" "}
            Prefer to talk? Call {site.supportPhone}.
          </p>

          <p className="contact-switch">
            <Link href="/contact?type=question" aria-current={!isIdea ? "page" : undefined}>
              Ask a question
            </Link>
            {" · "}
            <Link href="/contact?type=idea" aria-current={isIdea ? "page" : undefined}>
              Suggest a feature
            </Link>
          </p>

          {params.error === "empty" && (
            <p className="form-error" role="alert">
              Please write your {isIdea ? "idea" : "question"} first.
            </p>
          )}
          {params.error === "badfirstName" && (
            <p className="form-error" role="alert">
              Please enter your first name.
            </p>
          )}
          {params.error === "badlastName" && (
            <p className="form-error" role="alert">
              Please enter your last name.
            </p>
          )}
          {params.error === "badphone" && (
            <p className="form-error" role="alert">
              That phone number doesn&rsquo;t look right — 10 digits, like (330) 555-0123.
            </p>
          )}
          {params.error === "bademail" && (
            <p className="form-error" role="alert">
              That email doesn&rsquo;t look right — check it and try again.
            </p>
          )}
          {params.error === "toolong" && (
            <p className="form-error" role="alert">
              That&rsquo;s a bit long — please shorten it and try again.
            </p>
          )}
          {params.error === "link" && (
            <p className="form-error" role="alert">
              Please leave web links out — just describe it in plain words.
            </p>
          )}
          {params.error === "nocontact" && (
            <p className="form-error" role="alert">
              Please leave a phone number or an email so we can reach you back.
            </p>
          )}
          {params.error === "noinbox" && (
            <p className="form-error" role="alert">
              We couldn&rsquo;t send that just now — please call us at {site.supportPhone}.
            </p>
          )}
          {params.error === "send" && (
            <p className="form-error" role="alert">
              Something went wrong sending that — please try again, or call{" "}
              {site.supportPhone}.
            </p>
          )}

          <form action={submitFeedback}>
            <input type="hidden" name="kind" value={kind} />
            <div className="field">
              <label htmlFor="c-first">Your first name</label>
              <input
                id="c-first"
                name="firstName"
                type="text"
                required
                autoComplete="given-name"
                maxLength={NAME_MAX}
              />
            </div>
            <div className="field">
              <label htmlFor="c-last">Your last name</label>
              <input
                id="c-last"
                name="lastName"
                type="text"
                required
                autoComplete="family-name"
                maxLength={NAME_MAX}
              />
            </div>
            <div className="field">
              <label htmlFor="c-phone">Phone</label>
              <input
                id="c-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                maxLength={CONTACT_MAX}
                defaultValue={session ? formatPhone(session.phone) : ""}
                placeholder="(330) 555-0123"
              />
            </div>
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input
                id="c-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={CONTACT_MAX}
                defaultValue={memberEmail}
                placeholder="you@example.com"
              />
            </div>
            <p className="fine">
              Leave a phone number or an email — whichever is easier for us to reach you.
              One of the two is enough.
            </p>
            <div className="field">
              <label htmlFor="c-message">{isIdea ? "Your feature idea" : "Your question"}</label>
              <textarea
                id="c-message"
                name="message"
                rows={5}
                required
                maxLength={1500}
                placeholder={
                  isIdea
                    ? "What would make The Plain Exchange better?"
                    : "What can we help you with?"
                }
              />
            </div>
            <button className="btn" type="submit">
              Send it to us
            </button>
          </form>

          <p>
            <Link href="/">← Back to the ads</Link>
          </p>
        </>
      )}
    </div>
  );
}
