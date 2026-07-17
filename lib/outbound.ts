/**
 * The single outbound choke point. Every subscriber- or user-facing SMS/email
 * send that is NOT the digest outbox goes through dispatchSms / dispatchEmail,
 * so the operator kill switches (PAUSE), the blocklist, and the under-attack
 * throttle can stop a send in ONE place instead of being re-checked at ten call
 * sites. The digest outbox drain enforces the same PAUSE/throttle at batch
 * level (so paused rows stay queued, never marked failed).
 *
 * Send classes and how each control treats them:
 *   bulk          digests + new-subscriber catch-up   (drain handles these)
 *   reply         command replies, moderation notices
 *   pic           PIC picture (MMS) replies
 *   transactional sign-in codes, email confirm/welcome
 *   operator      alert emails to the business — never blocked by any control
 */
import { sms } from "@/lib/sms";
import { email, type EmailMessage } from "@/lib/email";
import { getEngineSettings, type EngineSettings } from "@/lib/settings";
import { gsmSanitize } from "@/lib/sms-segments";
import { isBlockedNumber } from "@/lib/blocklist";
import { countRecentOutbound } from "@/lib/engine-store";

export type SendClass = "bulk" | "reply" | "pic" | "transactional" | "operator";
export type PauseMode = EngineSettings["pauseMode"];

export interface DispatchResult {
  sent: boolean;
  reason?: "paused" | "blocked" | "throttled";
}

/** Does this pause mode block this class of outbound? Operator alerts never are. */
export function pauseBlocks(cls: SendClass, mode: PauseMode): boolean {
  if (cls === "operator") return false;
  if (mode === "all") return true; // FULL kill: everything else off
  if (mode === "bulk") return cls === "bulk"; // PARTIAL: only bulk off
  return false;
}

/**
 * Shared gate for a single SMS/email send. Order: pause (deliberate stop) →
 * blocklist (SMS destinations only) → under-attack throttle. Operator sends
 * skip every gate. Returns the settings it loaded so callers can reuse them.
 */
async function gate(
  cls: SendClass,
  to: string | null,
  settings: EngineSettings | undefined,
): Promise<{ ok: boolean; reason?: DispatchResult["reason"]; settings: EngineSettings }> {
  const s = settings ?? (await getEngineSettings());
  if (cls === "operator") return { ok: true, settings: s };
  if (pauseBlocks(cls, s.pauseMode)) return { ok: false, reason: "paused", settings: s };
  if (to && (await isBlockedNumber(to))) return { ok: false, reason: "blocked", settings: s };
  // Under-attack throttle: a global sends/minute ceiling on non-digest outbound
  // (replies/PIC/transactional). Count-based, so a rare concurrent overshoot is
  // possible and harmless; digests are throttled separately in the drain.
  if (s.underAttack && s.outboundThrottlePerMin > 0) {
    const lastMinute = await countRecentOutbound(null, 60_000);
    if (lastMinute >= s.outboundThrottlePerMin) {
      return { ok: false, reason: "throttled", settings: s };
    }
  }
  return { ok: true, settings: s };
}

/** Send one SMS/MMS through the guard. `settings` may be passed to avoid a reload. */
export async function dispatchSms(
  to: string,
  body: string,
  opts: { cls: SendClass; media?: string[]; settings?: EngineSettings },
): Promise<DispatchResult> {
  const g = await gate(opts.cls, to, opts.settings);
  if (!g.ok) {
    // Name every suppressed send in the function logs: a pause/blocklist/
    // throttle drop is deliberate, but "deliberate" must never mean invisible —
    // an operator staring at a silent phone needs this line to exist.
    console.warn(`[outbound] ${opts.cls} SMS to ${to} suppressed: ${g.reason}`);
    return { sent: false, reason: g.reason };
  }
  try {
    // GSM-sanitize at the choke point (idempotent): one em dash or curly quote
    // in a reply-class body would flip the whole message to UCS-2 — billed at
    // 70/67 chars per segment and mangled on flip phones. The digest outbox
    // doesn't pass through here and already sanitizes at composition.
    await sms.send(to, gsmSanitize(body), opts.media);
  } catch (e) {
    console.error(`[outbound] ${opts.cls} SMS to ${to} send failed:`, e);
    throw e;
  }
  return { sent: true };
}

/** Send one email through the guard (no blocklist — that's phone-only). */
export async function dispatchEmail(
  msg: EmailMessage,
  opts: { cls: SendClass; settings?: EngineSettings },
): Promise<DispatchResult> {
  const g = await gate(opts.cls, null, opts.settings);
  if (!g.ok) {
    console.warn(`[outbound] ${opts.cls} email suppressed: ${g.reason}`);
    return { sent: false, reason: g.reason };
  }
  try {
    await email.send(msg);
  } catch (e) {
    console.error(`[outbound] ${opts.cls} email send failed:`, e);
    throw e;
  }
  return { sent: true };
}
