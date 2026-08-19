/**
 * The call log for the call-in card line (/api/voice) — "I want to know when
 * someone calls, how long they stay on the call and who called" (user
 * request, session 016).
 *
 * One row per inbound call, keyed by Twilio's CallSid, upserted as the call
 * moves through its stages so the row always reflects the latest known
 * state. Reading it is /admin/calls.
 *
 * Logging must NEVER break a call in progress: every writer swallows its
 * errors (loudly, to the function log). A missing `call_log` table — the
 * migration hasn't been pasted yet — therefore reads as "no history", not as
 * a dead phone line. Same graceful-degradation rule as the rest of the app.
 *
 * Dev (no Supabase) keeps calls in memory only; there is no real phone line
 * without a deployment anyway.
 */
import { db, supabaseConfigured } from "@/lib/db";

/** Where a call ended up. The flow widens this as it goes. */
export type CallOutcome =
  | "ringing"
  | "answered"
  | "attendant"
  | "card_saved"
  | "card_failed"
  | "voicemail";

export interface CallRecord {
  callSid: string;
  fromPhone: string | null;
  toPhone: string | null;
  outcome: CallOutcome;
  durationSeconds: number | null;
  detail: string | null;
  recordingUrl: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface CallPatch {
  outcome?: CallOutcome;
  durationSeconds?: number | null;
  detail?: string | null;
  recordingUrl?: string | null;
  endedAt?: string | null;
}

/** Human-readable outcome, for the admin table. */
export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  ringing: "Rang, no result yet",
  answered: "Answered by you",
  attendant: "Reached the menu",
  card_saved: "Card saved",
  card_failed: "Card failed",
  voicemail: "Left a voicemail",
};

/** "4m 12s" / "38s" / "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ */
/* Dev store — in memory, newest last                                  */
/* ------------------------------------------------------------------ */

const memory: CallRecord[] = [];

/* ------------------------------------------------------------------ */

/** First webhook of a call: open its row. Repeat calls with the same SID are
 * harmless (the unique index makes the insert a no-op). */
export async function startCall(args: {
  callSid: string;
  fromPhone: string | null;
  toPhone: string | null;
}): Promise<void> {
  if (!args.callSid) return;
  if (!supabaseConfigured) {
    if (!memory.some((call) => call.callSid === args.callSid)) {
      memory.push({
        callSid: args.callSid,
        fromPhone: args.fromPhone,
        toPhone: args.toPhone,
        outcome: "ringing",
        durationSeconds: null,
        detail: null,
        recordingUrl: null,
        createdAt: new Date().toISOString(),
        endedAt: null,
      });
    }
    return;
  }
  try {
    const { error } = await db()
      .from("call_log")
      .upsert(
        {
          call_sid: args.callSid,
          from_phone: args.fromPhone,
          to_phone: args.toPhone,
          outcome: "ringing",
        },
        { onConflict: "call_sid", ignoreDuplicates: true },
      );
    if (error) throw error;
  } catch (e) {
    console.error("[calls] could not open the call row:", e);
  }
}

/** Later stages: record what happened. */
export async function updateCall(callSid: string, patch: CallPatch): Promise<void> {
  if (!callSid) return;
  if (!supabaseConfigured) {
    const call = memory.find((row) => row.callSid === callSid);
    if (call) Object.assign(call, patch);
    return;
  }
  try {
    const { error } = await db()
      .from("call_log")
      .update({
        ...(patch.outcome !== undefined && { outcome: patch.outcome }),
        ...(patch.durationSeconds !== undefined && { duration_seconds: patch.durationSeconds }),
        ...(patch.detail !== undefined && { detail: patch.detail }),
        ...(patch.recordingUrl !== undefined && { recording_url: patch.recordingUrl }),
        ...(patch.endedAt !== undefined && { ended_at: patch.endedAt }),
      })
      .eq("call_sid", callSid);
    if (error) throw error;
  } catch (e) {
    console.error("[calls] could not update the call row:", e);
  }
}

/** Newest first. `phone` narrows to one caller. Never throws: an unpasted
 * migration reads as an empty history so /admin/calls still renders. */
export async function listCalls(limit = 100, phone?: string): Promise<CallRecord[]> {
  if (!supabaseConfigured) {
    const all = phone ? memory.filter((call) => call.fromPhone === phone) : memory;
    return all.slice(-limit).reverse();
  }
  try {
    let query = db()
      .from("call_log")
      .select("call_sid, from_phone, to_phone, outcome, duration_seconds, detail, recording_url, created_at, ended_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (phone) query = query.eq("from_phone", phone);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      callSid: row.call_sid as string,
      fromPhone: (row.from_phone as string | null) ?? null,
      toPhone: (row.to_phone as string | null) ?? null,
      outcome: (row.outcome as CallOutcome) ?? "ringing",
      durationSeconds: (row.duration_seconds as number | null) ?? null,
      detail: (row.detail as string | null) ?? null,
      recordingUrl: (row.recording_url as string | null) ?? null,
      createdAt: row.created_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
    }));
  } catch (e) {
    console.error("[calls] could not read the call log (migration 9972 pasted?):", e);
    return [];
  }
}
