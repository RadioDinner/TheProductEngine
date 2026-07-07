import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { hasLedgerRef } from "@/lib/store";
import { formatPrice, getPack, site } from "@/lib/config";
import { getCheckoutSession, paymentsDevMode } from "@/lib/payments";

export const metadata: Metadata = {
  title: `Order complete — ${site.name}`,
  robots: { index: false },
};

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");
  const sessionId = (await searchParams).session_id;
  if (!sessionId || paymentsDevMode) redirect("/account");

  let order;
  try {
    order = await getCheckoutSession(sessionId);
  } catch (e) {
    // Can't show the receipt right now — the account page notice still can.
    console.error("[payments] order lookup failed:", e);
    redirect("/account?checkout=success#credits");
  }
  // Only the buyer sees their own receipt.
  if (order.phone !== session.phone) redirect("/account");

  const pack = getPack(order.packId ?? "");
  const paid = order.paymentStatus === "paid";
  const credited =
    paid && order.paymentIntent ? await hasLedgerRef(order.paymentIntent) : false;

  return (
    <div className="container auth">
      <h1>Order complete</h1>
      <dl className="account-facts">
        {pack && (
          <div>
            <dt>Credit pack</dt>
            <dd>{pack.credits} credits</dd>
          </div>
        )}
        {order.amountTotal !== null && (
          <div>
            <dt>Paid</dt>
            <dd>{formatPrice(order.amountTotal)}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>{paid ? "Payment received" : "Payment processing"}</dd>
        </div>
      </dl>
      <p className="notice" role="status">
        {credited
          ? "Thank you! The credits are in your account and ready to use."
          : paid
            ? "Thank you! Your payment went through — the credits will appear in your account within a minute."
            : "Your payment is still processing. The credits are added the moment it completes."}
      </p>
      <p>
        Ready to post? Text <span className="cmd">AD NEW</span> and your ad to{" "}
        <strong>{site.smsNumber}</strong>.
      </p>
      <p className="auth-alt">
        <Link href="/account#credits">Back to your account</Link>
      </p>
    </div>
  );
}
