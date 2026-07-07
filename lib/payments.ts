/**
 * Payment provider seam. Until Stripe is connected, checkout goes to the
 * clearly-labeled dev simulation page; Stripe Checkout replaces `checkoutUrl`
 * (returning a hosted session URL) without touching the account pages.
 */
export const paymentsDevMode = !process.env.STRIPE_SECRET_KEY;

export function checkoutUrl(packId: string): string {
  return `/account/checkout?pack=${encodeURIComponent(packId)}`;
}
