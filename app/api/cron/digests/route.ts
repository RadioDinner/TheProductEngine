/**
 * Digest cron endpoint — an external pinger (or Vercel cron) hits this every
 * 5 minutes; the engine decides which ET slots are due and stays idempotent.
 * Composing a due slot ENQUEUES deliveries; the drain below then sends a
 * bounded batch each invocation, so a big subscriber list is delivered across
 * successive ticks instead of timing out mid-loop and dropping the rest.
 * Set CRON_SECRET to require `Authorization: Bearer <secret>` (Vercel sends
 * this automatically for cron invocations when the env var exists).
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { drainDigestOutbox, runDueDigests } from "@/lib/digest-engine";
import { runDueEmailDigests } from "@/lib/email-digest";
import { expireDueAds } from "@/lib/engine-store";
import { isProduction } from "@/lib/env";

/** Vercel function ceiling; the drain's own time budget stays safely under it. */
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed in production: an unprotected digest trigger is a cost attack.
  if (!secret) return !isProduction;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  // Retire ads past their 30-day window before composing, so an expired ad is
  // never included in a digest and drops off the public site (file-store parity).
  const expired = await expireDueAds();
  // SMS first so the email edition can carry what just went out.
  const sms = await runDueDigests();
  const email = await runDueEmailDigests();
  const newlyEnqueued = [...sms, ...email].some((r) => (r.queued ?? 0) > 0);
  // Spend what's left of the invocation (cap 45s) delivering queued rows.
  const drain = await drainDigestOutbox({
    timeBudgetMs: Math.max(5_000, 45_000 - (Date.now() - startedAt)),
    newlyEnqueued,
  });
  return NextResponse.json({ ok: true, expired, sms, email, drain });
}
