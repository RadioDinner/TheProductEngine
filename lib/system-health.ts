/**
 * The dashboard's system-health verdict (session 019, user ask: "a system
 * health status. When ads and messages are on and not paused and running, put
 * status 'All systems go'").
 *
 * Pure and dependency-free so the unit suite can pin every verdict without a
 * clock, a database or an environment. The page gathers the facts; this file
 * decides what they mean.
 *
 * The three levels, and the rule for choosing between them:
 *
 *   stopped   Something is preventing sends RIGHT NOW and only you can clear
 *             it — a pause, or a missing texting key. The headline names it.
 *   attention Everything still sends, but something is off enough that you
 *             should know: attack mode, an unconfigured channel, a backlog.
 *   go        "All systems go."
 *
 * Deliberately NOT a fault: the send window being shut. Ads queueing at 11pm
 * is the service working exactly as designed, and colouring it red would
 * teach the operator to ignore the panel — which is the only way a health
 * panel can actually fail.
 */

export type HealthLevel = "go" | "attention" | "stopped";

export interface HealthInput {
  adsPaused: boolean;
  outboundPaused: boolean;
  underAttack: boolean;
  /** Whether the SMS send window is open at this moment. */
  windowOpen: boolean;
  /** "7am–6pm Mon–Fri · 7am–5pm Sat" — operatorWindowLabel, the real hours. */
  windowLabel: string;
  /** "at 7am" / "tomorrow at 7am" — from nextSendLabel. */
  nextSendLabel: string;
  /** Deliveries sitting in the outbox waiting to drain. */
  queuedDeliveries: number;
  /** Past this many, a queue is a backlog worth a second look. */
  backlogThreshold: number;
  /** Supabase configured — i.e. this is the real database, not dev fixtures. */
  databaseLive: boolean;
  /** TELNYX_API_KEY present: without it nothing texts anybody. */
  textingConfigured: boolean;
  /** RESEND_API_KEY present: without it no email edition goes out. */
  emailConfigured: boolean;
  /** STRIPE_SECRET_KEY present: without it nobody can pay. */
  paymentsConfigured: boolean;
}

export interface HealthItem {
  key: string;
  label: string;
  /** Two or three words for the right-hand side of the row. */
  state: string;
  level: HealthLevel;
  detail?: string;
}

export interface HealthReport {
  level: HealthLevel;
  headline: string;
  /** One sentence under the headline. Always says what to do next when
   * something is wrong, because a status nobody can act on is decoration. */
  summary: string;
  items: HealthItem[];
}

const RANK: Record<HealthLevel, number> = { go: 0, attention: 1, stopped: 2 };

function worst(levels: HealthLevel[]): HealthLevel {
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "go" as HealthLevel);
}

export function systemHealth(input: HealthInput): HealthReport {
  const items: HealthItem[] = [];

  items.push({
    key: "ads",
    label: "Ads",
    state: input.adsPaused ? "PAUSED" : "Running",
    level: input.adsPaused ? "stopped" : "go",
    detail: input.adsPaused
      ? "No ad is going out. Approved ads are queueing and will ride when you clear the pause — nothing is lost."
      : "Approved ads broadcast in batches inside the send window.",
  });

  items.push({
    key: "messages",
    label: "Messages",
    state: input.outboundPaused ? "PAUSED" : "Running",
    level: input.outboundPaused ? "stopped" : "go",
    detail: input.outboundPaused
      ? "Command replies, picture pulls and notices are stopped. Sign-in codes and operator alerts still go out."
      : "Replies, picture pulls and notices are flowing.",
  });

  items.push({
    key: "texting",
    label: "Texting (Telnyx)",
    state: input.textingConfigured ? "Connected" : "NOT CONFIGURED",
    level: input.textingConfigured ? "go" : "stopped",
    detail: input.textingConfigured
      ? undefined
      : "TELNYX_API_KEY is not set, so nothing can text anybody. Everything else on this page is academic until it is.",
  });

  items.push({
    key: "window",
    label: "Send window",
    // Not a fault either way — the window is a promise the compliance copy
    // makes to every subscriber, so honouring it is the healthy state.
    state: input.windowOpen ? "Open" : "Quiet hours",
    level: "go",
    detail: input.windowOpen
      ? `Inside ${input.windowLabel}.`
      : `Outside ${input.windowLabel}. Approved ads are queued and go ${input.nextSendLabel}.`,
  });

  const backlog = input.queuedDeliveries > input.backlogThreshold;
  items.push({
    key: "queue",
    label: "Delivery queue",
    state: input.queuedDeliveries === 0 ? "Clear" : `${input.queuedDeliveries} waiting`,
    level: backlog && input.windowOpen ? "attention" : "go",
    detail:
      input.queuedDeliveries === 0
        ? "Nothing waiting to be delivered."
        : backlog && input.windowOpen
          ? "A backlog is draining more slowly than it is filling. Check the Digests tab."
          : "Normal — the queue drains every few minutes.",
  });

  if (input.underAttack) {
    items.push({
      key: "attack",
      label: "Under attack mode",
      state: "ON",
      level: "attention",
      detail:
        "Caps are tightened and outbound is throttled. Turn it off on Settings once the trouble passes — real members feel this too.",
    });
  }

  items.push({
    key: "database",
    label: "Database",
    state: input.databaseLive ? "Connected" : "DEV FIXTURES",
    level: input.databaseLive ? "go" : "attention",
    detail: input.databaseLive
      ? undefined
      : "Running on the local fixture store, not Supabase. Expected in development; on the live site it means SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing.",
  });

  items.push({
    key: "email",
    label: "Email (Resend)",
    state: input.emailConfigured ? "Connected" : "NOT CONFIGURED",
    level: input.emailConfigured ? "go" : "attention",
    detail: input.emailConfigured
      ? undefined
      : "RESEND_API_KEY is not set — email editions and operator alerts can't go out.",
  });

  items.push({
    key: "payments",
    label: "Payments (Stripe)",
    state: input.paymentsConfigured ? "Connected" : "NOT CONFIGURED",
    level: input.paymentsConfigured ? "go" : "attention",
    detail: input.paymentsConfigured
      ? undefined
      : "STRIPE_SECRET_KEY is not set — nobody can add money, and auto top-up can't run.",
  });

  const level = worst(items.map((i) => i.level));

  let headline = "All systems go";
  let summary = "Ads and messages are on, nothing is paused, and everything is running.";

  if (level === "stopped") {
    if (!input.textingConfigured) {
      headline = "Texting isn't configured";
      summary = "Nothing can go out until TELNYX_API_KEY is set.";
    } else if (input.adsPaused && input.outboundPaused) {
      headline = "Ads and messages are paused";
      summary = "Both emergency stops are on. Clear them on Settings when you're ready.";
    } else if (input.adsPaused) {
      headline = "Ads are paused";
      summary =
        "Approved ads are queueing rather than going out. Clear the pause on Settings — nothing is lost in the meantime.";
    } else {
      headline = "Messages are paused";
      summary =
        "Replies, picture pulls and notices are stopped. Ads are still going out. Clear the pause on Settings.";
    }
  } else if (level === "attention") {
    const flagged = items.filter((i) => i.level === "attention").map((i) => i.label);
    headline = "Running, with something to look at";
    summary = `Ads and messages are both on. Worth a look: ${flagged.join(", ")}.`;
  } else if (!input.windowOpen) {
    // Healthy, but say why nothing is moving — otherwise a green panel over a
    // silent service reads as a lie.
    summary = `Ads and messages are on and nothing is paused. It's outside ${input.windowLabel}, so approved ads are queued and go ${input.nextSendLabel}.`;
  }

  return { level, headline, summary, items };
}
