/**
 * Payment provider seam. Without STRIPE_SECRET_KEY, checkout goes to the
 * clearly-labeled dev simulation page. With it, /account/checkout hands off
 * to a hosted Stripe Checkout session and the webhook
 * (/api/stripe/webhook) grants the credits when payment completes.
 */
import { randomUUID } from "node:crypto";
import { formatPrice, site } from "@/lib/config";
import { addLedgerEntry } from "@/lib/store";
import { devToolsEnabled } from "@/lib/env";

export const paymentsDevMode = !process.env.STRIPE_SECRET_KEY;

export function checkoutUrl(amountCents: number): string {
  return `/account/checkout?amount=${amountCents}`;
}

/**
 * Create a hosted Stripe Checkout session that adds dollars to a member's
 * ad-credit balance (dollar pricing, session 016 — packs are gone) and
 * return its redirect URL. The card is saved for future off-session charges
 * (automatic top-up at posting time); the customer id is captured by the
 * webhook when payment completes.
 */
export async function createCheckoutSession(args: {
  amountCents: number;
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
    "line_items[0][price_data][unit_amount]": String(args.amountCents),
    "line_items[0][price_data][product_data][name]": `${formatPrice(args.amountCents)} ad credit — ${site.name}`,
    "metadata[phone]": args.phone,
    "metadata[kind]": "topup",
    "metadata[topup_cents]": String(args.amountCents),
    "payment_intent_data[setup_future_usage]": "off_session",
    "payment_intent_data[metadata][phone]": args.phone,
    "payment_intent_data[metadata][topup_cents]": String(args.amountCents),
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

/** The saved card on file for a customer (last4 only), for display — e.g. the
 * admin phone-order panel deciding between "bill saved card" and "add a card".
 * Best-effort: any Stripe error reads as "no card" rather than breaking a page. */
export async function savedCardOnFile(
  customerId: string,
): Promise<{ last4?: string } | null> {
  try {
    const card = await firstSavedCard(customerId);
    return card ? { last4: card.last4 } : null;
  } catch (e) {
    console.error("[payments] saved-card lookup failed:", e);
    return null;
  }
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
 * Charge a customer's saved card off-session for a dollar amount (automatic
 * top-up, admin phone billing). `ref` is used as both the Stripe idempotency
 * key and the ledger ref, so a retry never double-charges or double-grants.
 * A declined or authentication-required card returns ok:false — we can't do
 * 3-D Secure over SMS, so callers steer the payer to the website.
 */
export async function chargeSavedCard(args: {
  customerId: string;
  amountCents: number;
  ref: string;
  phone: string;
  description: string;
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
    description: args.description,
    "metadata[phone]": args.phone,
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

export type TopUpOutcome =
  | { ok: true; chargedCents: number; last4?: string }
  | { ok: false; reason: string };

/**
 * Automatic top-up (dollar pricing, session 016): charge the member's saved
 * card for exactly the posting shortfall and grant it to the ledger, so the
 * ad charge that follows can clear. The caller has ALREADY checked the
 * member's auto-top-up consent (getAutoTopUp — fail-closed pre-9973) and
 * that a Stripe customer exists. The ref is unique per attempt: handleInbound
 * is deduped per provider message, so one inbound = at most one attempt; a
 * fetch-level retry inside Stripe is caught by the idempotency key. If the
 * subsequent spend loses a race, the money stays on the balance — never lost.
 */
export async function autoTopUpShortfall(args: {
  phone: string;
  customerId: string;
  shortfallCents: number;
}): Promise<TopUpOutcome> {
  const ref = `topup:${args.phone}:${randomUUID()}`;
  let charge: ChargeResult;
  if (!paymentsDevMode) {
    charge = await chargeSavedCard({
      customerId: args.customerId,
      amountCents: args.shortfallCents,
      ref,
      phone: args.phone,
      description: `Ad credit top-up — ${site.name}`,
    });
  } else if (devToolsEnabled) {
    charge = { ok: true, last4: "0000" }; // dev simulation (never in a real prod deploy)
  } else {
    return { ok: false, reason: "payments not configured" };
  }
  if (!charge.ok) return { ok: false, reason: charge.reason ?? "charge failed" };
  await addLedgerEntry(args.phone, {
    delta: args.shortfallCents,
    kind: "purchase",
    note: `Automatic top-up — ${formatPrice(args.shortfallCents)} charged to your saved card`,
    ref,
  });
  return { ok: true, chargedCents: args.shortfallCents, last4: charge.last4 };
}

export interface CompletedCheckout {
  paymentStatus: string;
  phone: string | null;
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
    metadata?: { phone?: string };
  };
  return {
    paymentStatus: session.payment_status ?? "unknown",
    phone: session.metadata?.phone ?? null,
    paymentIntent: session.payment_intent ?? null,
    amountTotal: session.amount_total ?? null,
  };
}
