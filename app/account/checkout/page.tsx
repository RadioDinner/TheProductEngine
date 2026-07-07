import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { simulatePurchase } from "@/lib/account-actions";
import { readSession } from "@/lib/session";
import { formatPrice, getPack, site } from "@/lib/config";
import { paymentsDevMode } from "@/lib/payments";

export const metadata: Metadata = {
  title: `Checkout — ${site.name}`,
  robots: { index: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");
  const pack = getPack((await searchParams).pack ?? "");
  if (!pack || !paymentsDevMode) redirect("/account");

  return (
    <div className="container auth">
      <h1>Checkout</h1>
      <dl className="account-facts">
        <div>
          <dt>Credit pack</dt>
          <dd>{pack.credits} credits</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{formatPrice(pack.priceCents)}</dd>
        </div>
      </dl>
      <p className="dev-notice">
        <strong>Development mode</strong> — no payment processor is connected yet. In
        production this step is a secure Stripe checkout page. The button below simulates a
        successful payment and adds the credits to your account.
      </p>
      <form action={simulatePurchase}>
        <input type="hidden" name="pack" value={pack.id} />
        <button className="btn btn-block" type="submit">
          Simulate successful payment
        </button>
      </form>
      <p className="auth-alt">
        <Link href="/account">Cancel and go back to your account</Link>
      </p>
    </div>
  );
}
