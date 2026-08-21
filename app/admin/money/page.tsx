import type { Metadata } from "next";
import Link from "next/link";
import { getBooksOpenedAt, getIncomeReport } from "@/lib/income";
import { formatPrice, site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Money — ${site.name} admin`,
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function Row({
  label,
  value,
  detail,
  strong,
  tip,
}: {
  label: string;
  value: number;
  detail?: string;
  strong?: boolean;
  tip?: "money.collected" | "money.earned" | "money.owed" | "money.given";
}) {
  return (
    <div className={`money-row${strong ? " money-row--strong" : ""}`}>
      <span className="money-label">
        {label}
        {tip ? <Tip k={tip} /> : null}
      </span>
      <span className="money-value">{formatPrice(value)}</span>
      {detail ? <span className="money-detail">{detail}</span> : null}
    </div>
  );
}

/** "21 August 2026" — the books-opened stamp, or null if it is unreadable. */
function booksOpenedLabel(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T"));
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function AdminMoney() {
  const report = await getIncomeReport();
  const booksOpened = booksOpenedLabel(await getBooksOpenedAt());

  const owed = report.unearnedCashCents;
  const collected = report.cashCollectedCents;
  // What is left of the cash after the part that has been earned: the honest
  // "money in the bank that is still someone else's".
  const liabilityShare = collected > 0 ? Math.round((owed / collected) * 100) : 0;

  return (
    <>
      <h1>
        Money <Tip k="money.overview" />
      </h1>
      <p className="fine">
        Cash collected is not income. Money a member puts on their account is{" "}
        <strong>owed to them</strong> until an ad actually runs — fifty people prepaying
        $50 and never posting is $2,500 in the bank and nothing earned. These four figures
        keep those apart.
      </p>

      <h2 className="section-h">What you have actually earned</h2>
      <div className="money-table">
        <Row
          label="Revenue earned"
          value={report.revenueEarnedCents}
          detail="ads that ran, less anything refunded to a balance"
          strong
          tip="money.earned"
        />
        <Row
          label="…of that, paid for with real money"
          value={report.earnedFromCashCents}
          detail="THIS is your income figure"
          strong
        />
        <Row
          label="…of that, paid for with credit you gave"
          value={report.earnedFromGrantsCents}
          detail="ads that ran but that nobody ever paid cash for"
        />
      </div>

      <h2 className="section-h">What you are holding</h2>
      <div className="money-table">
        <Row
          label="Cash collected"
          value={collected}
          detail="card payments, cheques and cash, all time"
          tip="money.collected"
        />
        <Row
          label="Still owed to members"
          value={owed}
          detail={
            collected > 0
              ? `${liabilityShare}% of everything collected — refundable, and not yours yet`
              : "unspent balance backed by real money"
          }
          strong
          tip="money.owed"
        />
        <Row
          label="Paid back out"
          value={report.paidOutCents}
          detail="refunds and payouts already sent"
        />
      </div>

      <h2 className="section-h">What you have given away</h2>
      <div className="money-table">
        <Row
          label="Credit issued"
          value={report.grantedIssuedCents}
          detail="welcome credit, invite credit, make-goods — a marketing cost, never revenue"
          tip="money.given"
        />
        <Row
          label="…still unspent"
          value={report.unearnedGrantCents}
          detail="a promise, but never a cash liability"
        />
      </div>

      {report.unclassifiedCents > 0 && (
        <p className="notice" role="status">
          <strong>{formatPrice(report.unclassifiedCents)} is unclassified.</strong> Those
          are balance adjustments written before the kinds were split (migration 9957) —
          each was either a real payment or a courtesy credit, and the ledger doesn&rsquo;t
          say which. They are counted as <em>given away</em> above, which understates cash
          collected and never overstates what can be refunded. New adjustments say which
          they are, so this figure only ever shrinks.
        </p>
      )}

      {report.coverage.truncated && (
        <p className="form-error" role="alert">
          <strong>These are floors, not totals.</strong> The report stopped after{" "}
          {report.coverage.rows.toLocaleString()} ledger rows. Every figure above is at
          least this much and probably more — say the word and this can be turned into a
          proper export.
        </p>
      )}

      {booksOpened && (
        <p className="fine status-muted">
          <strong>Books opened {booksOpened}.</strong> Everything before that was the
          service being tested on itself and was cleared out; the welcome credit was
          kept, which is why credit issued can be more than nothing while cash
          collected is nothing. Figures above cover this date onward.
        </p>
      )}

      <p className="fine status-muted">
        Read from {report.coverage.rows.toLocaleString()} ledger row
        {report.coverage.rows === 1 ? "" : "s"} across{" "}
        {report.coverage.members.toLocaleString()} member
        {report.coverage.members === 1 ? "" : "s"}, fresh on every load. Per-member detail
        is on <Link href="/admin/users">a member&rsquo;s page</Link>; the money history
        there is the same rows this adds up.
      </p>
    </>
  );
}
