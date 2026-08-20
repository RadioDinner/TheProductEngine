import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { simulatePurchase, startStripeCheckout } from "@/lib/account-actions";
import { readSession } from "@/lib/session";
import { formatPrice, isPurchasableAmount, site } from "@/lib/config";
import { paymentsDevMode } from "@/lib/payments";
import { getEngineSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: `Checkout — ${site.name}`,
  robots: { index: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount");
  const amountCents = Number((await searchParams).amount);
  // The add-money presets, plus the two listing prices — a town-hall event and
  // a featured spot are bought by putting exactly their price on the account
  // (session 019). Everything else is refused, so the amount can never be
  // whatever a URL says.
  const settings = await getEngineSettings();
  if (!isPurchasableAmount(amountCents, settings)) redirect("/account");

  return (
    <div className="container auth">
      <h1>Checkout</h1>
      <dl className="account-facts">
        <div>
          <dt>Adding to your ad credit</dt>
          <dd>{formatPrice(amountCents)}</dd>
        </div>
      </dl>
      {paymentsDevMode ? (
        <>
          <p className="dev-notice">
            <strong>Development mode</strong> — no payment processor is connected yet. In
            production this step is a secure Stripe checkout page. The button below simulates
            a successful payment and adds the money to your account.
          </p>
          <form action={simulatePurchase}>
            <input type="hidden" name="amount" value={amountCents} />
            <button className="btn btn-block" type="submit">
              Simulate successful payment
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="auth-intro">
            You&rsquo;ll finish paying on a secure checkout page run by Stripe, our payment
            processor. The money is added to your account as soon as the payment goes
            through, and your card is saved so future ads can top up automatically.
          </p>
          <form action={startStripeCheckout}>
            <input type="hidden" name="amount" value={amountCents} />
            <button className="btn btn-block" type="submit">
              Continue to secure payment
            </button>
          </form>
        </>
      )}
      <p className="auth-alt">
        <Link href="/account">Cancel and go back to your account</Link>
      </p>
    </div>
  );
}
