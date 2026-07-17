import type { Metadata } from "next";
import Link from "next/link";
import {
  adminApproveBusiness,
  adminDeclineBusiness,
  adminMarkBusinessRefunded,
} from "@/lib/admin-actions";
import {
  businessPackagesAvailable,
  listBusinessPackages,
  type BusinessPackage,
} from "@/lib/business";
import {
  behindDays,
  getBusinessTier,
  remainingDays,
  sponsorLine,
} from "@/lib/business-packages";
import { formatPrice, site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { etParts } from "@/lib/et";

export const metadata: Metadata = {
  title: `Business packages — ${site.name} admin`,
};

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function PackageFacts({ pkg }: { pkg: BusinessPackage }) {
  const tier = getBusinessTier(pkg.tier);
  return (
    <>
      <p className="myad-title">
        <strong>{pkg.businessName}</strong>{" "}
        <span className="status-muted">
          · {tier?.label ?? pkg.tier} · {formatPrice(pkg.priceCents)} · paid{" "}
          {dateLabel(pkg.paidAt)}
        </span>
      </p>
      <p className="sim-body">{pkg.adText}</p>
      <p className="fine">
        {pkg.phone && <>Phone: {formatPhone(pkg.phone)} · </>}
        {pkg.link && (
          <>
            Link:{" "}
            <a
              href={pkg.link.startsWith("http") ? pkg.link : `https://${pkg.link}`}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              {pkg.link}
            </a>{" "}
            ·{" "}
          </>
        )}
        Payment ref: <code>{pkg.stripeRef}</code>
      </p>
      <p className="fine">Digest line: {sponsorLine(pkg)}</p>
    </>
  );
}

export default async function AdminBusinessPage() {
  const available = await businessPackagesAvailable();
  const packages = await listBusinessPackages();
  const { day: today } = etParts(new Date());

  const pending = packages.filter((p) => p.status === "pending_review");
  const active = packages.filter((p) => p.status === "active");
  const refundDue = packages.filter((p) => p.status === "declined" && !p.refundedAt);
  const finished = packages.filter(
    (p) => p.status === "expired" || (p.status === "declined" && p.refundedAt),
  );

  return (
    <div>
      <h1>Business packages</h1>
      <p>
        Paid sponsor ads from <Link href="/advertising">/advertising</Link>. Each active
        package rides the <strong>first digest of every day</strong> as a labeled
        &ldquo;Sponsor:&rdquo; line on top of the member ads (never one of the 10 slots).
        The run clock starts at approval; a day with no digest doesn&rsquo;t count
        against the business — the run extends instead.
      </p>
      {!available && (
        <p className="form-error" role="alert">
          Migration 9978 (business_packages) isn&rsquo;t applied — packages can&rsquo;t
          be stored or shown. If anyone has already PAID, the webhook logged the details
          (search the logs for &ldquo;PAID PACKAGE COULD NOT BE STORED&rdquo;). Run
          supabase/migrations/9978_business_packages.sql in the SQL editor.
        </p>
      )}

      <h2 className="section-h">Waiting for review ({pending.length})</h2>
      {pending.length ? (
        <ul className="sim-pending">
          {pending.map((pkg) => (
            <li key={pkg.id} className="myad-row">
              <PackageFacts pkg={pkg} />
              <p className="fine">
                Approving starts the {pkg.daysPurchased}-day run <strong>today</strong>.
                Declining does <strong>not</strong> refund automatically — it flags the
                package below for a manual refund in Stripe.
              </p>
              <div className="sim-actions">
                <form action={adminApproveBusiness}>
                  <input type="hidden" name="id" value={pkg.id} />
                  <button className="btn btn-sm" type="submit">
                    Approve — start the run
                  </button>
                </form>
                <form action={adminDeclineBusiness}>
                  <input type="hidden" name="id" value={pkg.id} />
                  <button className="btn btn-sm btn-secondary" type="submit">
                    Decline (refund by hand)
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing waiting.</p>
      )}

      {refundDue.length > 0 && (
        <>
          <h2 className="section-h">Declined — refund due ({refundDue.length})</h2>
          <p className="form-error">
            These were paid but never ran, so per the{" "}
            <Link href="/refund-policy">refund policy</Link> the money goes back.{" "}
            <strong>Refund each one by hand in the Stripe dashboard</strong> (Payments →
            search the payment ref → Refund), then mark it done here. Nothing is refunded
            automatically.
          </p>
          <ul className="sim-pending">
            {refundDue.map((pkg) => (
              <li key={pkg.id} className="myad-row">
                <PackageFacts pkg={pkg} />
                <p>
                  <strong>
                    Refund them {formatPrice(pkg.priceCents)} in Stripe
                  </strong>{" "}
                  — declined {dateLabel(pkg.declinedAt)}.
                </p>
                <form action={adminMarkBusinessRefunded}>
                  <input type="hidden" name="id" value={pkg.id} />
                  <button className="btn btn-sm btn-secondary" type="submit">
                    I refunded it in Stripe — mark done
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section-h">Active ({active.length})</h2>
      {active.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Package</th>
                <th>Started</th>
                <th>Days ran</th>
                <th>Days left</th>
                <th>Last rode</th>
                <th>Schedule</th>
              </tr>
            </thead>
            <tbody>
              {active.map((pkg) => {
                const startsOn = pkg.startsAt ? etParts(new Date(pkg.startsAt)).day : today;
                const behind = behindDays(
                  { startsOn, daysPurchased: pkg.daysPurchased, daysRan: pkg.daysRan },
                  today,
                );
                return (
                  <tr key={pkg.id}>
                    <td>{pkg.businessName}</td>
                    <td>{getBusinessTier(pkg.tier)?.label ?? pkg.tier}</td>
                    <td>{dateLabel(pkg.startsAt)}</td>
                    <td>
                      {pkg.daysRan} of {pkg.daysPurchased}
                    </td>
                    <td>{remainingDays(pkg)}</td>
                    <td>{pkg.lastRanOn ?? "not yet"}</td>
                    <td>
                      {behind > 0 ? (
                        <strong className="ad-sold">
                          {behind} missed day{behind === 1 ? "" : "s"} — run extends
                        </strong>
                      ) : (
                        "on schedule"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No active packages.</p>
      )}

      {finished.length > 0 && (
        <>
          <h2 className="section-h">Finished ({finished.length})</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Package</th>
                  <th>Outcome</th>
                  <th>Days ran</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((pkg) => (
                  <tr key={pkg.id}>
                    <td>{pkg.businessName}</td>
                    <td>{getBusinessTier(pkg.tier)?.label ?? pkg.tier}</td>
                    <td>
                      {pkg.status === "expired"
                        ? "completed"
                        : `declined · refunded ${dateLabel(pkg.refundedAt)}`}
                    </td>
                    <td>
                      {pkg.daysRan} of {pkg.daysPurchased}
                    </td>
                    <td>
                      {formatPrice(pkg.priceCents)} · {dateLabel(pkg.paidAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
