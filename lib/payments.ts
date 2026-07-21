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
  /** Where the payer's browser lands after paying/cancelling. Defaults to the
   * member receipt flow; the admin phone-order flow returns to /admin/users
   * instead (the member success page only shows the buyer their own order). */
  successUrl?: string;
  cancelUrl?: string;
}): Promise<string> {
  const params = new URLSearchParams({
    mode: "payment",
    client_reference_id: args.phone,
    customer_creation: "always",
    success_url:
      args.successUrl ?? `${args.origin}/account/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: args.cancelUrl ?? `${args.origin}/account?checkout=cancelled#credits`,
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

/**
 * Hosted Checkout for a business advertising package (FEATURES item 17).
 * Same raw-fetch seam as credit packs, but: no card saved (one-off purchase),
 * and the ad's fields ride in the session metadata so the WEBHOOK — the only
 * writer — can store the paid package. The webhook keys idempotency on the
 * payment-intent id (business_packages.stripe_ref unique), so retries and
 * replays can never create two packages for one payment.
 */
export async function createBusinessCheckoutSession(args: {
  tierId: string;
  tierLabel: string;
  priceCents: number;
  businessName: string;
  adText: string;
  link: string | null;
  phone: string | null;
  origin: string;
}): Promise<string> {
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${args.origin}/advertising/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.origin}/advertising?checkout=cancelled`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(args.priceCents),
    "line_items[0][price_data][product_data][name]": `Business advertising — ${args.tierLabel} — ${site.name}`,
    "metadata[kind]": "business_package",
    "metadata[tier]": args.tierId,
    "metadata[business_name]": args.businessName,
    "metadata[ad_text]": args.adText,
    ...(args.link && { "metadata[link]": args.link }),
    ...(args.phone && { "metadata[phone]": args.phone }),
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

export interface ChargeResult {
  ok: boolean;
  paymentIntentId?: string;
  last4?: string;
  reason?: string;
}

/** The customer's first saved card (id + last4), or null if none is on file. */
async function firstSavedCard(
  customerId: string,
): Promise<{ id: string; last4?: string } | null> {
  const response = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=1`,
    { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
  );
  if (!response.ok) {
    throw new Error(`Stripe payment-method fetch failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as {
    data?: { id: string; card?: { last4?: string } }[];
  };
  const pm = data.data?.[0];
  return pm ? { id: pm.id, last4: pm.card?.last4 } : null;
}

/**
 * Charge a customer's saved card off-session for a credit pack (the BUYCREDIT
 * text flow). `ref` is used as both the Stripe idempotency key and the ledger
 * ref, so a retried confirmation never double-charges or double-grants. A
 * declined or authentication-required card returns ok:false — we can't do 3-D
 * Secure over SMS, so the reply steers them to the website.
 */
export async function chargeSavedCard(args: {
  customerId: string;
  amountCents: number;
  ref: string;
  phone: string;
  packId: string;
  credits: number;
}): Promise<ChargeResult> {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, reason: "payments not configured" };
  const card = await firstSavedCard(args.customerId);
  if (!card) return { ok: false, reason: "no saved card" };
  const params = new URLSearchParams({
    amount: String(args.amountCents),
    currency: "usd",
    customer: args.customerId,
    payment_method: card.id,
    off_session: "true",
    confirm: "true",
    description: `${args.credits} ad credits — ${site.name}`,
    "metadata[phone]": args.phone,
    "metadata[pack]": args.packId,
    "metadata[ref]": args.ref,
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": args.ref,
    },
    body: params,
  });
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    error?: { message?: string; code?: string };
  };
  if (!response.ok || body.error) {
    return { ok: false, reason: body.error?.message ?? `charge failed (${response.status})` };
  }
  if (body.status === "succeeded") {
    return { ok: true, paymentIntentId: body.id, last4: card.last4 };
  }
  return { ok: false, reason: `payment ${body.status ?? "not completed"}` };
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
