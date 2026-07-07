/**
 * Digest cron endpoint — vercel.json schedules this every 5 minutes; the
 * engine itself decides which ET slots are due and stays idempotent.
 * Set CRON_SECRET to require `Authorization: Bearer <secret>` (Vercel sends
 * this automatically for cron invocations when the env var exists).
 */
import { NextResponse, type NextRequest } from "next/server";
import { runDueDigests } from "@/lib/digest-engine";
import { runDueEmailDigests } from "@/lib/email-digest";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // SMS first so the email edition can carry what just went out.
  const sms = await runDueDigests();
  const email = await runDueEmailDigests();
  return NextResponse.json({ ok: true, sms, email });
}
