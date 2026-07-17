/**
 * Stripe webhook. Point Stripe at /api/stripe/webhook with the
 * checkout.session.completed event enabled, and set STRIPE_WEBHOOK_SECRET
 * (whsec_…) — unsigned or mis-signed requests are rejected. Credit grants
 * are idempotent on the payment-intent ref, so Stripe retries and replays
 * can never double-credit.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  addLedgerEntry,
  ensureAccount,
  hasLedgerRef,
  setStripeCustomerId,
} from "@/lib/store";
import { formatPrice, getPack } from "@/lib/config";
import { normalizePhone } from "@/lib/phone";
import { createBusinessPackage } from "@/lib/business";
import { getBusinessTier } from "@/lib/business-packages";

const TOLERANCE_S = 300;

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"),
  );
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

interface CheckoutSessionPayload {
  id?: string;
  payment_status?: string;
  payment_intent?: string | null;
  customer?: string | null;
  amount_total?: number | null;
  metadata?: {
    phone?: string;
    pack?: string;
    /** "business_package" marks a business-advertising purchase (item 17). */
    kind?: string;
    tier?: string;
    business_name?: string;
    ad_text?: string;
    link?: string;
  };
}

/**
 * A paid business advertising package (FEATURES item 17). The webhook is the
 * ONLY writer: nothing is stored until Stripe confirms payment, and the
 * insert dedups on the payment-intent ref (business_packages.stripe_ref
 * unique), so retries/replays never create two packages. The package lands as
 * pending_review — payment never skips the human review (user decision) —
 * and its run clock starts at APPROVAL, not here.
 *
 * Returns the outcome so POST can answer Stripe accordingly: "unsupported"
 * (migration 9978 not pasted — the package could not be stored) must become a
 * 5xx so Stripe RETRIES the delivery; everything else is terminal and gets a
 * 200 ("unprocessable" = bad/underpaid metadata a retry can never fix).
 */
async function handleBusinessPackage(
  session: CheckoutSessionPayload,
): Promise<"created" | "duplicate" | "unsupported" | "unprocessable"> {
  const meta = session.metadata ?? {};
  const tier = getBusinessTier(meta.tier ?? "");
  const ref = session.payment_intent ?? session.id ?? "";
  const businessName = (meta.business_name ?? "").trim();
  const adText = (meta.ad_text ?? "").trim();
  if (!tier || !ref || !businessName || !adText) {
    console.error("[business] completed session missing metadata:", session.id, meta);
    return "unprocessable";
  }
  if (session.amount_total != null && session.amount_total < tier.priceCents) {
    // Defense in depth: never accept a package for less than its price.
    console.error(
      `[business] amount ${session.amount_total} < tier ${tier.id} price ${tier.priceCents}; not storing`,
    );
    return "unprocessable";
  }
  const result = await createBusinessPackage({
    businessName,
    adText,
    link: meta.link?.trim() || null,
    phone: normalizePhone(meta.phone ?? "") ?? null,
    tier: tier.id,
    daysPurchased: tier.days,
    priceCents: tier.priceCents,
    stripeRef: ref,
  });
  if (result.outcome === "unsupported") {
    // Migration 9978 isn't applied but the business HAS PAID. Nothing can be
    // stored, so shout — and POST answers 503 so Stripe RETRIES this delivery
    // (with backoff, up to ~72h): once the table exists, a retry stores the
    // package (stripe_ref keeps that idempotent), and until then the failing
    // webhook is a durable signal in the Stripe dashboard, not just this
    // rolling log line. The operator can also re-enter the details below or
    // refund ref in Stripe.
    console.error(
      `[business] PAID PACKAGE COULD NOT BE STORED — migration 9978 not applied. ` +
        `MANUAL ACTION NEEDED. ref=${ref} tier=${tier.id} (${formatPrice(tier.priceCents)}) ` +
        `business=${JSON.stringify(businessName)} ad=${JSON.stringify(adText)} ` +
        `link=${meta.link ?? "-"} phone=${meta.phone ?? "-"}`,
    );
  }
  // "duplicate" = Stripe retry of an already-stored payment: correctly ignored.
  return result.outcome;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: CheckoutSessionPayload } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    if (session.payment_status === "paid" && session.metadata?.kind === "business_package") {
      const outcome = await handleBusinessPackage(session);
      if (outcome === "unsupported") {
        // Non-2xx = Stripe retries. Only the storage-unavailable case retries;
        // created/duplicate/unprocessable are terminal and fall through to 200.
        return NextResponse.json(
          { error: "business package not storable — migration 9978 pending" },
          { status: 503 },
        );
      }
    } else if (session.payment_status === "paid") {
      const phone = normalizePhone(session.metadata?.phone ?? "");
      const pack = getPack(session.metadata?.pack ?? "");
      const ref = session.payment_intent ?? session.id ?? "";
      if (!phone || !pack || !ref) {
        console.error("[payments] completed session missing metadata:", session.id);
      } else if (session.amount_total != null && session.amount_total < pack.priceCents) {
        // Defense in depth: never grant a pack for less than its price.
        console.error(
          `[payments] amount ${session.amount_total} < pack ${pack.id} price ${pack.priceCents}; not granting`,
        );
      } else {
        await ensureAccount(phone);
        if (!(await hasLedgerRef(ref))) {
          await addLedgerEntry(phone, {
            delta: pack.credits,
            kind: "purchase",
            note: `Purchased ${pack.credits} credits (${formatPrice(pack.priceCents)})`,
            ref,
          });
        }
        if (session.customer) {
          await setStripeCustomerId(phone, session.customer);
        }
      }
    }
  }
  // Other event types are acknowledged and ignored.
  return NextResponse.json({ ok: true });
}
