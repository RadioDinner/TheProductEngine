/**
 * Digest cron endpoint — vercel.json schedules this every 5 minutes; the
 * engine itself decides which ET slots are due and stays idempotent.
 * Set CRON_SECRET to require `Authorization: Bearer <secret>` (Vercel sends
 * this automatically for cron invocations when the env var exists).
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDueDigests } from "@/lib/digest-engine";
import { runDueEmailDigests } from "@/lib/email-digest";
import { isProduction } from "@/lib/env";

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
  // SMS first so the email edition can carry what just went out.
  const sms = await runDueDigests();
  const email = await runDueEmailDigests();
  return NextResponse.json({ ok: true, sms, email });
}
