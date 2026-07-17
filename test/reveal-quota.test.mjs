// Metered click-to-reveal decision logic (lib/reveal-quota.ts, FEATURES item
// 23) — composed with the shared accrual math (lib/pic-quota.ts) exactly the
// way the stores do.
import { accruePicQuota } from "../lib/pic-quota.ts";
import {
  decideReveal,
  revealLimitMessage,
  REVEAL_LIMIT_MARKER,
} from "../lib/reveal-quota.ts";

export const name = "reveal-quota";

// Mirrors reserveRevealQuota in lib/store.ts: repeat/metering-off checks, then
// accrue-then-spend. `state` stands in for the persisted per-account bank.
function reserve(state, today, daily, cap, alreadyRevealed = false) {
  const accrued =
    alreadyRevealed || daily <= 0 ? null : accruePicQuota(state, today, daily, cap);
  const d = decideReveal({ alreadyRevealed, revealsPerDay: daily, accrued });
  return { allowed: d.allowed, spent: d.spent, remaining: d.remaining, state: d.state ?? state };
}

export function run(t) {
  const DAILY = 10, CAP = 30;

  // ---- free repeat: an already-revealed ad never burns quota ----
  const start = { balance: 4, day: "2026-07-16" };
  t.eq("repeat reveal is free",
    reserve(start, "2026-07-17", DAILY, CAP, true),
    { allowed: true, spent: false, remaining: -1, state: start });
  t.eq("repeat reveal free even with an empty bank",
    reserve({ balance: 0, day: "2026-07-17" }, "2026-07-17", DAILY, CAP, true).allowed,
    true);

  // ---- metering off (revealsPerDay <= 0): allowed, nothing metered ----
  t.eq("metering off always allows",
    reserve({ balance: 0, day: "2026-07-17" }, "2026-07-17", 0, CAP),
    { allowed: true, spent: false, remaining: -1, state: { balance: 0, day: "2026-07-17" } });

  // ---- fail-open when there is no bank to meter against (no account row) ----
  t.eq("null accrued state fails open",
    decideReveal({ alreadyRevealed: false, revealsPerDay: DAILY, accrued: null }),
    { allowed: true, spent: false, remaining: -1, state: null });

  // ---- spend path: first-ever reveal seeds one day's allowance ----
  t.eq("new account first reveal spends from the seeded allowance",
    reserve({ balance: 0, day: null }, "2026-07-17", DAILY, CAP),
    { allowed: true, spent: true, remaining: 9, state: { balance: 9, day: "2026-07-17" } });

  // ---- full day lifecycle: 10 allowed, the 11th refused ----
  let s = { balance: 0, day: null };
  const day1 = [];
  for (let i = 0; i < 12; i++) {
    const r = reserve(s, "2026-07-17", DAILY, CAP);
    s = r.state;
    day1.push(r.allowed);
  }
  t.eq("day 1: first 10 allowed then denied",
    day1, [true, true, true, true, true, true, true, true, true, true, false, false]);
  t.eq("denied leaves the bank at 0", s, { balance: 0, day: "2026-07-17" });

  // ---- next day the allowance tops back up ----
  const r2 = reserve(s, "2026-07-18", DAILY, CAP);
  t.eq("day 2: allowance refills", r2.allowed, true);
  t.eq("day 2: remaining after one reveal", r2.remaining, 9);

  // ---- banking: idle days stack up to the cap ----
  t.eq("a week idle banks to the cap",
    reserve({ balance: 5, day: "2026-07-10" }, "2026-07-17", DAILY, CAP).state,
    { balance: 29, day: "2026-07-17" }); // 5 + 7*10 = 75 -> capped 30, minus the spend

  // ---- lowered cap clamps an over-cap bank even on a denial-free path ----
  t.eq("lowered cap clamps the stored bank",
    reserve({ balance: 30, day: "2026-07-17" }, "2026-07-17", DAILY, 5).state,
    { balance: 4, day: "2026-07-17" });

  // ---- the friendly out-of-look-ups message ----
  const msg = revealLimitMessage(DAILY, CAP);
  t.eq("limit message contains the marker", msg.includes(REVEAL_LIMIT_MARKER), true);
  t.eq("limit message says they refill tomorrow", msg.includes("refill tomorrow"), true);
  t.eq("limit message points at chat (the unmetered path)",
    msg.includes("message the seller"), true);
  t.eq("limit message names the bank cap when it exceeds daily",
    msg.includes("30"), true);
  t.eq("no bank mention when cap <= daily",
    revealLimitMessage(10, 10).includes("save up"), false);
}
