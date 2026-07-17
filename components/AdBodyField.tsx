"use client";

import { useState } from "react";

/**
 * The ad-text box with its live character counter (FEATURES item 9) — the
 * app's first client component, kept deliberately tiny and self-contained.
 * The REAL limit is enforced server-side against the live maxChars setting;
 * this mirror just keeps nobody typing 400 characters blind. Deliberately no
 * maxLength attribute: emoji are stripped server-side (which can shorten the
 * text), and an over-long paste should reach the server's friendly refusal
 * instead of being silently truncated.
 */
export function AdBodyField({ maxChars }: { maxChars: number }) {
  const [length, setLength] = useState(0);
  const over = length > maxChars;
  return (
    <div className="field">
      <label htmlFor="ad-body">Your ad</label>
      <textarea
        id="ad-body"
        name="body"
        rows={4}
        required
        placeholder="Horse cart for sale, $1,000 OBO. Call 330-555-0142."
        onChange={(event) => setLength(event.target.value.length)}
      />
      <p
        className={`char-count${over ? " char-count-over" : ""}`}
        aria-live="polite"
        data-testid="char-count"
      >
        {length}/{maxChars} characters{over ? " — too long to post, please shorten" : ""}
      </p>
    </div>
  );
}
