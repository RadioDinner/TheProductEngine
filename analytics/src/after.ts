/**
 * "Run this after the response has gone out, and keep the process alive until
 * it finishes."
 *
 * The problem, and why this file exists rather than a direct import:
 *
 * On a serverless platform, work still pending when the response is returned
 * can be killed with the invocation. A bare `void analytics.x()` is therefore
 * delivered *most* of the time — which is the worst failure mode available: the
 * count is wrong by an unknown amount and still looks entirely plausible.
 *
 * Next's `after()` from `next/server` solves exactly that. But `lib/engine.ts`
 * — where the most valuable events live, because it is the only place that
 * knows whether an ad was actually accepted — is imported by the unit and abuse
 * suites under plain node, and `next/server` does not resolve there. Importing
 * it would trade correct analytics for a broken test suite.
 *
 * So the implementation is INJECTED. Route handlers, which already import
 * `next/server` and are never loaded by the tests, register it at module load:
 *
 *     import { after } from "next/server";
 *     import { setAfterImpl } from "@/analytics/src/after";
 *     setAfterImpl(after);
 *
 * Everything else calls `afterResponse()` and neither knows nor cares. Under
 * the test harness nothing registers, the fallback runs the work inline, and no
 * Next internals are ever loaded.
 */

type AfterFn = (work: () => void | Promise<void>) => void;

let impl: AfterFn | null = null;

/** Called once, at module load, by any route handler that can import it. */
export function setAfterImpl(fn: AfterFn): void {
  impl = fn;
}

/** Test seam — lets a test assert the fallback path without a stale global. */
export function clearAfterImpl(): void {
  impl = null;
}

export function afterImplRegistered(): boolean {
  return impl !== null;
}

/**
 * Schedule work to run after the response. Never throws, never blocks.
 *
 * `after()` must be called inside a request context. When this runs outside one
 * — a cron tick, a test, a script — it throws, and the fallback runs the work
 * fire-and-forget instead. That is the correct outcome in every one of those
 * cases: none of them have a response to outlive.
 */
export function afterResponse(work: () => void | Promise<void>): void {
  if (impl) {
    try {
      impl(work);
      return;
    } catch {
      // Outside a request scope. Fall through and just run it.
    }
  }
  try {
    const result = work();
    // Swallow the rejection of a promise nobody is awaiting: an unhandled
    // rejection can take the whole process down on some runtimes, and an
    // analytics call must never be able to do that.
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    /* an analytics call is never worth an exception */
  }
}
