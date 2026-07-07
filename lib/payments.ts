/**
 * Payment provider seam. Without STRIPE_SECRET_KEY, checkout goes to the
 * clearly-labeled dev simulation page. With it, /account/checkout hands off
 * to a hosted Stripe Checkout session and the webhook
 * (/api/stripe/webhook) grants the credits when payment completes.
 */
import { site } from "@/lib/config";

export const paymentsDevMode = !process.env.STRIPE_SECRET_KEY;

export function checkoutUrl(packId: string): string {
  return `/account/checkout?pack=${encodeURIComponent(packId)}`;
}

/**
 * Create a hosted Stripe Checkout session for a credit pack and return its
 * redirect URL. The card is saved for future off-session charges (the
 * planned /BUYCREDIT text-to-buy flow); the customer id is captured by the
 * webhook when payment completes.
 */
export async function createCheckoutSession(args: {
  packId: string;
  credits: number;
  priceCents: number;
  phone: string;
  origin: string;
}): Promise<string> {
  const params = new URLSearchParams({
    mode: "payment",
    client_reference_id: args.phone,
    customer_creation: "always",
    success_url: `${args.origin}/account/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.origin}/account?checkout=cancelled#credits`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(args.priceCents),
    "line_items[0][price_data][product_data][name]": `${args.credits} ad credits — ${site.name}`,
    "metadata[phone]": args.phone,
    "metadata[pack]": args.packId,
    "payment_intent_data[setup_future_usage]": "off_session",
    "payment_intent_data[metadata][phone]": args.phone,
    "payment_intent_data[metadata][pack]": args.packId,
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!response.ok) {
    throw new Error(`Stripe session create failed (${response.status}): ${await response.text()}`);
  }
  const session = (await response.json()) as { url?: string };
  if (!session.url) throw new Error("Stripe session response had no redirect URL");
  return session.url;
}

export interface CompletedCheckout {
  paymentStatus: string;
  phone: string | null;
  packId: string | null;
  paymentIntent: string | null;
  amountTotal: number | null;
}

/** Look up a Checkout Session to render the order-complete page. */
export async function getCheckoutSession(sessionId: string): Promise<CompletedCheckout> {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
  );
  if (!response.ok) {
    throw new Error(`Stripe session fetch failed (${response.status}): ${await response.text()}`);
  }
  const session = (await response.json()) as {
    payment_status?: string;
    payment_intent?: string | null;
    amount_total?: number | null;
    metadata?: { phone?: string; pack?: string };
  };
  return {
    paymentStatus: session.payment_status ?? "unknown",
    phone: session.metadata?.phone ?? null,
    packId: session.metadata?.pack ?? null,
    paymentIntent: session.payment_intent ?? null,
    amountTotal: session.amount_total ?? null,
  };
}
