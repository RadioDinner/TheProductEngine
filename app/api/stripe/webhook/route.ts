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
  metadata?: { phone?: string; pack?: string };
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
    if (session.payment_status === "paid") {
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
