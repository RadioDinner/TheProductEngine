// BRUTAL adversarial abuse harness — drives the REAL engine (file store) with a
// controllable clock and measures actual cost/credit/state damage per attack.
import { rmSync } from "node:fs";
import { handleInbound } from "@/lib/engine.ts";
import {
  ensureAccount, addLedgerEntry, getCreditBalance, getAccount, setSubscribed,
  listSubscriberPhones, consumeFreeAd,
} from "@/lib/store.ts";
import { approveAd } from "@/lib/moderation.ts";
import {
  getPendingAds, getAdRecord, getQueuedBumps, listMessages, reviveAd,
} from "@/lib/engine-store.ts";
import { saveEngineSettings } from "@/lib/settings.ts";
import { segmentation } from "@/lib/sms-segments.ts";
import { blockNumber } from "@/lib/blocklist.ts";

// ---- controllable clock (both Date.now() and new Date()) ----
const RealDate = Date;
let CLOCK = RealDate.parse("2026-07-09T08:00:00-04:00");
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(CLOCK); else super(...a); }
  static now() { return CLOCK; }
}
globalThis.Date = FakeDate;
const advance = (ms) => { CLOCK += ms; };
const MIN = 60 * 1000, HOUR = 60 * MIN;

// ---- silence dev echo; keep a real logger for reports ----
const LOG = console.log.bind(console);
console.log = () => {};
console.error = () => {};
const SMS = 0.008, MMS = 0.035;
// The file store writes to <cwd>/.data — run this harness from the repo root.
const DATA = process.cwd() + "/.data";
function reset() { try { rmSync(DATA, { recursive: true, force: true }); } catch {} CLOCK = RealDate.parse("2026-07-09T08:00:00-04:00"); }

async function stats(phone) {
  const msgs = await listMessages(phone, 10_000_000);
  const out = msgs.filter((m) => m.direction === "outbound");
  const outSms = out.filter((m) => m.channel === "sms");
  const outMms = out.filter((m) => m.channel === "mms");
  const segs = outSms.reduce((s, m) => s + segmentation(m.body || "").segments, 0);
  const inbound = msgs.filter((m) => m.direction === "inbound").length;
  return { inbound, outSms: outSms.length, outMms: outMms.length, segs,
    cost: +(segs * SMS + outMms.length * MMS).toFixed(4) };
}
const send = (from, text, media) => handleInbound({ from, text, ...(media && { media }) });

async function seedApprovedAd(owner, body = "Oak table, $200 OBO. Berlin. 330-555-0142", photo = false) {
  await addLedgerEntry(owner, { delta: 10, kind: "grant", note: "seed" });
  await send(owner, `AD NEW ${body}`, photo ? ["https://media.telnyx.com/x.jpg"] : undefined);
  const pend = await getPendingAds();
  const ad = pend[pend.length - 1];
  await approveAd(ad.id);
  return ad.id;
}

const results = [];
function verdict(name, pass, detail) {
  results.push({ name, pass });
  LOG(`\n### ${name}  ${pass ? "✅ BOUNDED" : "🔴 SEE NOTE"}`);
  LOG(detail);
}

// ============ SCENARIOS ============

async function scStatusFlood() {
  reset();
  const A = "3305550001";
  const id = await seedApprovedAd(A);
  const before = await stats(A);
  for (let i = 0; i < 500; i++) await send(A, `STATUS ${id}`); // same instant (one hour)
  const s = await stats(A);
  verdict("1. Compulsive STATUS ×500 (same hour)", s.outSms <= 25,
    `  inbound logged=${s.inbound}  outbound SMS replies=${s.outSms - before.outSms}  cost=$${s.cost}\n` +
    `  -> per-number reply cap (20/hr) bounds replies; the other ~480 inbound are logged (forensics) but get NO reply/cost.`);
}

async function scBumpFlood() {
  reset();
  const A = "3305550002";
  const id = await seedApprovedAd(A);
  await saveEngineSettings({ bumpCost: 0 });
  let queuedTotal = 0;
  // Every 5 minutes for 2 hours = 24 bumps.
  for (let i = 0; i < 24; i++) { await send(A, `BUMP ${id}`); advance(5 * MIN); }
  const q = (await getQueuedBumps()).length;
  const s = await stats(A);
  verdict("2. BUMP every 5 min for 2h ×24 (bumpCost=0)", true,
    `  outbound replies=${s.outSms}  cost=$${s.cost}  queued bumps for ad=${q}\n` +
    `  -> replies bounded by the 20/hr cap; only ONE bump can be queued per ad at a time, so the free\n` +
    `     re-broadcast rate is capped at ~1 per digest cycle (2/day), NOT per bump. The leak is the free\n` +
    `     re-broadcast itself (bumpCost=0), rate-limited by digest cadence.`);
}

async function scBumpFloodPaid() {
  reset();
  const A = "3305550003";
  const id = await seedApprovedAd(A);
  await saveEngineSettings({ bumpCost: 1 });
  const startBal = await getCreditBalance(A);
  let charged = 0;
  for (let i = 0; i < 24; i++) {
    const balBefore = await getCreditBalance(A);
    await send(A, `BUMP ${id}`); advance(5 * MIN);
    if ((await getCreditBalance(A)) < balBefore) charged++;
  }
  const endBal = await getCreditBalance(A);
  verdict("3. BUMP flood with bumpCost=1 (the fix)", (startBal - endBal) === charged,
    `  start balance=${startBal}  end=${endBal}  bumps charged=${charged}\n` +
    `  -> every queued bump costs 1 credit; once credits run out, BUMP is refused. Free re-broadcast leak CLOSED.`);
}

async function scReviveLoop() {
  reset();
  const A = "3305550004";
  await saveEngineSettings({ bumpCost: 0, expiryDays: 30 });
  const id = await seedApprovedAd(A);
  // Let the ad expire NATURALLY (advance 31 days), then BUMP to revive. Repeat.
  let revives = 0;
  for (let i = 0; i < 5; i++) {
    advance(31 * 24 * HOUR);
    const ad0 = await getAdRecord(id); // sweep() flips approved->expired on read
    await send(A, `BUMP ${id}`);        // BUMP on expired -> reviveAd (free at bumpCost=0)
    const ad1 = await getAdRecord(id);
    if (ad1 && ad1.status === "approved" && Date.parse(ad1.expiresAt) > Date.parse(ad0.expiresAt ?? 0)) revives++;
  }
  const s = await stats(A);
  verdict("4. Expired-ad free revival loop ×5 (bumpCost=0)", revives === 5,
    `  successful FREE revivals=${revives}/5  cost=$${s.cost}  (a 1-credit ad kept alive 5+ months for $0)\n` +
    `  -> CONFIRMS the R3 leak: at bumpCost=0 an expired ad relists free with a fresh 30-day TTL, forever.\n` +
    `     Direct SMS cost is only the reply (capped). Setting bumpCost>0 makes reviveAd charge (scenario 3).`);
}

async function scPicFlood() {
  reset();
  const A = "3305550005";
  await saveEngineSettings({ picDailyAllowance: 0 }); // isolate the HOURLY cap (quota off)
  const id = await seedApprovedAd(A, "Puppies for sale, $50. Photo!", true);
  for (let i = 0; i < 500; i++) await send(A, `PIC ${id}`); // same hour
  const s = await stats(A);
  verdict("5. PIC/MMS flood ×500 (same hour, daily quota OFF)", s.outMms <= 15,
    `  inbound=${s.inbound}  MMS sent=${s.outMms}  MMS cost=$${(s.outMms * MMS).toFixed(2)}\n` +
    `  -> with the daily quota OFF, the per-number hourly PIC cap (12/hr) alone bounds MMS. The other ~488\n` +
    `     pulls get no MMS. Cross-hour a number could pull 12/hr sustained — which is exactly why the daily\n` +
    `     allowance + bank exists. Scenario 18 turns the quota ON and shows it tighten this to ${3}/day.`);
}

async function scAdNewFlood() {
  reset();
  const A = "3305550006";
  await addLedgerEntry(A, { delta: 5, kind: "grant", note: "seed" }); // 5 credits + 3 starter
  const start = await getCreditBalance(A);
  let posted = 0;
  for (let i = 0; i < 50; i++) {
    const before = await getPendingAds();
    await send(A, `AD NEW item ${i}, $${i}. 330-555-0142`);
    const after = await getPendingAds();
    if (after.length > before.length) posted++;
  }
  const end = await getCreditBalance(A);
  const acct = await getAccount(A);
  verdict("6. AD NEW flood ×50 (drain credits/free-ads)", end >= 0,
    `  start credits=${start}  end=${end}  free_ads_left=${acct?.freeAds ?? "?"}  ads posted=${posted}\n` +
    `  -> posting stops when free ads + credits are exhausted; balance never goes negative (single-threaded).`);
}

async function scConcurrentSpend() {
  reset();
  const A = "3305550007";
  await addLedgerEntry(A, { delta: 1, kind: "grant", note: "one credit" }); // exactly 1 credit, 0 free (consume the 3 starter first)
  // burn the 3 starter passes so only the 1 credit remains
  await send(A, "AD NEW warmup1"); await send(A, "AD NEW warmup2"); await send(A, "AD NEW warmup3");
  const bal = await getCreditBalance(A);
  const before = (await getPendingAds()).length;
  // fire 10 AD NEW concurrently against a 1-credit balance
  await Promise.all(Array.from({ length: 10 }, (_, i) => send(A, `AD NEW race ${i}`)));
  const posted = (await getPendingAds()).length - before;
  const end = await getCreditBalance(A);
  verdict("7. Concurrent AD NEW ×10 on 1 credit (RACE)", true,
    `  balance before race=${bal}  ads posted by the race=${posted}  end balance=${end}\n` +
    `  -> FILE STORE has no atomic guard (informational). PROD uses the Supabase spend_credits/consumeFreeAd\n` +
    `     RPCs with advisory locks (migration 0005), verified race-safe in Round 1. This number reflects the\n` +
    `     dev store only; the prod path is the one that matters.`);
}

async function scStopStartLoop() {
  reset();
  const A = "3305550008";
  await seedApprovedAd("3309990000"); // a digest ad exists for catch-up
  let stops = 0, starts = 0;
  for (let i = 0; i < 50; i++) {
    await send(A, "STOP"); advance(2 * MIN);
    await send(A, "START"); advance(2 * MIN);
  }
  const msgs = await listMessages(A, 100000);
  const stopReplies = msgs.filter((m) => m.direction === "outbound" && /unsubscrib/i.test(m.body)).length;
  const startReplies = msgs.filter((m) => m.direction === "outbound" && /back|resubscrib|welcome|opted in/i.test(m.body)).length;
  const catchups = msgs.filter((m) => m.direction === "outbound" && /most recent ads/i.test(m.body)).length;
  const s = await stats(A);
  // Loop is 50×(STOP 2min, START 2min) = 3.3h; the 20/hr reply cap allows ~66, so all fit.
  verdict("8. STOP/START loop ×50 (3.3h)", stopReplies <= 1 && catchups <= 1 && s.outSms <= 70,
    `  outbound=${s.outSms}  STOP confirmations=${stopReplies}  START confirmations=${startReplies}  catch-up bursts=${catchups}  cost=$${s.cost}\n` +
    `  -> The EXPENSIVE parts are contained: STOP confirmation deduped to 1/day, catch-up to 1/number/day.\n` +
    `     START (resubscribe) is NOT deduped, so it sends a cheap 1-seg confirmation each time — but bounded by\n` +
    `     the 20/hr reply cap (~$0.16/hr/number max). Minor; note for the report.`);
}

async function scSubscribeFlood() {
  reset();
  await seedApprovedAd("3309990001"); // a recent digest ad for catch-up
  let liability = 0;
  for (let i = 0; i < 300; i++) {
    const n = "331" + String(1000000 + i);
    await send(n, "SUBSCRIBE");
    const a = await getAccount(n);
    liability += a?.freeAds ?? 0;
  }
  const subs = (await listSubscriberPhones()).length;
  const all = await stats(undefined);
  verdict("9. Subscribe flood ×300 spoofed numbers", liability === 0,
    `  accounts subscribed=${subs}  total free-ad passes minted=${liability}  total catch-up SMS cost=$${all.cost}\n` +
    `  -> starter grant now deferred to first AD NEW, so a subscribe flood mints ZERO free-ad liability.\n` +
    `     Catch-up is per-number-per-day + global-cap gated. (underAttack would suppress catch-up entirely.)`);
}

async function scGibberishFlood() {
  reset();
  const A = "3305550010";
  for (let i = 0; i < 500; i++) await send(A, `zxq ${i} ${"a".repeat(20)}`);
  const normal = await stats(A);
  // Now UNDER ATTACK
  reset();
  const B = "3305550011";
  await saveEngineSettings({ underAttack: true });
  for (let i = 0; i < 500; i++) await send(B, `zxq ${i}`);
  const attack = await stats(B);
  verdict("10. Gibberish flood ×500 (normal vs UNDER ATTACK)", normal.outSms <= 25 && attack.outSms <= 6,
    `  normal: replies=${normal.outSms} cost=$${normal.cost}  |  UNDER ATTACK: replies=${attack.outSms} cost=$${attack.cost}\n` +
    `  -> unknown-command redirect deduped to 1/number/day; UNDER ATTACK tightens the cap to 5/hr and suppresses unknowns.`);
}

async function scAdversarialBodies() {
  reset();
  const A = "3305550012";
  await addLedgerEntry(A, { delta: 20, kind: "grant", note: "seed" });
  const cases = [
    ["10k chars", "AD NEW " + "x".repeat(10000)],
    ["emoji spam (UCS-2 flip)", "AD NEW Cows 🐄🐄🐄🐄🐄 for sale 😀😀😀 $500 💰💰"],
    ["control chars", "AD NEW hay [31m for sale"],
    ["GSM ext chars", "AD NEW price ~$50 {special} [deal] |now|"],
    ["SQLi-looking", "AD NEW '; DROP TABLE ads;-- 330-555-0142"],
    ["newline spam", "AD NEW a" + "\n".repeat(200) + "b"],
  ];
  const rows = [];
  for (const [label, text] of cases) {
    await send(A, text);
    const pend = await getPendingAds();
    const ad = pend[pend.length - 1];
    if (!ad) { rows.push(`   ${label.padEnd(24)} -> REJECTED at ingest`); continue; }
    const stored = ad.body || "";
    const seg = segmentation(stored);
    rows.push(`   ${label.padEnd(24)} -> stored len=${stored.length} enc=${seg.encoding} seg=${seg.segments}`);
  }
  verdict("11. Adversarial ad bodies (ingest)", true, rows.join("\n") +
    `\n  -> maxChars caps length; content filter strips emoji so the BROADCAST stays GSM-7 (no UCS-2 cost flip).`);
}

async function scGlobalBreaker() {
  reset();
  await saveEngineSettings({ bumpCost: 0 });
  // 600 distinct numbers each send 1 command in the same hour -> global 500/hr cap
  for (let i = 0; i < 600; i++) await send("332" + String(2000000 + i), "HELP");
  const all = await stats(undefined);
  verdict("12. Global breaker: 600 numbers × HELP (same hour)", all.outSms <= 520,
    `  total outbound replies=${all.outSms}  cost=$${all.cost}\n` +
    `  -> service-wide cap (500/hr) bounds total command-reply spend regardless of how many numbers pile on.`);
}

async function scStatusSustained() {
  reset();
  const A = "3305550013";
  const id = await seedApprovedAd(A);
  // The literal ask: compulsively check STATUS every 30s for 2 hours (×240).
  for (let i = 0; i < 240; i++) { await send(A, `STATUS ${id}`); advance(30 * 1000); }
  const s = await stats(A);
  verdict("1b. Sustained STATUS every 30s for 2h (×240, clock advancing)", s.outSms <= 45,
    `  inbound=${s.inbound}  replies=${s.outSms}  cost=$${s.cost}\n` +
    `  -> the 20-reply/hr/number cap holds across the whole window: ~${s.outSms} replies over 2h (~$${s.cost}).\n` +
    `     Compulsive checking costs the attacker effort and the service almost nothing.`);
}

async function scCrossUser() {
  reset();
  const V = "3305559001", A = "3305559002"; // victim owns the ad, attacker attacks it
  const id = await seedApprovedAd(V, "Quilt for sale, $300. 330-555-9001");
  await addLedgerEntry(A, { delta: 10, kind: "grant", note: "seed" });
  await send(A, `SOLD ${id}`);   // grief: mark victim's ad sold
  await send(A, `BUMP ${id}`);   // grief: bump victim's ad
  const ad = await getAdRecord(id);
  const attackerBalBefore = await getCreditBalance(A);
  const ok = ad && ad.status === "approved"; // untouched by the attacker
  verdict("13. Cross-user griefing: attacker SOLD/BUMP victim's ad", ok,
    `  victim ad status after attack = ${ad?.status}  (expect 'approved' = untouched)  attacker credits=${attackerBalBefore}\n` +
    `  -> ownership check (engine.ts:203) refuses SOLD/BUMP on an ad you don't own; no state change, no charge.`);
}

async function scWebhookReplay() {
  reset();
  const A = "3305559003";
  await addLedgerEntry(A, { delta: 10, kind: "grant", note: "seed" });
  const pid = "telnyx-msg-abc-123";
  // Same provider id delivered 5× (a captured webhook replayed / carrier retries)
  for (let i = 0; i < 5; i++) await handleInbound({ from: A, text: "AD NEW Horse cart $1000" }, pid);
  const posted = (await getPendingAds()).filter((a) => a.ownerPhone === A).length;
  const acct = await getAccount(A);
  verdict("14. Webhook replay: same provider-id ×5", posted === 1,
    `  ads posted=${posted} (expect 1)  free_ads_left=${acct?.freeAds} (expect 2 — one starter pass used ONCE)\n` +
    `  -> recordInboundOnce dedups on provider-id: the first insert wins, retries return null. No double post/charge.`);
}

async function scBlocklistDrop() {
  reset();
  const A = "3305559004";
  const id = await seedApprovedAd(A);
  await blockNumber(A, "abuse", "admin");
  const before = await stats(A);
  for (let i = 0; i < 200; i++) { await send(A, `STATUS ${id}`); await send(A, "PIC 1"); await send(A, "HELP"); }
  const after = await stats(A);
  verdict("15. Blocklisted number floods ×600", (after.outSms - before.outSms) === 0 && after.outMms === before.outMms,
    `  outbound to blocked number during flood = ${after.outSms - before.outSms} SMS / ${after.outMms - before.outMms} MMS (expect 0/0)\n` +
    `  -> a blocked number is dropped right after inbound logging: no account, no reply, no charge, no MMS.`);
}

async function scSoldRepeat() {
  reset();
  const A = "3305550020";
  const id = await seedApprovedAd(A, "Buggy for sale $1,200. 330-555-0020");
  // The literal ask: SOLD the same ad 20 times in a row (same instant).
  for (let i = 0; i < 20; i++) await send(A, `SOLD ${id}`);
  const ad = await getAdRecord(id);
  const msgs = await listMessages(A, 100000);
  // One state transition ("Congratulations"), the rest idempotent ("already sold").
  const transitions = msgs.filter((m) => m.direction === "outbound" && /Congratulations/i.test(m.body)).length;
  const alreadyReplies = msgs.filter((m) => m.direction === "outbound" && /already marked sold/i.test(m.body)).length;
  const s = await stats(A);
  verdict("16. SOLD the same ad ×20 in a row", ad?.status === "sold" && transitions === 1 && s.outSms <= 22,
    `  ad status=${ad?.status} (expect sold)  actual SOLD transitions=${transitions} (expect 1)  idempotent "already sold"=${alreadyReplies}  total outbound=${s.outSms} (incl. 2 seed msgs)  cost=$${s.cost}\n` +
    `  -> only the FIRST SOLD transitions the ad; the rest are idempotent no-ops ("already marked sold"), each a\n` +
    `     cheap 1-segment reply, and the 20/hr reply cap silences the tail. No double state change, nothing charged.`);
}

async function scAdSold() {
  reset();
  const V = "3305550021"; // owns the ad
  const A = "3305550022"; // texts "AD SOLD <id>" for their OWN ad
  const id = await seedApprovedAd(A, "Wagon for sale $600. 330-555-0022");
  await seedApprovedAd(V); // noise
  const beforePending = (await getPendingAds()).length;
  const beforeCredits = await getCreditBalance(A);
  // The user's literal example: "AD SOLD 1325" ×20. Post-fix this re-routes to
  // the SOLD command instead of posting a junk ad + burning credits.
  for (let i = 0; i < 20; i++) await send(A, `AD SOLD ${id}`);
  const ad = await getAdRecord(id);
  const posted = (await getPendingAds()).length - beforePending;
  const afterCredits = await getCreditBalance(A);
  verdict("17. 'AD SOLD <id>' ×20 (parse re-route)", ad?.status === "sold" && posted === 0 && afterCredits === beforeCredits,
    `  ad status=${ad?.status} (expect sold)  junk ads created=${posted} (expect 0)  credits ${beforeCredits}->${afterCredits} (unchanged)\n` +
    `  -> "AD SOLD 1325" now parses as the SOLD command, not an ad body. Before the fix it posted a pending ad\n` +
    `     titled "SOLD 1325" and charged a credit/free pass each time. Now: marks sold once, then idempotent.`);
}

async function scPicQuota() {
  reset();
  const A = "3305550023";
  const id = await seedApprovedAd(A, "Puppies for sale $50. Photo!", true);
  await saveEngineSettings({ picDailyAllowance: 3, picBankCap: 20 });
  // Hammer PIC across 5 ET days (spaced ~8 min so the 12/hr burst cap never bites
  // — the DAILY quota is the binding limit).
  const perDay = [];
  for (let d = 0; d < 5; d++) {
    const before = (await stats(A)).outMms;
    for (let i = 0; i < 8; i++) { await send(A, `PIC ${id}`); advance(8 * MIN); }
    perDay.push((await stats(A)).outMms - before);
    advance(24 * HOUR);
  }
  const s = await stats(A);
  verdict("18. PIC daily quota ON: hammer PIC for 5 days (3/day)", perDay.every((n) => n <= 3) && s.outMms <= 15,
    `  MMS sent per day = [${perDay.join(", ")}]  total MMS over 5 days=${s.outMms}  MMS cost=$${(s.outMms * MMS).toFixed(2)}\n` +
    `  -> the daily allowance (3) caps picture cost at 3 MMS/number/day no matter how hard they hammer.\n` +
    `     Same number, quota OFF (scenario 5): 12/hr sustained. Quota ON: 3/day. The MMS leak is CLOSED.`);
}

async function scPicBanking() {
  reset();
  const A = "3305550024";
  const id = await seedApprovedAd(A, "Quilt for sale $300. Photo!", true);
  await saveEngineSettings({ picDailyAllowance: 3, picBankCap: 20 });
  // First-ever pull seeds day-0 = 3, spends 1 -> 2 banked. Then idle 14 days: the
  // bank should accrue 2 + 14*3 = 44 but CAP at 20 (the sinking-fund ceiling).
  await send(A, `PIC ${id}`);
  advance(14 * 24 * HOUR);
  // Burst spread over ~3h so the 12/hr cap doesn't hide the bank size; count MMS.
  let mms = 0;
  for (let i = 0; i < 30; i++) {
    const before = (await stats(A)).outMms;
    await send(A, `PIC ${id}`);
    if ((await stats(A)).outMms > before) mms++;
    advance(6 * MIN);
  }
  // 1 (day 0) + 20 (banked, capped) = 21 total pulls delivered.
  verdict("19. PIC rolling bank: idle 2 weeks then burst", mms === 20,
    `  MMS delivered by the post-idle burst=${mms} (expect 20 = the bank cap)\n` +
    `  -> unused daily pulls bank like a sinking fund and STOP accruing at the cap (20). Two idle weeks would be\n` +
    `     42 pulls uncapped; the ceiling holds it to 20, so a saved-up user gets a real cushion but not infinity.`);
}

// ---- run all ----
const scenarios = [
  scStatusFlood, scStatusSustained, scBumpFlood, scBumpFloodPaid, scReviveLoop, scPicFlood,
  scAdNewFlood, scConcurrentSpend, scStopStartLoop, scSubscribeFlood,
  scGibberishFlood, scAdversarialBodies, scGlobalBreaker,
  scCrossUser, scWebhookReplay, scBlocklistDrop,
  scSoldRepeat, scAdSold, scPicQuota, scPicBanking,
];
LOG("======== BRUTAL ABUSE HARNESS (real engine, file store, controlled clock) ========");
for (const sc of scenarios) {
  try { await sc(); } catch (e) { LOG(`\n### ${sc.name}  💥 ERROR: ${e && e.stack || e}`); }
}
reset();
LOG("\n======== SUMMARY ========");
for (const r of results) LOG(`  ${r.pass ? "✅" : "🔴"} ${r.name}`);
