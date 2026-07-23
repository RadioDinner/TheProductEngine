# Plain Exchange — Call-to-Add-a-Card (Twilio Pay + Stripe)

Customers call a phone number from any phone — shanty landline or flip phone — key in
their card on the keypad, and the card is saved to Stripe. Your ordering workflow then
charges that saved card whenever they place an order by text. **Card digits never touch
your server, your logs, or an SMS thread**, which is what keeps you out of serious PCI
scope.

```
Caller ──► Twilio number ──► /voice (consent + <Pay> keypad capture)
                                  │  Twilio Stripe Pay Connector
                                  ▼
                     Stripe PaymentMethod (pm_...)
                                  │
                             /pay-result ──► attach to Stripe Customer (keyed by phone)
                                  │              └─► SMS "card saved" confirmation
Order arrives by text ──► your workflow ──► POST /charge ──► off-session PaymentIntent
```

---

## Part 1 — One-time console setup (about 30 minutes of clicking)

### 1. Stripe account
Create/log into [Stripe](https://dashboard.stripe.com). No special configuration needed —
the connector is authorized from Twilio's side. Grab your **secret key** (`sk_test_...`
for testing) from Developers → API keys.

### 2. Twilio account + voice number
You need a Twilio account with a **voice-capable local number**. This can be a different
number (and even a different Twilio account) from your Plain Exchange SMS line.

> **Strongly consider a separate Twilio account or subaccount for the card line.**
> The next step, PCI Mode, redacts sensitive data from ALL logs on the account it's
> enabled on, and **it cannot be undone**. Keeping payments on their own account keeps
> your classifieds' message logs untouched.

### 3. Enable PCI Mode
Twilio Console → **Voice → Settings → General** → **Enable PCI Mode** → accept the
Terms → Save. This is required before `<Pay>` will run. Again: one-way switch.

### 4. Install the Stripe Pay Connector
Twilio Console → **Voice → Manage → Pay Connectors** → choose **Stripe** → Install →
**Connect with Stripe** (OAuth redirect — log into the Stripe account from step 1).
If your Stripe account isn't activated for live payments yet, you can **Skip this
account form** and it runs in test mode.

Give the connector the unique name **`Default`** (or note whatever name you pick — it
goes in `TWILIO_PAY_CONNECTOR` and the TwiML `paymentConnector` attribute).

### 5. Point your number at this app
Phone Numbers → Manage → Active numbers → your card line → **Voice Configuration** →
"A call comes in" → **Webhook** → `https://<your-host>/voice`, HTTP POST → Save.

---

## Part 2 — Run this server

```bash
cp .env.example .env    # fill in Twilio + Stripe keys
npm install
npm start               # listens on :3000
```

For local testing, expose it with ngrok and use that URL in step 5:

```bash
ngrok http 3000
```

### Test the whole loop (test mode)
1. Call your Twilio number from your cell.
2. Follow the prompts; enter Stripe's test card `4242 4242 4242 4242`, any future
   expiration (e.g. `1230`), any CVC, any 5-digit ZIP.
3. You should hear "your card ending in 4 2 4 2 is saved" and (if `TWILIO_SMS_FROM` is
   set) get a confirmation text.
4. Check Stripe Dashboard (test mode) → Customers: a customer keyed to your phone
   number with a saved Visa.
5. Charge it:

```bash
curl -X POST https://<your-host>/charge \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+13305551234","amount_cents":6647,"description":"Test order + fee"}'
```

Going live: activate the Stripe account, reinstall/switch the connector to live,
swap `sk_test_` for `sk_live_`, set `NODE_ENV=production` (turns on Twilio webhook
signature validation).

---

## What each endpoint does

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /voice` | Twilio | Greets, reads the consent script, runs `<Pay>` with `chargeAmount="0"` + `tokenType="payment-method"` (tokenize only, returns a `pm_...`) |
| `POST /pay-result` | Twilio | Attaches the `pm_...` to a Stripe Customer keyed by caller phone, sets it default, texts confirmation |
| `POST /charge` | Your ordering workflow | Off-session `PaymentIntent` (`off_session: true, confirm: true`) against the saved card |
| `GET /health` | You | Liveness check |

To remove a card later: `stripe.paymentMethods.detach(pm_id)` — worth wiring to a
voicemail request or a `REMOVE CARD` text keyword.

---

## Costs per saved card / per charge

- Twilio Pay (Stripe connector): **$0.15 per successful transaction** (tokenizations and
  charges; volume tiers drop it later). Failed attempts aren't billed.
- Inbound voice: ~**$0.0085/min** (a card-entry call runs 2–4 min) + number ~**$1.15/mo**.
- Confirmation SMS: ~**$0.008** + carrier fee (~$0.003–0.005).
- Stripe, when you charge: **2.9% + $0.30** (card-not-present). ACH is far cheaper if you
  later add bank accounts.

Call it **≈ $0.20 to save a card** and **≈ 3% + $0.45 per order charged**.

---

## Compliance notes (short version)

- **PCI**: `<Pay>` sends keypad digits straight from the carrier to Twilio to Stripe;
  they're redacted from logs and never reach this app. That keeps you in the lightest
  self-assessment tier — complete the simple SAQ Stripe prompts you for in its
  dashboard. Never, ever accept a card number by SMS or read one over the phone to type
  in yourself.
- **Stored-card consent**: the `/voice` greeting contains the authorization sentence
  ("you authorize The Plain Exchange to keep this card on file and charge it for orders
  you place..."). Card networks require this disclosure before saving a credential for
  future charges. The app stamps `card_consent_at` on the Stripe Customer as a record.
- **TCPA**: the confirmation text is transactional (they just called you), but keep the
  "Reply STOP" line, honor opt-outs, and don't send marketing on that thread without
  separate written consent.
- **Money transmission**: charging the saved card per order means you're never holding
  customer balances — which is exactly why this design beats a "prepaid wallet" and
  keeps you clear of state money-transmitter licensing.
- **Declines**: off-session charges can fail (`card_declined`, rarely
  `authentication_required`). The `/charge` response tells you; the play is always
  "text the customer: call the card line to update your card."

---

## Production hardening checklist

- [ ] `NODE_ENV=production` so Twilio webhook signatures are enforced (behind a proxy,
      make sure the original `https` URL is what gets validated).
- [ ] Move the phone→customer mapping from Stripe search into your own database
      (Stripe search indexing can lag ~1 min).
- [ ] Log `PayErrorCode` values and alert on repeated failures.
- [ ] Add a `statusCallback` URL to `<Pay>` if you want digit-by-digit progress logging.
- [ ] Shared-phone reality: several families may call from one shanty number. If that
      happens, add a short PIN prompt (`<Gather>`) before `<Pay>` and key customers by
      phone+PIN instead of phone alone.

## No-code alternative

Twilio **Studio** has a **Capture Payments** widget (Stripe-only) that does the same
capture flow with clicks instead of code — fine for a quick demo, but it exposes only
one-time/reusable token types and you'll still need code to attach cards to your own
Stripe customers and charge them, so this app is the recommended path.
