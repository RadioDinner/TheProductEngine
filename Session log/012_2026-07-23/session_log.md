# Session 012 — 2026-07-23

## What shipped

- **`aa30871` — Add pay-by-phone card capture service (FEATURES 31).**
  The user uploaded `plainexchangepaybyphone.zip`; added **unmodified** under
  `pay-by-phone/` at the repo root. A standalone Node/Express service:
  - `POST /voice` — reads a stored-credential consent script, then runs TwiML
    `<Pay>` in tokenize-only mode (`chargeAmount "0"`,
    `tokenType "payment-method"`). The caller keys card/expiry/CVC/ZIP on the
    phone keypad; digits flow carrier → Twilio → Stripe and never reach the
    operator, this server, or a log.
  - `POST /pay-result` — attaches the returned `pm_…` to a Stripe customer
    keyed by caller phone, sets it default, stamps `card_consent_at`, texts a
    confirmation.
  - `POST /charge` — bearer-authed (`INTERNAL_API_KEY`); off-session
    PaymentIntent against the saved card, called by the order workflow.
  - Also added: `.vercelignore` excluding `pay-by-phone/` from the Next
    build/deploy; `Session log/012_2026-07-23/prompt_history.txt`; FEATURES.md
    item 31 (row + full item note); HANDOFF.md session-012 section.

## Directional decisions

- **Add it as a standalone service, not a native port.** The service is
  Twilio + Stripe-SDK + Express; the main app is Telnyx + raw-fetch-Stripe +
  Next.js. Twilio **PCI Mode is irreversible and redacts logs account-wide**,
  so the README (correctly) wants this on its own Twilio account — and there's
  no shared number to fold into since the app uses Telnyx. So it stays a
  separate deployable. Build guards ensure it can't affect the production Next
  app (`.vercelignore`; not an npm workspace; `.js` not typechecked).

- **Do NOT wire it into member accounts this session.** Offered to build the
  bridge that makes IVR-saved cards chargeable from `/admin/users` (item 29
  "Bill their saved card") and by BUYCREDIT; the user declined to spec the
  integration this turn (interrupted the clarifying question and asked to
  continue). So the integration stays a **documented seam**, not built —
  captured in FEATURES item 31 + HANDOFF. The main app was not touched.

- **Product mapping:** this is the PCI-safe upgrade to **FEATURES item 29**.
  Item 29 today has the operator key the card while the caller reads it aloud
  — the exact anti-pattern the README warns against. This removes the operator
  from the card path entirely.

## The integration gap (for whoever wires it in next)

As written the service is an island:
- It finds Stripe customers by `customers.search` on `metadata['phone']`.
- The app charges saved cards via the member account's stored
  `stripeCustomerId` (`lib/payments.ts` `firstSavedCard` / `chargeSavedCard`).

So an IVR-saved card is not chargeable by the app until BOTH:
1. the service and the app use the **same Stripe account/key**, and
2. a bridge stamps the IVR-created customer onto the member's
   `stripeCustomerId`.

Minimal bridge — pick one:
- **(a)** `/pay-result`, after attach, POSTs `{phone, customerId}` to a new
  authenticated main-app endpoint that sets `account.stripeCustomerId`; or
- **(b)** add a phone-search fallback to the app's `firstSavedCard` (search
  Stripe by `metadata['phone']`) when the account has no stored customer id.

Either makes the whole item-29 + BUYCREDIT surface work for call-in cards
automatically. Confirm phone formats line up (app `normalizePhone` vs Twilio
`From`/`Caller`, both E.164).

## Review notes (added as-is; flagged for pre-reliance)

- **Consent/PCI is sound** — the spoken script covers saving the card AND
  future off-session charges + cancellation (a proper stored-credential
  mandate).
- **Pre-reliance punch list** is the README's own hardening checklist:
  enforce prod webhook signatures (`NODE_ENV=production`), keep your own
  phone→customer table (Stripe search lags ~1 min), log `PayErrorCode`,
  optional PIN before `<Pay>` for shared shanty numbers.
- `/charge` has no rate limit and a non-constant-time token compare — low risk
  behind a private caller, worth tightening if the endpoint is ever exposed.

## Open questions / next step

- **Decide the Stripe-account topology** (share the app's Stripe account so
  cards are chargeable by the app, vs a separate account) and whether to build
  the reconciliation bridge (a) or (b) above. That's the greenlight needed to
  turn this from an island into the live item-29 replacement.
- **Ops to go live** (from `pay-by-phone/README.md`): Stripe account → Twilio
  voice number → enable PCI Mode → install the Stripe Pay Connector (name
  `Default`) → point the number's voice webhook at `https://<host>/voice` →
  fill `.env` → deploy → test with card `4242…`.

## Notes for future sessions

- Git: developed on the designated task branch
  `claude/new-feature-upload-zh3y9p` (NOT `main` this session, unlike the
  session 007–011 direct-to-main posture). Committed + pushed there.
- Costs (README): ≈ $0.20 to save a card, ≈ 3% + $0.45 per order charged.
