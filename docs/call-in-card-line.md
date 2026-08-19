# The call-in card line — setup

FEATURES item 31. A member calls one phone number. **You and anyone else on
the ring list are called first** — pick up and it's an ordinary conversation.
If nobody answers within ~18 seconds, an auto-attendant takes over: press 1 to
put a card on file (keyed on the phone's own keypad), press 2 to leave a
message. A saved card immediately works everywhere the app charges — automatic
top-up when an ad costs more than the member's ad credit, and "Bill their
saved card" on /admin/users.

Served by the main app at **`/api/voice`** (`app/api/voice/route.ts`,
`lib/voice.ts`). No second deployment. The standalone `pay-by-phone/` service
is a reference implementation only.

**PCI, non-negotiable:** the digits go carrier → Twilio → Stripe. They never
reach this app, its logs, or an SMS thread — which is what keeps you in the
lightest self-assessment tier. Never add a `<Gather>` that collects card
digits, never read a card number over the phone yourself, and never accept one
by text.

## What you do once, in the consoles

1. **Twilio → Voice → Settings → General → Enable PCI Mode.** Required before
   `<Pay>` will run. **This is irreversible and redacts sensitive data from
   logs account-wide**, which is why the card line should live on its own
   Twilio account or subaccount — your Telnyx messaging setup is untouched
   either way.
2. **Twilio → Voice → Manage → Pay Connectors → Stripe → Install**, and
   connect it to **the same Stripe account the website uses**. Name the
   connector `Default` (or set `TWILIO_PAY_CONNECTOR` to the name you chose).
3. **Twilio → Phone Numbers → Active numbers → your number → Voice
   Configuration.** "A call comes in" → **Webhook** →
   `https://www.theplainexchange.com/api/voice` → **HTTP POST** → Save. That
   one URL runs the whole call; every later stage is an address the app hands
   back. (Until you do this, callers hear Twilio's "configure your number's
   voice URL" demo greeting.)
4. **Vercel → Environment Variables**, then redeploy:
   - `TWILIO_AUTH_TOKEN` — Twilio Console → Account Info → Auth Token.
     **Required in production**: without it every voice webhook is rejected,
     because a forged one could attach a card to any phone number.
   - `VOICE_RING_TO` — comma-separated 10-digit numbers to ring before the
     attendant answers (e.g. `3306001834,3305551212`). Leave empty and the
     attendant answers immediately.
   - `VOICE_RING_SECONDS` — optional, default 18. **Keep it below your cells'
     own voicemail delay** (usually 25–30 s), or a personal voicemail box
     answers the call and the attendant never gets its turn.
   - `TWILIO_PAY_CONNECTOR` — only if you named the connector something other
     than `Default`.
5. Check `/api/health` (with the `CRON_SECRET` bearer token): `TWILIO_AUTH_TOKEN`
   should read `true` and `VOICE_RING_TO` should be the count of numbers.

### Keeping your one public number

Members never need to learn the Twilio number. In the **Telnyx portal → My
Numbers → your digest number → Call Forwarding → Always**, forward voice calls
to the Twilio number. Texting is unaffected — it stays on Telnyx exactly as
today. (Forwarding is only available on numbers not assigned to a voice/SIP
application; clear that first if the portal objects.)

## Testing it

1. Call the number **from a phone that is NOT on `VOICE_RING_TO`**. Your
   phone (and anyone else on the list) should ring; whoever picks up hears
   who is calling and must **press a key to take the call**. That keypress is
   deliberate: a cell's voicemail answers when the phone is off or busy, and
   without confirmation the caller would be bridged to a mailbox beep instead
   of reaching the attendant. (Calling from a ring-list number is the
   sharpest case — the carrier sends it straight to your own mailbox, which
   then asks the caller for a voicemail password.)
2. Don't answer. After ~18 seconds you should hear the attendant menu.
3. Press **1**, listen for the authorization sentence, then key in a card
   (Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC, any
   ZIP, while the connector is in test mode).
4. You should hear "your card ending in 4 2 4 2 is saved" and get a
   confirmation **text from the Telnyx line**.
5. Open `/admin/users`, look up that phone: it should show **Card on file**
   with the last 4 — no waiting, no manual step.
6. Text `AD NEW …` from that phone with an empty balance: the ad posts and the
   reply names the card charge. That's the whole point of the feature.
7. Press **2** on another call and leave a message: every number in
   `ADMIN_PHONES` gets a text with the recording link (the audio lives in the
   Twilio console; the app never stores it).

## Costs

Twilio Pay is about **$0.15 per successful capture**, inbound voice ~$0.0085/min
plus ~$1.15/month for the number, and the confirmation text is a normal Telnyx
segment. Charging the card later is Stripe's usual 2.9% + $0.30.

## What the app does with the card

`savePhoneCapturedCard` (lib/payments.ts) finds-or-creates the caller's Stripe
customer keyed by `metadata['phone']` in E.164 — the same key the standalone
service uses, so `adoptPhoneSavedCustomer` keeps working — attaches the
tokenized card, makes it the default for off-session charges, stamps
`card_consent_at` (the spoken authorization is the record card networks
require), and writes the customer id onto the member's account. A caller with
no account gets one created right there, so "call in, add a card, start
posting" works end to end.
