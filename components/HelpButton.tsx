"use client";

/**
 * The "I need help!" button (feature 39) — fixed to the corner of every page.
 *
 * WHY FIXED rather than a footer link next to Ask a question: a help button
 * is needed most by somebody already stuck on a page, and "scroll to the
 * bottom to find help" is the moment most people give up instead. It stays
 * small and out of the way, and it is a real <button> in the tab order.
 *
 * WHY THE NOTE IS OPTIONAL: the point of this feature is that a stuck member
 * usually cannot describe what went wrong. The diagnostics describe it for
 * them — which page, signed in as whom, on what browser, at what size, what
 * the page last threw. Requiring a sentence first would lose exactly the
 * reports worth having.
 *
 * WHY THE NAME AND CONTACT ARE NOT (user decision, session 018): a report
 * nobody can reply to is a mystery to be solved rather than a person to call
 * back. Name and one of phone/email are required; a signed-in member gets the
 * contact fields filled in for them, so it stays a two-word form.
 *
 * The SESSION identity is still read server-side and never sent from here —
 * what the member types is contact information, not proof of who they are.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { helpPrefill, submitHelpReport, type HelpSubmitState } from "@/lib/help-actions";
import { NOTE_MAX } from "@/lib/help-reports";
import { CONTACT_MAX, NAME_MAX } from "@/lib/contact-details";

/** The last error the page saw, captured from load so a report filed after
 * something broke carries the thing that broke. */
function useLastError(): React.RefObject<string> {
  const ref = useRef("");
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      ref.current = `${e.message} @ ${e.filename ?? "?"}:${e.lineno ?? 0}`;
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      ref.current = `unhandled rejection: ${String(e.reason).slice(0, 200)}`;
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return ref;
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const lastError = useLastError();
  const [prefill, setPrefill] = useState<{ phone: string; email: string } | null>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<HelpSubmitState | null, FormData>(
    submitHelpReport,
    null,
  );

  // Close on Escape, like any dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Ask for the signed-in member's contact details when the panel OPENS, not
  // on every page render — this is a database read, and the overwhelming
  // majority of page views never open the panel. A signed-out visitor gets
  // empty strings and types their own.
  useEffect(() => {
    if (!open || prefill) return;
    let live = true;
    helpPrefill()
      .then((values) => {
        if (live) setPrefill(values);
      })
      .catch(() => {
        if (live) setPrefill({ phone: "", email: "" });
      });
    return () => {
      live = false;
    };
  }, [open, prefill]);

  // Fill the two contact fields when the answer arrives, and ONLY if they are
  // still empty. Re-rendering the form with new defaults (or remounting it on
  // a key) would throw away whatever the member typed in the few hundred
  // milliseconds the lookup took — which is exactly the moment they are
  // typing, because the panel just opened.
  useEffect(() => {
    if (!prefill) return;
    if (phoneRef.current && !phoneRef.current.value) phoneRef.current.value = prefill.phone;
    if (emailRef.current && !emailRef.current.value) emailRef.current.value = prefill.email;
  }, [prefill]);

  if (!open) {
    return (
      <button
        type="button"
        className="help-fab"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        I need help!
      </button>
    );
  }

  const done = state?.ok && !pending;

  return (
    <div className="help-panel" role="dialog" aria-modal="false" aria-label="Get help">
      <button
        type="button"
        className="help-close"
        onClick={() => setOpen(false)}
        aria-label="Close"
      >
        ×
      </button>

      {done ? (
        <>
          <p>
            <strong>Thank you — that&rsquo;s been sent.</strong>
          </p>
          <p className="fine">
            We can see what page you were on and what you were using, so you don&rsquo;t
            need to explain any of that. If it&rsquo;s urgent, call us.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </>
      ) : (
        <form action={action}>
          <p>
            <strong>What&rsquo;s giving you trouble?</strong>
          </p>
          <p className="fine">
            Tell us who you are and how to reach you, and we&rsquo;ll get back to you.
            We&rsquo;ll already see which page you were on and what you&rsquo;re using — say
            a bit more if you can.
          </p>
          <div className="inline-fields">
            <input
              name="firstName"
              type="text"
              required
              maxLength={NAME_MAX}
              autoComplete="given-name"
              placeholder="First name"
              aria-label="First name"
              disabled={pending}
            />
            <input
              name="lastName"
              type="text"
              required
              maxLength={NAME_MAX}
              autoComplete="family-name"
              placeholder="Last name"
              aria-label="Last name"
              disabled={pending}
            />
          </div>
          <div className="inline-fields">
            <input
              ref={phoneRef}
              name="contactPhone"
              type="tel"
              maxLength={CONTACT_MAX}
              autoComplete="tel"
              placeholder="Phone"
              aria-label="Phone"
              disabled={pending}
            />
            <input
              ref={emailRef}
              name="contactEmail"
              type="email"
              maxLength={CONTACT_MAX}
              autoComplete="email"
              placeholder="Email"
              aria-label="Email"
              disabled={pending}
            />
          </div>
          <p className="fine">Phone or email — whichever is easier.</p>
          <textarea
            name="note"
            rows={3}
            maxLength={NOTE_MAX}
            placeholder="Optional — what happened?"
            disabled={pending}
          />
          {/* Environment only. Identity is read server-side from the session. */}
          <input type="hidden" name="path" value={pathname ?? "/"} />
          <input
            type="hidden"
            name="referrer"
            value={typeof document !== "undefined" ? document.referrer : ""}
          />
          <input
            type="hidden"
            name="userAgent"
            value={typeof navigator !== "undefined" ? navigator.userAgent : ""}
          />
          <input
            type="hidden"
            name="viewport"
            value={
              typeof window !== "undefined"
                ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio ?? 1}x`
                : ""
            }
          />
          <input
            type="hidden"
            name="timezone"
            value={
              typeof Intl !== "undefined"
                ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "")
                : ""
            }
          />
          <input type="hidden" name="lastError" value={lastError.current} />
          {state?.message && (
            <p className="form-error" role="alert">
              {state.message}
            </p>
          )}
          {state?.error && (
            <p className="notice" role="alert">
              That didn&rsquo;t send. Please call us and we&rsquo;ll sort it out.
            </p>
          )}
          <button className="btn btn-sm" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
