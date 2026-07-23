/**
 * Plain Exchange — "Call to add a card" service
 *
 * Flow:
 *   1. Customer calls your Twilio number from any phone (shanty landline, flip phone).
 *   2. /voice answers, reads a consent script, then runs TwiML <Pay> in tokenize mode
 *      (chargeAmount 0). The caller keys in card number, expiration, CVC, and ZIP
 *      on the keypad. Twilio captures the digits — your server NEVER sees the card number.
 *   3. Twilio's Stripe Pay Connector turns the card into a Stripe PaymentMethod (pm_...)
 *      and POSTs the result to /pay-result.
 *   4. /pay-result finds-or-creates a Stripe Customer keyed to the caller's phone number,
 *      attaches the PaymentMethod, makes it the default, and (optionally) texts a confirmation.
 *   5. Later, when they text you an order, your ordering workflow calls POST /charge
 *      with { phone, amount_cents, description } and Stripe charges the saved card
 *      off-session. No internet needed on the customer's end, ever.
 *
 * Prereqs (see README.md): PCI Mode enabled on the Twilio account, Stripe Pay Connector
 * installed via the Twilio Console, and this server reachable over HTTPS.
 */

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Twilio posts webhooks as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// JSON only needed for the internal /charge endpoint
app.use(express.json());

const BUSINESS = process.env.BUSINESS_NAME || 'The Plain Exchange';
const CONNECTOR = process.env.TWILIO_PAY_CONNECTOR || 'Default';

// Validates X-Twilio-Signature so only Twilio can hit your webhooks.
// Enforced when NODE_ENV=production; relaxed in dev so ngrok testing is painless.
const twilioWebhook = twilio.webhook({ validate: process.env.NODE_ENV === 'production' });

// Optional SMS confirmations
const smsClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

/* ------------------------------------------------------------------ */
/* Step 1: the call comes in                                           */
/* ------------------------------------------------------------------ */
app.post('/voice', twilioWebhook, (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Stored-credential consent script. Card networks and Stripe require clear
  // cardholder consent before saving a card for future off-session charges —
  // this sentence IS that consent. Keep a call log as your record.
  twiml.say(
    `Welcome to ${BUSINESS}. ` +
      'To save a card for your account, you will enter your card number, expiration date, ' +
      'security code, and billing zip code using your phone keypad. ' +
      `By continuing, you authorize ${BUSINESS} to keep this card on file and to charge it ` +
      'for orders you place with us, including our service fee, until you cancel. ' +
      'To cancel a saved card at any time, call this number and leave a message. ' +
      'Let’s begin.'
  );

  // chargeAmount "0" = tokenize only (save the card, charge nothing today).
  // tokenType "payment-method" makes the Stripe connector return a pm_... id,
  // which we can attach to our own Stripe Customer.
  twiml.pay({
    paymentConnector: CONNECTOR,
    chargeAmount: '0',
    tokenType: 'payment-method',
    securityCode: true,
    postalCode: true,
    maxAttempts: 3,
    timeout: 10,
    action: '/pay-result',
  });

  res.type('text/xml').send(twiml.toString());
});

/* ------------------------------------------------------------------ */
/* Step 2: Twilio posts the tokenization result here                   */
/* ------------------------------------------------------------------ */
app.post('/pay-result', twilioWebhook, async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const {
    Result, // "success" | error states
    PaymentToken, // pm_... (because tokenType="payment-method")
    ProfileId, // Stripe customer id, if the connector created one (reusable mode)
    PaymentCardNumber, // masked, e.g. xxxx-xxxx-xxxx-4242
    PaymentCardType,
    PaymentError,
    PayErrorCode,
    From,
    Caller,
  } = req.body;

  const phone = From || Caller; // E.164 caller ID, e.g. +13305557890

  if (Result !== 'success' || !PaymentToken) {
    console.error('Pay failed:', { Result, PaymentError, PayErrorCode, phone });
    twiml.say(
      'Sorry, we could not save your card. Please check the card and try calling again. Goodbye.'
    );
    return res.type('text/xml').send(twiml.toString());
  }

  try {
    const customer = await findOrCreateCustomerByPhone(phone);

    // Attach the phone-captured card to OUR customer record and make it the default.
    // (If you ever switch to tokenType="reusable", skip attach and instead charge
    //  with customer: ProfileId — the connector will have made its own Customer.)
    await stripe.paymentMethods.attach(PaymentToken, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: PaymentToken },
      metadata: { card_consent_at: new Date().toISOString() },
    });

    const last4 = (PaymentCardNumber || '').replace(/\D/g, '').slice(-4);

    if (smsClient && process.env.TWILIO_SMS_FROM) {
      await smsClient.messages
        .create({
          from: process.env.TWILIO_SMS_FROM,
          to: phone,
          body:
            `${BUSINESS}: your ${PaymentCardType || 'card'} ending ${last4} is saved. ` +
            'Text us what you need and we’ll order it. Reply STOP to opt out of texts.',
        })
        .catch((e) => console.error('Confirmation SMS failed:', e.message));
    }

    twiml.say(
      `Thank you. Your card ending in ${last4.split('').join(' ')} is saved. ` +
        'You can now place orders by text message. Goodbye.'
    );
  } catch (err) {
    console.error('Stripe attach failed:', err);
    twiml.say(
      'Sorry, something went wrong saving your card on our end. Please try again later. Goodbye.'
    );
  }

  res.type('text/xml').send(twiml.toString());
});

/* ------------------------------------------------------------------ */
/* Step 3: charge the saved card when an order comes in                */
/*                                                                     */
/* Called by YOUR ordering workflow (not by Twilio):                    */
/*   POST /charge                                                      */
/*   Authorization: Bearer <INTERNAL_API_KEY>                          */
/*   { "phone": "+13305557890", "amount_cents": 6647,                  */
/*     "description": "Amazon order #123 + $6 service fee" }           */
/* ------------------------------------------------------------------ */
app.post('/charge', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { phone, amount_cents, description } = req.body || {};
  if (!phone || !Number.isInteger(amount_cents) || amount_cents < 50) {
    return res.status(400).json({ error: 'phone and integer amount_cents (>=50) required' });
  }

  try {
    const customer = await findCustomerByPhone(phone);
    if (!customer) return res.status(404).json({ error: 'no customer for that phone' });

    const paymentMethod = customer.invoice_settings?.default_payment_method;
    if (!paymentMethod) return res.status(404).json({ error: 'customer has no saved card' });

    const intent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      customer: customer.id,
      payment_method: paymentMethod,
      off_session: true, // customer is not present — charging a stored credential
      confirm: true,
      description: description || `${BUSINESS} order`,
      metadata: { phone },
    });

    return res.json({ ok: true, payment_intent: intent.id, status: intent.status });
  } catch (err) {
    // Declines & re-authentication surface here. For this customer base the fix is
    // always the same: text them to call the card line again.
    const code = err.code || err.raw?.code;
    console.error('Charge failed:', code, err.message);
    return res.status(402).json({
      ok: false,
      error: code || 'charge_failed',
      hint:
        code === 'authentication_required' || code === 'card_declined'
          ? 'Text the customer to call the card line and re-enter or update their card.'
          : undefined,
    });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
// Pilot-scale approach: key Stripe Customers by phone in metadata and use
// Stripe's search API. Search indexing can lag ~1 minute; at real volume,
// keep a phone -> customer_id table in your own database instead.
async function findCustomerByPhone(phone) {
  const found = await stripe.customers.search({
    query: `metadata['phone']:'${phone}'`,
    limit: 1,
  });
  return found.data[0] || null;
}

async function findOrCreateCustomerByPhone(phone) {
  const existing = await findCustomerByPhone(phone);
  if (existing) return existing;
  return stripe.customers.create({
    phone,
    description: `${BUSINESS} customer ${phone}`,
    metadata: { phone, source: 'pay-by-phone' },
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Pay-by-phone listening on :${port}`));
