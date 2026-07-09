// PIC daily-allowance + rolling-bank accrual math (lib/pic-quota.ts).
import { accruePicQuota, etDayDiff, picLimitMessage, PIC_LIMIT_MARKER } from "../lib/pic-quota.ts";

export const name = "pic-quota";

// Spend one pull from an accrued state — mirrors what the stores do after
// accruePicQuota, so tests can assert the full accrue-then-spend outcome.
function reserve(state, today, daily, cap) {
  const acc = accruePicQuota(state, today, daily, cap);
  if (acc.balance >= 1) return { allowed: true, remaining: acc.balance - 1, day: acc.day };
  return { allowed: false, remaining: 0, day: acc.day };
}

export function run(t) {
  const DAILY = 3, CAP = 20;

  // ---- etDayDiff ----
  t.eq("same day diff = 0", etDayDiff("2026-07-09", "2026-07-09"), 0);
  t.eq("one day diff = 1", etDayDiff("2026-07-09", "2026-07-10"), 1);
  t.eq("month rollover diff", etDayDiff("2026-07-31", "2026-08-02"), 2);
  t.eq("backwards diff negative", etDayDiff("2026-07-10", "2026-07-09"), -1);
  t.eq("across DST fall-back still whole days", etDayDiff("2026-11-01", "2026-11-02"), 1);
  t.eq("bad input diff = 0", etDayDiff("nonsense", "2026-07-09"), 0);

  // ---- first-ever accrual seeds one day's allowance ----
  t.eq("new account seeds daily allowance",
    accruePicQuota({ balance: 0, day: null }, "2026-07-09", DAILY, CAP),
    { balance: 3, day: "2026-07-09" });
  t.eq("new account seed is capped by bank cap",
    accruePicQuota({ balance: 0, day: null }, "2026-07-09", 30, 20),
    { balance: 20, day: "2026-07-09" });

  // ---- same-day: no new grant ----
  t.eq("same day no accrual",
    accruePicQuota({ balance: 1, day: "2026-07-09" }, "2026-07-09", DAILY, CAP),
    { balance: 1, day: "2026-07-09" });

  // ---- banking: unused pulls stack across days ----
  t.eq("one idle day grants +daily",
    accruePicQuota({ balance: 2, day: "2026-07-09" }, "2026-07-10", DAILY, CAP),
    { balance: 5, day: "2026-07-10" });
  t.eq("many idle days accrue then cap at bank",
    accruePicQuota({ balance: 2, day: "2026-07-09" }, "2026-07-19", DAILY, CAP),
    { balance: 20, day: "2026-07-19" }); // 2 + 10*3 = 32 -> capped 20
  t.eq("exactly filling the bank",
    accruePicQuota({ balance: 0, day: "2026-07-09" }, "2026-07-15", DAILY, 18),
    { balance: 18, day: "2026-07-15" }); // 6 days * 3 = 18

  // ---- lowering the cap clamps a stored over-cap balance on next touch ----
  t.eq("lowered cap clamps banked balance same day",
    accruePicQuota({ balance: 20, day: "2026-07-09" }, "2026-07-09", DAILY, 5),
    { balance: 5, day: "2026-07-09" });

  // ---- quota OFF (daily <= 0): the store short-circuits; accrue still safe ----
  t.eq("daily 0 accrues nothing meaningful (feature off is handled in store)",
    accruePicQuota({ balance: 0, day: null }, "2026-07-09", 0, CAP),
    { balance: 0, day: "2026-07-09" });

  // ---- full accrue-then-spend lifecycle over days ----
  let s = { balance: 0, day: null };
  const day1 = [];
  for (let i = 0; i < 5; i++) { const r = reserve(s, "2026-07-09", DAILY, CAP); s = { balance: r.remaining, day: r.day }; day1.push(r.allowed); }
  t.eq("day 1: first 3 allowed then denied", day1, [true, true, true, false, false]);

  // next day: +3 available again even though we drained to 0
  const r2 = reserve(s, "2026-07-10", DAILY, CAP);
  t.eq("day 2: allowance tops back up", r2.allowed, true);
  t.eq("day 2: remaining after one pull", r2.remaining, 2);

  // idle a week from a 2-bank, then a burst can pull the capped bank
  let banked = { balance: 2, day: "2026-07-10" };
  const acc = accruePicQuota(banked, "2026-07-24", DAILY, CAP); // 14 days -> capped
  t.eq("two weeks idle banks up to the cap", acc.balance, 20);

  // ---- message + marker ----
  t.eq("limit message contains the dedup marker",
    picLimitMessage(DAILY, CAP).includes(PIC_LIMIT_MARKER), true);
  t.eq("limit message names the daily number", picLimitMessage(3, 20).includes("3 a day"), true);
}
