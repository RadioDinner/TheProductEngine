/**
 * GA4 Measurement Protocol — the server-side half of the measurement, and on
 * this service the more important half.
 *
 * SERVER ONLY.
 *
 * Why this exists at all: the browser tag can only see people who load a web
 * page with JavaScript enabled. On The Plain Exchange, most of the business
 * happens somewhere else — an ad arrives by text, a seller replies by text, a
 * buyer calls the number, the operator approves in the admin, a cron sends the
 * email edition, Stripe confirms a payment by webhook. A browser-only setup
 * would report on the smallest and least representative slice of the service
 * and call it "the analytics".
 *
 * Everything here is fire-and-forget by contract:
 *
 * - It never throws. An analytics failure must never fail a member's text.
 * - It times out in 10 seconds (MP_TIMEOUT_MS), the same rule lib/sms.ts uses.
 * - It returns silently when unconfigured, so a dev machine sends nothing.
 * - Callers do not await it in a request path. `void sendServerEvents(...)`.
 *
 * The one thing to know about the live endpoint: **it returns 204 for
 * everything**, including payloads it discards entirely. A wrong event name, a
 * missing client_id, a 26th parameter — all 204. This is why GA_VALIDATE_ONLY
 * and `validateServerEvents` exist, and why you should build every new event
 * against the debug endpoint first. Sending blind and assuming success is how
 * people end up trusting an empty report for a month.
 */
import {
  GA_API_SECRET,
  GA_DEBUG_MODE,
  GA_LIMITS,
  GA_MEASUREMENT_ID,
  GA_VALIDATE_ONLY,
  MP_DEBUG_ENDPOINT,
  MP_ENDPOINT,
  MP_TIMEOUT_MS,
  serverEventsEnabled,
  serverEventsBlockedReason,
} from "./config";
import { sanitizeParams, type GaItem, type GaParams, type GaParamValue } from "./events";

export interface ServerEvent {
  name: string;
  params?: GaParams;
}

export interface SendOptions {
  /** Required by GA. Use the browser's `_ga` value when there is one, else
   *  clientIdForPhone() so an SMS member stays one consistent GA user. */
  clientId: string;
  /** The salted hash from ids.ts. Never a phone number. */
  userId?: string;
  /** Groups a burst of events into one GA session. */
  sessionId?: number | string;
  events: ServerEvent[];
  /** For backfilling. GA drops anything older than 72 hours without comment. */
  timestampMicros?: number;
  /** User-scoped dimensions: member_status, signup_channel, line_type… */
  userProperties?: Record<string, string | number>;
  /**
   * Adds `debug_mode` to every event, which is what makes a server-side event
   * visible in GA4's DebugView. Defaults to the GA_DEBUG_MODE environment
   * variable; pass it explicitly only in tests.
   */
  debugMode?: boolean;
  /** Injection seams for tests. */
  fetchImpl?: typeof fetch;
  endpointOverride?: string;
  now?: () => number;
}

export interface SendResult {
  ok: boolean;
  /** Set when nothing was sent, and why. */
  skipped?: string;
  eventsSent: number;
  batches: number;
  statuses: number[];
  /** Parameters clamped away by the GA4 limits, for logging. */
  dropped: string[];
}

/** GA4's user_properties wire shape: { name: { value } }. */
function wireUserProperties(
  props: Record<string, string | number> | undefined,
): Record<string, { value: string | number }> | undefined {
  if (!props) return undefined;
  const out: Record<string, { value: string | number }> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    const key = name.slice(0, GA_LIMITS.userPropertyNameMaxLength);
    out[key] =
      typeof value === "string"
        ? { value: value.slice(0, GA_LIMITS.userPropertyValueMaxLength) }
        : { value };
  }
  return Object.keys(out).length ? out : undefined;
}

export interface MpPayload {
  client_id: string;
  user_id?: string;
  timestamp_micros?: number;
  non_personalized_ads: boolean;
  consent: { ad_user_data: "DENIED"; ad_personalization: "DENIED" };
  user_properties?: Record<string, { value: string | number }>;
  events: { name: string; params: Record<string, GaParamValue | GaItem[]> }[];
}

/**
 * Build one request body. Pure, exported, and unit-tested — this is where the
 * GA4 rules that have no error message live.
 *
 * `engagement_time_msec` and `session_id` are added to every event on purpose.
 * Without them GA accepts the event and then leaves it out of Realtime and out
 * of most standard reports, which reads exactly like "the integration is
 * broken" and sends you looking in the wrong place for days.
 */
export function buildPayload(opts: SendOptions, events: ServerEvent[]): {
  payload: MpPayload;
  dropped: string[];
} {
  const dropped: string[] = [];
  const wired = events.map((event) => {
    const base: GaParams = {
      ...(event.params ?? {}),
      engagement_time_msec: 1,
    };
    if (opts.sessionId !== undefined) base.session_id = String(opts.sessionId);
    if (opts.debugMode ?? GA_DEBUG_MODE) base.debug_mode = true;
    const clean = sanitizeParams(base);
    for (const key of clean.dropped) dropped.push(`${event.name}.${key}`);
    return { name: event.name, params: clean.params };
  });

  const payload: MpPayload = {
    client_id: opts.clientId,
    non_personalized_ads: true,
    // Belt and braces against the advertising surface. The property-level
    // switches are off too (03-ga4-console-setup.md); this says it again on
    // every single event so a console setting changed by accident cannot
    // quietly opt members into ad personalisation.
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    events: wired,
  };
  if (opts.userId) payload.user_id = opts.userId;
  if (opts.timestampMicros) payload.timestamp_micros = opts.timestampMicros;
  const props = wireUserProperties(opts.userProperties);
  if (props) payload.user_properties = props;
  return { payload, dropped };
}

/** Split into GA-legal batches (25 events per request). */
export function batchEvents(events: ServerEvent[]): ServerEvent[][] {
  const out: ServerEvent[][] = [];
  for (let i = 0; i < events.length; i += GA_LIMITS.eventsPerRequest) {
    out.push(events.slice(i, i + GA_LIMITS.eventsPerRequest));
  }
  return out;
}

/** True when the timestamp is inside GA's 72-hour backdating window. */
export function withinBackdateWindow(timestampMicros: number, nowMs: number): boolean {
  const ageMs = nowMs - timestampMicros / 1000;
  return ageMs >= 0 && ageMs <= GA_LIMITS.backdateHours * 60 * 60 * 1000;
}

function endpointFor(opts: SendOptions): string {
  if (opts.endpointOverride) return opts.endpointOverride;
  return GA_VALIDATE_ONLY ? MP_DEBUG_ENDPOINT : MP_ENDPOINT;
}

/**
 * Send events. Never throws; returns what happened so a caller that wants to
 * log or health-check can, and a caller that does not can ignore it entirely.
 */
export async function sendServerEvents(opts: SendOptions): Promise<SendResult> {
  const empty: SendResult = { ok: true, eventsSent: 0, batches: 0, statuses: [], dropped: [] };

  if (!opts.endpointOverride && !serverEventsEnabled) {
    return { ...empty, ok: false, skipped: serverEventsBlockedReason() ?? "not configured" };
  }
  if (!opts.clientId) {
    // No client id is not a thing GA can accept, and inventing a random one
    // would turn this member into a brand-new "user" — see ids.ts.
    return { ...empty, ok: false, skipped: "no client_id" };
  }
  if (!opts.events.length) return empty;

  const nowMs = (opts.now ?? Date.now)();
  if (opts.timestampMicros && !withinBackdateWindow(opts.timestampMicros, nowMs)) {
    return { ...empty, ok: false, skipped: "timestamp outside GA's 72-hour window" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url =
    `${endpointFor(opts)}?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(GA_API_SECRET)}`;

  const statuses: number[] = [];
  const dropped: string[] = [];
  let eventsSent = 0;
  let ok = true;

  for (const batch of batchEvents(opts.events)) {
    const built = buildPayload(opts, batch);
    dropped.push(...built.dropped);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MP_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.payload),
        signal: controller.signal,
      });
      statuses.push(res.status);
      if (res.status >= 200 && res.status < 300) {
        eventsSent += batch.length;
      } else {
        ok = false;
        console.error("[analytics] measurement protocol returned", res.status);
      }
    } catch (e) {
      ok = false;
      console.error("[analytics] measurement protocol send failed:", e);
    } finally {
      clearTimeout(timer);
    }
  }

  if (dropped.length) {
    console.error("[analytics] parameters dropped by GA4 limits:", dropped.join(", "));
  }
  return { ok, eventsSent, batches: statuses.length, statuses, dropped };
}

export interface ValidationMessage {
  fieldPath?: string;
  description?: string;
  validationCode?: string;
}

/**
 * Ask GA what is wrong with a payload, using the debug endpoint. Returns the
 * messages, or a single synthetic message when the call itself failed.
 *
 * Use this from a scratch script or an admin diagnostic when adding an event.
 * An empty array means GA would accept it — which is not the same as "the
 * event is meaningful", but it does rule out the whole class of silent drops.
 */
export async function validateServerEvents(
  opts: SendOptions,
): Promise<ValidationMessage[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url =
    `${MP_DEBUG_ENDPOINT}?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(GA_API_SECRET)}`;
  const { payload } = buildPayload(opts, opts.events);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await res.json()) as { validationMessages?: ValidationMessage[] };
    return body.validationMessages ?? [];
  } catch (e) {
    return [{ description: `validation request failed: ${String(e)}` }];
  } finally {
    clearTimeout(timer);
  }
}
