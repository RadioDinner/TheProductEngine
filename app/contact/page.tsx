import type { Metadata } from "next";
import Link from "next/link";
import { readSession } from "@/lib/session";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { submitFeedback } from "@/lib/contact-actions";

export const metadata: Metadata = {
  title: `Ask a question or suggest an idea — ${site.name}`,
  description: `Send ${site.name} a question or an idea — we read every one and get back to you.`,
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await readSession();
  await recordVisit("/contact");

  const isIdea = params.type === "idea";
  const kind = isIdea ? "idea" : "question";
  const heading = isIdea ? "Suggest an idea" : "Ask a question";

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
              ? `Have an idea to make ${site.name} better? Tell us — we read every one.`
              : `Have a question? Send it our way and we&rsquo;ll get back to you.`}{" "}
            Prefer to talk? Call {site.supportPhone}.
          </p>

          <p className="contact-switch">
            <Link href="/contact?type=question" aria-current={!isIdea ? "page" : undefined}>
              Ask a question
            </Link>
            {" · "}
            <Link href="/contact?type=idea" aria-current={isIdea ? "page" : undefined}>
              Suggest an idea
            </Link>
          </p>

          {params.error === "empty" && (
            <p className="form-error" role="alert">
              Please write your {isIdea ? "idea" : "question"} first.
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
              <label htmlFor="c-name">Your name</label>
              <input id="c-name" name="name" type="text" maxLength={80} placeholder="Optional" />
            </div>
            <div className="field">
              <label htmlFor="c-phone">Phone</label>
              <input
                id="c-phone"
                name="phone"
                type="tel"
                maxLength={120}
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
                maxLength={120}
                placeholder="you@example.com"
              />
            </div>
            <p className="fine">
              Leave a phone number or an email — whichever is easier for us to reach you.
            </p>
            <div className="field">
              <label htmlFor="c-message">{isIdea ? "Your idea" : "Your question"}</label>
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
