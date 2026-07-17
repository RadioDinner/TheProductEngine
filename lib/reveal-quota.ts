/**
 * Metered click-to-reveal for seller phone numbers (FEATURES item 23,
 * anti-scraping). Seller numbers never render in page HTML; a signed-in member
 * spends one "number look-up" per ad, from a daily allowance + rolling bank
 * that works exactly like PIC pulls (lib/pic-quota.ts) — the accrual math IS
 * accruePicQuota, called with the reveal settings. This module holds the
 * reveal-specific decision layered on top:
 *
 *   1. an already-revealed ad is FREE to see again (the reveal log is the
 *      persistent record — check it before touching the bank);
 *   2. revealsPerDay <= 0 turns metering OFF (reveals still click-gated and
 *      logged, just never denied) — the repo's "0 = disabled" convention;
 *   3. otherwise spend one from the accrued bank, or deny with the friendly
 *      out-of-look-ups message below.
 *
 * Deliberately import-free (matching lib/pic-quota.ts) so the decision can be
 * unit-tested in isolation; the stores compose it with accruePicQuota and own
 * persistence, and migration 9979's reserve_reveal_quota() mirrors the whole
 * sequence atomically in SQL. Ad owners and the admin never reach this code —
 * they see their numbers unmetered.
 */

/** Same shape as PicQuotaState (lib/pic-quota.ts) — the bank the stores persist. */
export interface RevealQuotaState {
  /** Banked look-ups available right now. */
  balance: number;
  /** ET calendar day (YYYY-MM-DD) last accrued to; null = never. */
  day: string | null;
}

export interface RevealDecision {
  allowed: boolean;
  /** True when this reveal consumed one banked look-up. */
  spent: boolean;
  /** Look-ups left after the decision; -1 = this reveal wasn't metered. */
  remaining: number;
  /** Bank state to persist (post-accrual, post-spend); null = leave unchanged. */
  state: RevealQuotaState | null;
}

/**
 * Decide one reveal. `accrued` is the bank AFTER the caller ran
 * accruePicQuota(state, today, revealsPerDay, revealBankCap); pass null when
 * there is nothing to meter against (no account row — fail-open, defensive:
 * the action ensureAccount()s first).
 */
export function decideReveal(opts: {
  alreadyRevealed: boolean;
  revealsPerDay: number;
  accrued: RevealQuotaState | null;
}): RevealDecision {
  const { alreadyRevealed, revealsPerDay, accrued } = opts;
  // Free repeat: the member already paid a look-up for this ad — the log row,
  // not the bank, is the source of truth, so re-renders never re-charge.
  if (alreadyRevealed) return { allowed: true, spent: false, remaining: -1, state: null };
  // Metering off, or no bank to meter against: allow without spending.
  if (revealsPerDay <= 0 || accrued === null) {
    return { allowed: true, spent: false, remaining: -1, state: null };
  }
  if (accrued.balance >= 1) {
    return {
      allowed: true,
      spent: true,
      remaining: accrued.balance - 1,
      state: { balance: accrued.balance - 1, day: accrued.day },
    };
  }
  // Denied — still persist the accrued state so a lowered admin cap clamps an
  // over-cap bank on the next attempt (same rule as the PIC quota).
  return { allowed: false, spent: false, remaining: 0, state: accrued };
}

/** Stable substring of revealLimitMessage — lets tests/UI recognize the copy. */
export const REVEAL_LIMIT_MARKER = "number look-ups";

/**
 * The friendly on-page "you're out for today" message. Chat is the deliberate
 * unmetered contact path, so the copy always points there.
 */
export function revealLimitMessage(revealsPerDay: number, revealBankCap: number): string {
  const daily = Math.max(0, Math.floor(revealsPerDay));
  const cap = Math.max(0, Math.floor(revealBankCap));
  return (
    `You’ve used today’s number look-ups — they refill tomorrow` +
    (cap > daily ? ` (unused ones save up, to ${cap})` : ``) +
    `. You can still message the seller right here — chat doesn’t count against the limit.`
  );
}
