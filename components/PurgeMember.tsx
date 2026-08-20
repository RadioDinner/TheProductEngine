"use client";

/**
 * The member-purge tool (/admin/purge, features 37/38).
 *
 * Client-side so the preview lands next to the form instead of at the top of
 * a reloaded page, and so the confirmation step can appear only once there is
 * something real to confirm.
 *
 * The safety model, in order:
 *   1. The first submit is ALWAYS a preview. There is no way to reach the
 *      delete without first seeing what it would remove.
 *   2. The confirmation box only appears after a preview, and the delete
 *      carries the previewed number alongside the typed one — change the
 *      number after previewing and the server drops back to a fresh preview
 *      rather than purging whoever is in the box now.
 *   3. The word DELETE has to be typed. Not a checkbox, which is one
 *      mis-click; typing is a decision.
 */
import { useActionState, useState } from "react";
import { adminPurgeMember, type PurgeState } from "@/lib/admin-actions";
import { formatPhone } from "@/lib/phone";
import { formatPrice } from "@/lib/config";

/** Only rows that exist are worth showing — a wall of zeroes hides the one
 * number that matters. */
function Counts({ state }: { state: PurgeState }) {
  const c = state.counts;
  if (!c) return null;
  const rows: [string, string][] = [
    ["Ads", String(c.ads ?? 0)],
    ["Texts and emails logged", String(c.messages ?? 0)],
    ["Ledger entries", String(c.ledger_entries ?? 0)],
    ["Ledger net", formatPrice(c.ledger_net_cents ?? 0)],
    ["Conversations", String(c.chats ?? 0)],
    ["Number look-ups", String(c.reveals ?? 0)],
    ["Ratings", String(c.ratings ?? 0)],
    ["Recorded sales", String(c.sales ?? 0)],
    ["Strikes", String(c.offenses ?? 0)],
    ["Town-hall events", String(c.events ?? 0)],
    ["Calls", String(c.calls ?? 0)],
    ["Queued sends", String(c.queued_sends ?? 0)],
  ];
  const shown = rows.filter(([label, value]) => value !== "0" || label === "Ledger net");
  return (
    <dl className="account-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PurgeMember() {
  const [state, action, pending] = useActionState<PurgeState | null, FormData>(
    adminPurgeMember,
    null,
  );
  const [phone, setPhone] = useState("");

  // A preview that found somebody and hasn't been carried out yet.
  const previewing = state?.counts && !state.deleted && state.phone === phone.replace(/\D/g, "");

  return (
    <>
      <form action={action} className="review-form">
        <div className="inline-fields">
          <input
            name="phone"
            type="tel"
            placeholder="Member's number…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={pending}
          />
          {previewing && <input type="hidden" name="previewedPhone" value={state!.phone} />}
          {previewing && (
            <input
              name="confirm"
              type="text"
              placeholder="Type DELETE to confirm"
              autoComplete="off"
              disabled={pending}
            />
          )}
          <button
            className={previewing ? "btn btn-sm" : "btn btn-sm btn-secondary"}
            type="submit"
            disabled={pending}
          >
            {pending ? "Working…" : previewing ? "Purge this member" : "Preview what would go"}
          </button>
        </div>
      </form>

      {state && !pending && (
        <>
          {state.error && (
            <p className="notice" role="alert">
              {state.error}
            </p>
          )}
          {state.unsupported && (
            <p className="notice" role="alert">
              The purge function isn&rsquo;t in the database yet — paste migration{" "}
              <strong>9966</strong> in the Supabase SQL editor first. (In development
              there is no purge: reset the fixture store by deleting{" "}
              <code>.data</code>.)
            </p>
          )}
          {state.notFound && (
            <p className="notice" role="status">
              No member with the number {formatPhone(state.phone)}. Nothing to purge.
            </p>
          )}
          {state.deleted && (
            <p className="notice" role="status">
              <strong>Purged {formatPhone(state.phone)}.</strong> Everything below is
              gone, and every Insights figure now reflects that. This cannot be undone.
            </p>
          )}
          {previewing && (
            <p className="notice" role="status">
              <strong>Nothing has been deleted yet.</strong> This is what purging{" "}
              {formatPhone(state.phone)} would remove. To go ahead, type{" "}
              <strong>DELETE</strong> in the box above and press the button again.
            </p>
          )}
          <Counts state={state} />
        </>
      )}
    </>
  );
}
