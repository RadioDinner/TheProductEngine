// The dashboard's system-health verdict (session 019).
//
// The user's rule, in their words: "when ads and messages are on and not
// paused and running, put status 'All systems go'". These checks pin that
// sentence — and, just as importantly, pin the states that must NOT turn the
// panel red, because a status that cries wolf is a status nobody reads.
import { systemHealth } from "../lib/system-health.ts";

export const name = "system-health";

/** A healthy service in the middle of a Tuesday afternoon. */
function healthy(over = {}) {
  return {
    adsPaused: false,
    outboundPaused: false,
    underAttack: false,
    windowOpen: true,
    windowLabel: "7am–6pm Mon–Fri · 7am–5pm Sat",
    nextSendLabel: "in a few minutes",
    queuedDeliveries: 0,
    backlogThreshold: 40,
    databaseLive: true,
    textingConfigured: true,
    emailConfigured: true,
    paymentsConfigured: true,
    ...over,
  };
}

const item = (report, key) => report.items.find((i) => i.key === key);

export function run(t) {
  // ---- the headline the user asked for ----
  const ok = systemHealth(healthy());
  t.eq("a healthy service says All systems go", ok.headline, "All systems go");
  t.eq("a healthy service is green", ok.level, "go");
  t.eq("every check is green when everything is fine",
    ok.items.every((i) => i.level === "go"), true);
  t.eq("ads read as running", item(ok, "ads").state, "Running");
  t.eq("messages read as running", item(ok, "messages").state, "Running");

  // ---- the pauses: red, and named ----
  const adsOff = systemHealth(healthy({ adsPaused: true }));
  t.eq("an ads pause stops the service", adsOff.level, "stopped");
  t.eq("an ads pause is named", adsOff.headline, "Ads are paused");
  t.eq("an ads pause says nothing is lost", adsOff.summary.includes("nothing is lost"), true);
  t.eq("the ads row says PAUSED", item(adsOff, "ads").state, "PAUSED");
  t.eq("messages are still running under an ads pause",
    item(adsOff, "messages").level, "go");

  const msgsOff = systemHealth(healthy({ outboundPaused: true }));
  t.eq("a message pause stops the service", msgsOff.level, "stopped");
  t.eq("a message pause is named", msgsOff.headline, "Messages are paused");
  t.eq("a message pause says ads still go", msgsOff.summary.includes("Ads are still going out"), true);

  const bothOff = systemHealth(healthy({ adsPaused: true, outboundPaused: true }));
  t.eq("both pauses are named together", bothOff.headline, "Ads and messages are paused");

  // A missing texting key is worse than a pause: nothing can go anywhere, and
  // no amount of un-pausing helps. It has to outrank the pause headlines.
  const noTelnyx = systemHealth(healthy({ textingConfigured: false, adsPaused: true }));
  t.eq("a missing texting key outranks a pause", noTelnyx.headline, "Texting isn't configured");
  t.eq("a missing texting key stops the service", noTelnyx.level, "stopped");

  // ---- quiet hours are NOT a fault ----
  const night = systemHealth(
    healthy({ windowOpen: false, nextSendLabel: "at 7am", queuedDeliveries: 6 }),
  );
  t.eq("quiet hours stay green", night.level, "go");
  t.eq("quiet hours still say All systems go", night.headline, "All systems go");
  t.eq("quiet hours explain the silence", night.summary.includes("at 7am"), true);
  t.eq("the window row is never a fault", item(night, "window").level, "go");
  t.eq("the window row says quiet hours", item(night, "window").state, "Quiet hours");
  // A queue that is waiting BECAUSE the window is shut is doing its job.
  t.eq("an overnight queue is not a backlog",
    systemHealth(healthy({ windowOpen: false, queuedDeliveries: 500 })).level, "go");

  // ---- amber: running, but look at this ----
  const backlog = systemHealth(healthy({ queuedDeliveries: 200 }));
  t.eq("a backlog inside the window wants attention", backlog.level, "attention");
  t.eq("a backlog is not called paused", backlog.headline, "Running, with something to look at");
  t.eq("a backlog names the queue", backlog.summary.includes("Delivery queue"), true);
  t.eq("a small queue is normal", systemHealth(healthy({ queuedDeliveries: 3 })).level, "go");

  const attack = systemHealth(healthy({ underAttack: true }));
  t.eq("attack mode wants attention", attack.level, "attention");
  t.eq("attack mode is listed", item(attack, "attack").state, "ON");
  t.eq("attack mode is absent when off", item(systemHealth(healthy()), "attack"), undefined);

  t.eq("a missing email key wants attention",
    systemHealth(healthy({ emailConfigured: false })).level, "attention");
  t.eq("a missing Stripe key wants attention",
    systemHealth(healthy({ paymentsConfigured: false })).level, "attention");
  t.eq("the fixture store wants attention",
    systemHealth(healthy({ databaseLive: false })).level, "attention");

  // ---- worst-wins ----
  const mixed = systemHealth(healthy({ adsPaused: true, underAttack: true }));
  t.eq("a stop outranks an attention", mixed.level, "stopped");
  t.eq("the attention item is still listed", item(mixed, "attack").level, "attention");

  // ---- every row is complete enough to render ----
  const all = systemHealth(
    healthy({
      adsPaused: true,
      outboundPaused: true,
      underAttack: true,
      windowOpen: false,
      databaseLive: false,
      textingConfigured: false,
      emailConfigured: false,
      paymentsConfigured: false,
      queuedDeliveries: 99,
    }),
  );
  t.eq("every row has a key, a label and a state",
    all.items.every((i) => i.key && i.label && i.state), true);
  t.eq("row keys are unique", new Set(all.items.map((i) => i.key)).size, all.items.length);
  t.eq("a headline is always present", Boolean(all.headline && all.summary), true);
}
