"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The little "?" beside an admin control, and the card it opens. The card is a
 * small centered overlay (not an anchored popover) so it can sit inside table
 * cells, labels, and headings without ever clipping or overflowing. Content
 * comes in as props from the server (see components/Tip.tsx) so the handbook
 * text rides the admin-gated page payload, never a public JS chunk.
 */
export function HelpTip({
  title,
  what,
  why,
  gotchas,
}: {
  title: string;
  what: string;
  why: string;
  gotchas?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="help-tip-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Remember: ${title}`}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <span className="help-tip-overlay" onClick={() => setOpen(false)}>
          <span
            className="help-tip-card"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="help-tip-head">
              <span className="help-tip-title">{title}</span>
              <button
                type="button"
                className="help-tip-close"
                aria-label="Close"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                ×
              </button>
            </span>
            <span className="help-tip-text">{what}</span>
            <span className="help-tip-why">
              <strong>Why it exists: </strong>
              {why}
            </span>
            {gotchas && (
              <span className="help-tip-gotcha">
                <strong>Watch out: </strong>
                {gotchas}
              </span>
            )}
          </span>
        </span>
      )}
    </>
  );
}
