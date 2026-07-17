import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatPrice, site } from "@/lib/config";
import { getCheckoutSession, paymentsDevMode } from "@/lib/payments";

export const metadata: Metadata = {
  title: `Order received — ${site.name}`,
  robots: { index: false },
};

/**
 * Post-payment page for a business advertising package (item 17). Reached
 * from Stripe's success redirect (?session_id=…) or the dev-simulated
 * purchase (?sim=<package id>). The package itself is stored by the webhook /
 * the simulate action; this page only confirms and sets expectations: review
 * first, run starts at approval.
 */
export default async function BusinessSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; sim?: string }>;
}) {
  const params = await searchParams;
  let paid = true;
  let amountLine: string | null = null;

  if (params.sim) {
    if (!paymentsDevMode) redirect("/advertising");
    amountLine = "Simulated payment (development mode).";
  } else if (params.session_id && !paymentsDevMode) {
    const session = await getCheckoutSession(params.session_id);
    paid = session.paymentStatus === "paid";
    if (session.amountTotal != null) {
      amountLine = `Paid ${formatPrice(session.amountTotal)}.`;
    }
  } else {
    redirect("/advertising");
  }

  return (
    <div className="container auth">
      <h1>{paid ? "Thank you — your ad is in for review" : "Payment not finished"}</h1>
      {paid ? (
        <>
          {amountLine && <p>{amountLine}</p>}
          <p>
            A person reads every ad before it runs — yours is now waiting in that same
            review line. <strong>Your run starts the day your ad is approved</strong>,
            and from then it rides the daily digest once a day for the full number of
            days you bought. If a day&rsquo;s digest doesn&rsquo;t go out, that day
            isn&rsquo;t counted against you.
          </p>
          <p>
            If we can&rsquo;t run your ad, your payment is refunded in full — see the{" "}
            <Link href="/refund-policy">refund policy</Link>. Questions? Call{" "}
            {site.supportPhone}.
          </p>
        </>
      ) : (
        <p>
          This order hasn&rsquo;t finished paying. If you were charged and see this, call{" "}
          {site.supportPhone} and we&rsquo;ll sort it out.
        </p>
      )}
      <p className="auth-alt">
        <Link href="/advertising">Back to Advertising for Businesses</Link>
      </p>
    </div>
  );
}
