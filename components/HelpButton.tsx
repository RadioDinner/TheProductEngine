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
 * Everything about WHO is filled in server-side from the session cookie; this
 * component never sends identity, only environment.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { submitHelpReport, type HelpSubmitState } from "@/lib/help-actions";
import { NOTE_MAX } from "@/lib/help-reports";

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
            You can just press Send — we&rsquo;ll see which page you were on and what
            you&rsquo;re using. Say a bit more if you can.
          </p>
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
