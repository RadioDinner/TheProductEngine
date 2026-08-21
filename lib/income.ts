/**
 * The service-wide money picture (/admin/money, session 019).
 *
 * The user's question, from session 018: "how do I measure ACTUAL income,
 * since fifty people prepaying $50 and never posting is $2,500 collected but
 * nothing earned."
 *
 * The answer is that those are two different numbers and the service had only
 * ever computed one of them. Money in is a LIABILITY until an ad runs; cash
 * collected is not revenue earned. lib/money.ts does the arithmetic — this
 * file is only the reading, and it exists separately because the read is the
 * expensive part and the arithmetic must stay pure and testable.
 *
 * The read is per-member on purpose. Grants-first spending is a per-member
 * rule, so summing the raw ledger kinds service-wide would mis-split earned
 * revenue the moment one member is still on their starter credit while another
 * is spending their own money.
 */
import { db, supabaseConfigured } from "@/lib/db";
import { getLedger, searchAccounts } from "@/lib/store";
import {
  incomeSummary,
  moneyPosition,
  type IncomeCoverage,
  type IncomeSummary,
  type MoneyEntry,
} from "@/lib/money";

/**
 * The most ledger rows one report will read.
 *
 * A ceiling rather than a paged sweep because this page is a glance, not an
 * export, and a report that takes ten seconds gets a reputation for being slow
 * rather than for being right. If it is ever hit, the page SAYS the figures are
 * a floor — a silently truncated money total is exactly the kind of confident
 * wrong number that gets acted on.
 */
const ROW_CEILING = 100_000;
const PAGE = 1000;

export interface IncomeReport extends IncomeSummary {
  coverage: IncomeCoverage;
}

/**
 * When the books were last opened — the `ledger_reset_at` stamp written by
 * migration 9954, or null if they never have been.
 *
 * The money page SHOWS this. A reset that leaves no visible mark is how a
 * figure becomes a mystery six months later: the totals start from a date
 * nobody remembers choosing, and the only way to find out is to read a
 * migration. Absent, unreadable, or dev/file mode all read as null — the page
 * then simply says nothing, which is the truth when nothing was reset.
 */
export async function getBooksOpenedAt(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await db()
      .from("config")
      .select("value")
      .eq("key", "ledger_reset_at")
      .maybeSingle();
    if (error) throw error;
    const value = (data as { value?: unknown } | null)?.value;
    return typeof value === "string" && value.trim() ? value : null;
  } catch (e) {
    // Never let a missing note take the money page down — the figures are the
    // point, the provenance line is a courtesy.
    console.error("[income] could not read ledger_reset_at:", e);
    return null;
  }
}

export async function getIncomeReport(): Promise<IncomeReport> {
  const byMember = new Map<string, MoneyEntry[]>();
  let rows = 0;
  let truncated = false;

  if (!supabaseConfigured) {
    // Dev/file mode: the store is small, so read it straight.
    for (const account of await searchAccounts("", 500)) {
      const ledger = await getLedger(account.phone);
      if (ledger.length === 0) continue;
      byMember.set(account.phone, ledger);
      rows += ledger.length;
    }
  } else {
    for (let offset = 0; ; offset += PAGE) {
      if (offset >= ROW_CEILING) {
        truncated = true;
        break;
      }
      const { data, error } = await db()
        .from("credit_ledger")
        .select("user_id, delta, kind")
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const batch = data ?? [];
      for (const row of batch) {
        const key = String((row as { user_id: string }).user_id);
        const entry: MoneyEntry = {
          delta: (row as { delta: number }).delta,
          kind: (row as { kind: string }).kind,
        };
        const list = byMember.get(key);
        if (list) list.push(entry);
        else byMember.set(key, [entry]);
      }
      rows += batch.length;
      if (batch.length < PAGE) break;
    }
  }

  const positions = [...byMember.values()].map((entries) => moneyPosition(entries));
  return {
    ...incomeSummary(positions),
    coverage: { rows, members: byMember.size, truncated },
  };
}
