"use client";

/**
 * The "test a number check" tool on /admin/settings.
 *
 * A client component purely so the answer appears WHERE THE TOOL IS. The
 * first version was a plain server action that redirected back with the
 * result in the query string; every check was a full navigation, so the page
 * jumped to the top and the operator had to scroll back down to read what
 * they'd just asked for — every time. A diagnostic you run repeatedly must
 * not move the page out from under you.
 *
 * useActionState keeps the last result in place across submissions and gives
 * a real pending state, which matters here: a Twilio round trip takes a
 * moment, and without it the button looks dead.
 */
import { useActionState } from "react";
import { adminTestLookup, type LookupTestResult } from "@/lib/admin-actions";
import {
  isBurnerLine,
  lookupReasonNote,
  lineTypeLabel,
  type LineType,
} from "@/lib/number-lookup";
import { formatPhone } from "@/lib/phone";

export function LookupTester() {
  const [result, action, pending] = useActionState<LookupTestResult | null, FormData>(
    adminTestLookup,
    null,
  );

  return (
    <>
      <form action={action} className="review-form">
        <div className="inline-fields">
          <input
            name="testPhone"
            type="tel"
            placeholder="Number to check…"
            required
            disabled={pending}
          />
          <button className="btn btn-sm" type="submit" disabled={pending}>
            {pending ? "Checking…" : "Check this number"}
          </button>
        </div>
      </form>

      {result && !pending && (
        <p className="notice" role="status">
          {!result.reason ? (
            <>
              <strong>The check is working.</strong> {formatPhone(result.phone)} is{" "}
              <strong>{lineTypeLabel(result.type as LineType)}</strong>
              {result.carrier ? ` (${result.carrier})` : ""}.{" "}
              {isBurnerLine(result.type as LineType)
                ? "The policy treats this as a throwaway line."
                : "The policy treats this as a real number."}
            </>
          ) : (
            <>
              <strong>No answer &mdash; the check is NOT working.</strong>{" "}
              {lookupReasonNote({
                type: "unchecked",
                reason: result.reason as never,
                status: result.status,
              })}{" "}
              Until this is fixed the VoIP policy allows everything, which is the safe
              direction but means it is doing nothing.
            </>
          )}
        </p>
      )}
    </>
  );
}
