/**
 * Stripe webhook. Point Stripe at /api/stripe/webhook with the
 * checkout.session.completed event enabled, and set STRIPE_WEBHOOK_SECRET
 * (whsec_…) — unsigned or mis-signed requests are rejected. Credit grants
 * are idempotent on the payment-intent ref, so Stripe retries and replays
 * can never double-credit.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import {
  addLedgerEntry,
  ensureAccount,
  hasLedgerRef,
  setStripeCustomerId,
} from "@/lib/store";
import { formatPrice, site } from "@/lib/config";
import { releaseHeldAds, releasedAdsMessage } from "@/lib/ad-billing";
import { normalizePhone } from "@/lib/phone";
import { sms } from "@/lib/sms";
import { createBusinessPackage } from "@/lib/business";
import { getBusinessTier } from "@/lib/business-packages";
import * as analytics from "@/analytics/src/server-events";
import { setAfterImpl } from "@/analytics/src/after";

setAfterImpl(after);

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
    /** Cents this checkout adds to the ad-credit balance (kind "topup"). */
    topup_cents?: string;
    /** "topup" (add money) or "business_package" (item 17). */
    kind?: string;
    tier?: string;
    business_name?: string;
    ad_text?: string;
    link?: string;
    /**
     * The browser's GA client id, carried through checkout (lib/account-
     * actions.ts, lib/business-actions.ts). Without it a payment confirmed by
     * webhook lands in GA as a brand-new user and every sale on the service is
     * attributed to "(direct)" forever — the acquisition report is then wrong
     * in exactly the place it matters most. Absent for phone and admin orders,
     * which is correct: those visits genuinely had no browser.
     */
    ga_client_id?: string;
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
  if (result.outcome === "created") {
    // "created" only — "duplicate" is a Stripe retry of a payment already
    // counted, and "unsupported" is money taken that we could not store.
    after(() =>
      analytics.purchaseCompleted({
        phone: normalizePhone(meta.phone ?? "") || undefined,
        clientId: meta.ga_client_id,
        transactionId: ref,
        amountCents: tier.priceCents,
        productId: `sponsorship_${tier.id}`,
        productCategory: "business_sponsorship",
        paymentChannel: "web",
      }),
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
      // Ad-credit top-up (dollar pricing, session 016): the paid dollars land
      // on the member's balance, cent for cent.
      const phone = normalizePhone(session.metadata?.phone ?? "");
      const amountCents = Math.floor(Number(session.metadata?.topup_cents ?? ""));
      const ref = session.payment_intent ?? session.id ?? "";
      if (!phone || !Number.isFinite(amountCents) || amountCents <= 0 || !ref) {
        console.error("[payments] completed session missing metadata:", session.id);
      } else if (session.amount_total != null && session.amount_total < amountCents) {
        // Defense in depth: never grant more than what was actually paid.
        console.error(
          `[payments] amount ${session.amount_total} < top-up ${amountCents}; not granting`,
        );
      } else {
        await ensureAccount(phone);
        if (!(await hasLedgerRef(ref))) {
          await addLedgerEntry(phone, {
            delta: amountCents,
            kind: "purchase",
            note: `Added ${formatPrice(amountCents)} of ad credit`,
            ref,
          });
          // Inside the ref guard, so a Stripe retry cannot report the money
          // twice. GA also de-duplicates on transaction_id, but relying on
          // that alone would mean trusting a remote system to protect our
          // revenue figure. Fire-and-forget; a no-op unless GA is configured.
          after(() =>
            analytics.purchaseCompleted({
              phone,
              clientId: session.metadata?.ga_client_id,
              transactionId: ref,
              amountCents,
              productId: "credit_topup",
              productCategory: "account_credit",
              paymentChannel: "web",
            }),
          );
        }
        if (session.customer) {
          await setStripeCustomerId(phone, session.customer);
        }
        // Money just landed, so anything this member had waiting on it moves
        // now. Outside the ref guard on purpose: a Stripe retry re-runs a
        // harmless no-op here, whereas a release skipped because the FIRST
        // delivery raced the ledger write would strand an ad until the member
        // happened to post again.
        //
        // ⚠️ Since session 023 this does NOT charge — an ad is collected for
        // when it runs — so the text says "covered", not "paid for".
        const release = await releaseHeldAds(phone);
        const note = await releasedAdsMessage(
          [...release.admitted, ...release.unheld],
          release.admitted,
        );
        if (note) {
          await sms
            .send(phone, `${site.name}: ${note}`)
            .catch((e) => console.error("[payments] waiting-ad release text failed:", e));
        }
      }
    }
  }
  // Other event types are acknowledged and ignored.
  return NextResponse.json({ ok: true });
}
