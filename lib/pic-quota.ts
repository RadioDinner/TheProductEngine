/**
 * PIC (picture pull) daily allowance + rolling/sinking bank.
 *
 * A number gets `picDailyAllowance` free photo pulls per ET calendar day.
 * Unused pulls accumulate ("bank") up to `picBankCap`, so a light user builds
 * a cushion and a heavy user is capped. This is the real MMS cost control —
 * pictures are the most expensive text to send. The per-number hourly PIC cap
 * (smsPicsPerHour) stays as a burst limiter on top of this.
 *
 * This module is deliberately import-free and pure so the accrual math can be
 * unit-tested in isolation (including day rollover and cap changes). The stores
 * (lib/store, lib/store-supabase) own the persistent balance and do the atomic
 * accrue-then-spend; the engine reads the ET day and formats the reply.
 *
 * Feature switch: picDailyAllowance <= 0 means the daily quota is OFF (photos
 * bounded only by the hourly cap) — consistent with the repo's "0 = disabled"
 * convention for tunables, and a safe reading of an accidental 0 (never "block
 * everyone").
 */

export interface PicQuotaState {
  /** Banked pulls available right now. */
  balance: number;
  /** ET calendar day (YYYY-MM-DD) the balance was last accrued to; null = never. */
  day: string | null;
}

/** Whole ET calendar days from dayA to dayB (both "YYYY-MM-DD"); negative if b<a, 0 on bad input. */
export function etDayDiff(dayA: string, dayB: string): number {
  const a = Date.parse(`${dayA}T00:00:00Z`);
  const b = Date.parse(`${dayB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Accrue banked allowance up to `today`. Grants `dailyAllowance` for every ET
 * day elapsed since the last accrual, capped at `bankCap`. A never-accrued
 * account (day === null) starts today with one day's allowance. Pure — the
 * caller persists the returned state and does the spend.
 *
 * Same-day (or a backwards clock) grants nothing, but still clamps a stored
 * balance down to the current cap so lowering the cap in admin takes effect on
 * the next pull instead of stranding an over-cap bank.
 */
export function accruePicQuota(
  state: PicQuotaState,
  today: string,
  dailyAllowance: number,
  bankCap: number,
): PicQuotaState {
  const cap = Math.max(0, Math.floor(bankCap));
  const daily = Math.max(0, Math.floor(dailyAllowance));
  const balance = Math.max(0, Math.floor(state.balance || 0));

  if (state.day === null) {
    return { balance: Math.min(cap, daily), day: today };
  }
  const days = etDayDiff(state.day, today);
  if (days <= 0) {
    return { balance: Math.min(cap, balance), day: state.day };
  }
  return { balance: Math.min(cap, balance + days * daily), day: today };
}

/** Stable substring of picLimitMessage — the dedup key for "you're out" replies. */
export const PIC_LIMIT_MARKER = "picture pulls for now";

/** The friendly "you've hit your daily photo limit" reply (deduped by the engine). */
export function picLimitMessage(dailyAllowance: number, bankCap: number): string {
  const daily = Math.max(0, Math.floor(dailyAllowance));
  const cap = Math.max(0, Math.floor(bankCap));
  return (
    `You've used all your picture pulls for now — ${daily} a day` +
    (cap > daily ? ` (up to ${cap} saved up)` : ``) +
    `. More become available tomorrow. Text HELP for help.`
  );
}
