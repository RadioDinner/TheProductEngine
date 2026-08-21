"use client";

import Link from "next/link";

/**
 * Error boundary for the whole admin portal.
 *
 * There was none anywhere in the app, which is why a single failing query
 * anywhere under /admin produced a blank "something went wrong" screen with
 * nothing to act on and nothing to report. /admin/batches has gone dark in
 * production three times now; each time the operator's only description was
 * "it gives an error", because that is genuinely all the page said.
 *
 * ⚠️ **In production Next.js deliberately withholds the real message** for an
 * error thrown in a server component — the client gets a generic string plus
 * `error.digest`, a hash that matches a line in the server logs. So this page
 * asks for the digest by name rather than pretending to show a cause it does
 * not have. In development the real message comes through and is shown.
 *
 * It is a client component because error boundaries must be, and it renders
 * nothing an unauthenticated visitor could reach: the /admin layout's
 * `requireAdmin()` gate runs before any page under it.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section aria-labelledby="admin-error-h">
      <h1 id="admin-error-h">This admin page didn&rsquo;t load</h1>
      <p className="fine">
        Something on this page threw an error. The rest of the portal is unaffected —
        the navigation above still works.
      </p>

      {error.digest && (
        <p className="notice" role="status">
          Error code <strong>{error.digest}</strong>. Quote this when reporting it: it
          matches the exact line in the server log that explains what failed.
        </p>
      )}

      {error.message && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}

      <div className="sim-actions">
        <button className="btn btn-sm" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-sm btn-secondary" href="/admin">
          Back to the dashboard
        </Link>
      </div>

      <p className="fine">
        If it keeps failing, the usual causes are a migration that has not been pasted
        yet and a database column a page depends on. <Link href="/admin/help">Help</Link>{" "}
        lists what each page needs.
      </p>
    </section>
  );
}
