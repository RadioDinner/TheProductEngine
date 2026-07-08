// Digest slot scheduling across DST. Uses the REAL etParts (lib/et.ts); the
// slot-decision below mirrors runDueDigests (which is stateful, so can't be
// imported): fire each slot whose ET hour has arrived, once per (day, slot).
import { etParts } from "../lib/et.ts";

export const name = "dst";

function simulate(startUTC, days, slots) {
  const firstHour = new Map(); // `${day}#${slot}` -> ET hour it first fired
  const ticks = (days * 24 * 60) / 5;
  for (let i = 0; i < ticks; i++) {
    const now = new Date(startUTC + i * 5 * 60 * 1000);
    const { day, hour } = etParts(now);
    for (const slot of slots) {
      if (hour < slot) continue;
      const key = `${day}#${slot}`;
      if (!firstHour.has(key)) firstHour.set(key, hour); // createDigestIfAbsent dedup
    }
  }
  return firstHour;
}

export function run(t) {
  // Spring forward 2026-03-08 (2:00 EST -> 3:00 EDT). Start 2026-03-06 00:00 ET.
  const sf = simulate(Date.UTC(2026, 2, 6, 5, 0, 0), 5, [2, 7, 18]);
  const days = [...new Set([...sf.keys()].map((k) => k.split("#")[0]))].sort();
  t.eq("spring: 5 days each reach slot 7", days.filter((d) => sf.has(`${d}#7`)).length, 5);
  t.eq("spring: slot 7 first fires at ET hour 7", days.every((d) => sf.get(`${d}#7`) === 7), true);
  t.eq("spring: slot 18 first fires at ET hour 18", days.every((d) => sf.get(`${d}#18`) === 18), true);
  t.eq("spring-forward day: 2am slot still fires (at 3am)", sf.get("2026-03-08#2"), 3);
  t.eq("normal day: 2am slot fires at 2am", sf.get("2026-03-07#2"), 2);

  // Fall back 2026-11-01 (2:00 EDT -> 1:00 EST; 1am twice). Start 2026-10-30 00:00 ET.
  const fb = simulate(Date.UTC(2026, 9, 30, 4, 0, 0), 5, [1, 7, 18]);
  const fdays = [...new Set([...fb.keys()].map((k) => k.split("#")[0]))].sort();
  t.eq("fall: 5 days each reach slot 18", fdays.filter((d) => fb.has(`${d}#18`)).length, 5);
  t.eq("fall-back day: 1am slot is a single (day,slot)", fb.has("2026-11-01#1"), true);
  t.eq("fall-back day: slot 7 fires at hour 7", fb.get("2026-11-01#7"), 7);
  t.eq("no day skipped across fall-back", fdays.length, 5);
}
