# Wiring it in — the record of what was done

**All of this is now applied.** The file stays as the map: every place the app
touches the measurement, why the event sits exactly there and not one line
earlier, and what to re-check if any of it is ever moved.

It was written before the wiring, as instructions, because several sessions
were working in this repo that day and a change to `app/layout.tsx` or
`lib/engine.ts` would have collided with all of them. Reading it as a record
now, the "why here" notes are the part that matters — most of them mark a place
where the obvious seam produces a wrong number rather than a missing one.

Verified at every step: `tsc --noEmit` clean, `next build` clean, unit suite
1033/1033, abuse harness unchanged.

---

## Step 0 — the imports

Staged modules are imported from where they live:

```ts
import { GoogleAnalytics } from "@/analytics/src/GoogleAnalytics";
import * as analytics from "@/analytics/src/server-events";
```

The `@/*` alias already resolves to the repo root (`tsconfig.json`), so this
works with no config change. **Do not add `analytics/` to `.vercelignore`** —
once the layout imports from it, it is part of the build. (`pay-by-phone/` is
excluded there because it is a separate deployable; this is not.)

If you would rather these lived in `lib/`, move them — but move the whole
folder's worth together, and update `analytics/README.md` to say where they
went. Splitting the measurement across two homes is the thing this folder
exists to prevent.

---

## Step 1 — environment variables

Add to `.env.example` (values stay empty there):

```sh
# --- Google Analytics 4 (analytics/) ---
# Web data stream measurement id, "G-XXXXXXXXXX". PUBLIC — it ships in the page.
# Set it on the PRODUCTION environment only: an unset id is what keeps preview
# deploys out of the property.
NEXT_PUBLIC_GA_MEASUREMENT_ID=
# Measurement Protocol API secret (GA4 Admin -> Data streams -> your stream).
# SERVER ONLY: it authorises writing events into the property.
GA_API_SECRET=
# Salt for hashing member phone numbers into GA user ids. SERVER ONLY, and a
# real secret: there are only ten billion US phone numbers, so anyone holding
# the salt can reverse every hash. openssl rand -hex 32. Rotating it resets
# user continuity in GA.
ANALYTICS_SALT=
# Set to 1 to send server events to GA's VALIDATION endpoint instead of the
# real one — it reports what is wrong and stores nothing. The live endpoint
# returns 204 even for payloads it discards, so this is the only honest check.
GA_VALIDATE_ONLY=
```

Set the real values in Vercel per `03-ga4-console-setup.md` step 14.

---

## Step 2 — server events on the SMS path (do this one first)

`app/api/telnyx/inbound/route.ts`, after the command is parsed and the reply is
sent — **never before**. An analytics call must never sit between a member's
text and their answer.

```ts
import * as analytics from "@/analytics/src/server-events";

// after the reply has been dispatched:
void analytics.smsInbound({ phone: from, command: cmd.kind, isMember: !!account });
```

Then, at the points that already exist in that route:

```ts
void analytics.signedUp({ phone: from, method: "sms" });          // SUBSCRIBE
void analytics.unsubscribed({ phone: from, channel: "sms" });     // STOP
void analytics.postSubmitted({ phone: from, channel: "sms", category, photoCount, priceCents });
void analytics.picPull({ phone: from, outcome: "granted", pullsLeft });
```

**`void`, not `await`.** These are fire-and-forget by contract; the library
swallows its own failures and times out in ten seconds.

This step alone is worth shipping on its own. It covers every member including
the ones who never load a web page, and it needs no consent decision because no
cookie is involved.

---

## Step 3 — the money path

`app/api/stripe/webhook/route.ts`, where a paid checkout is credited:

```ts
void analytics.purchaseCompleted({
  phone,
  clientId: session.metadata?.ga_client_id,   // see step 4
  transactionId: session.id,                  // Stripe's id — GA de-duplicates on it
  amountCents,
  productId: "credit_topup",
  productCategory: "account_credit",
  paymentChannel: "web",
});
```

**The webhook, never the success page.** `/account/checkout/success` can be
reloaded, bookmarked, shared, or reached without paying — every one of those
would book revenue that did not happen.

`transaction_id` must be the Stripe id so a retried webhook de-duplicates in GA
instead of counting the money twice.

Also wire `analytics.refunded(...)` and `analytics.autoTopUp(...)` where the
ledger already records them.

---

## Step 4 — carry the browser's client id into Stripe

Small, easy to skip, and skipping it costs the single most valuable number in
the property.

In `lib/account-actions.ts` `startStripeCheckout`, read the `_ga` cookie and put
it in the checkout metadata:

```ts
import { cookies } from "next/headers";
import { gaClientIdFromCookie } from "@/analytics/src/ids";

const gaClientId = gaClientIdFromCookie((await cookies()).get("_ga")?.value) ?? "";
// ...then, in the Stripe session:
metadata: { ...existing, ga_client_id: gaClientId },
```

Without it, the purchase arrives at GA as a brand-new user with no history, and
**every payment on the service is attributed to "(direct)" forever.** The
acquisition report — the reason for doing any of this — is then wrong in exactly
the place it matters most.

Do the same for `lib/business-actions.ts` `startBusinessCheckout`.

---

## Step 5 — the browser tag

`app/layout.tsx`. The imports and the session read are already there; add the
admin check and one element:

```tsx
import { GoogleAnalytics } from "@/analytics/src/GoogleAnalytics";
import { hashedMemberId } from "@/analytics/src/ids";
import { ANALYTICS_SALT } from "@/analytics/src/config";

// inside RootLayout, after `const session = await readSession()`:
const isAdmin = session ? isAdminPhone(session.phone) : false;
const memberId = session ? hashedMemberId(session.phone, ANALYTICS_SALT) : "";

// inside <body>, as the last child:
{!isAdmin && (
  <GoogleAnalytics
    measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ""}
    memberId={memberId}
  />
)}
```

`isAdminPhone` is already imported in that file.

**Why the operator is excluded in code and not only by an IP filter:** on a
service this size the person who runs it is a meaningful share of all traffic,
and their sessions would distort every rate on the dashboard. The IP filter
(step 7 of the console setup) covers them signed out; this covers them on
cellular, on a borrowed laptop, and anywhere an IP filter silently stops
matching.

The hash is computed on the server; `ANALYTICS_SALT` never reaches the browser.

---

## Step 6 — page coverage

`recordVisit` is called from four pages today. Add it to the rest of the public
ones — `/how-it-works`, `/faq`, `/advertising`, `/email`, `/sms`, `/login`,
`/privacy`, `/terms-and-conditions`, `/refund-policy`, `/accessibility`:

```ts
await recordVisit("/faq");
```

And in `app/ad/[id]/page.tsx`, change the literal `"/ad"` to include the id, so
the most-viewed-listing question becomes answerable at all:

```ts
await recordVisit(`/ad/${id}`);
```

> Path cardinality: one row per (day, path). Adding the id multiplies the rows
> by the number of ads viewed each day — tens, not thousands. Fine. Revisit if
> the service ever gets big enough for that to stop being true.

---

## Step 7 — listing and intent events on the web

```ts
// app/ad/[id]/page.tsx — a server component, so send it from the client
// wrapper or a small "use client" island:
track("view_item", {
  items: [{ item_id: `ad_${id}`, item_category: category, item_list_name: from }],
  listing_category: category,
  has_photo: photos.length > 0,
});

// lib/reveal-actions.ts revealNumber(), on success:
track("listing_reveal", { listing_category: category, reveals_left: left });
// and on refusal:
track("listing_reveal_blocked", { reason: "out_of_lookups" });

// lib/account-actions.ts startChat():
track("chat_start", { listing_category: category });
```

`track` (`@/analytics/src/track`) is browser-only. Server actions cannot call
it — emit from the client component that invokes the action, or send the
server-side equivalent through `server-events.ts`. Sending both is the one thing
to avoid: it double-counts, and the two numbers will disagree by a few percent
forever, which destroys trust in both.

---

## Step 8 — approvals, broadcasts, sales

```ts
// lib/admin-actions.ts, on approve / reject:
void analytics.listingApproved({ phone: ad.ownerPhone, category, channel, waitMinutes, photoCount });
void analytics.listingRejected({ phone: ad.ownerPhone, category, channel, reason: "word_filter" });

// lib/digest-engine.ts, where the ad text actually leaves:
void analytics.listingBroadcast({ phone: ad.ownerPhone, category, recipients, segments, isMms });

// wherever SOLD is recorded (SMS command and My ads both):
void analytics.listingSold({ phone, category, channel, daysToSell });

// lib/email-digest.ts, per edition:
void analytics.emailEditionSent({ operatorPhone, recipients, listingCount, slotHour });
```

`wait_minutes` and `days_to_sell` are the two numbers worth the wiring:
review latency is something the operator controls directly, and days-to-sell is
the proof the service works.

---

## Step 9 — the voice line

`app/api/voice/route.ts`, at the stages that already branch:

```ts
void analytics.callInbound({ phone: caller, outcome: "attendant", durationSeconds, menuChoice });
void analytics.cardSaved({ phone: caller, channel: "voice" });
```

---

## Step 10 — the first-party upgrade

1. Move `analytics/supabase/migrations/9961_analytics_upgrade.sql` into `supabase/migrations/`,
   renamed to **`<lowest existing number − 1>_analytics_upgrade.sql`** — taken
   at the moment you move it, not from this document. Migrations here count
   DOWN (`new_session_instructions.md` §4); the lowest number was `9967` when
   this was written and parallel sessions were actively claiming numbers.
2. Paste it into the Supabase SQL Editor by hand. Never `supabase db push`.
3. Extend `lib/analytics.ts` `recordVisit` to gather the source and call
   `bump_visit` instead of `bump_page_view`:

```ts
import { headers } from "next/headers";
import { dailyVisitorHash } from "@/analytics/src/ids";

const h = await headers();
const refHost = (() => {
  try { return new URL(h.get("referer") ?? "").hostname; } catch { return ""; }
})();
const visitorHash = dailyVisitorHash(
  h.get("x-forwarded-for")?.split(",")[0] ?? "",
  h.get("user-agent") ?? "",
  process.env.ANALYTICS_SALT ?? "",
  day,
);
await db().rpc("bump_visit", {
  p_day: day, p_path: path, p_ref_host: refHost,
  p_utm_source: utm.source, p_utm_medium: utm.medium, p_utm_campaign: utm.campaign,
  p_visitor_hash: visitorHash,
});
```

Keep the existing `bump_page_view` call path working until `bump_visit` is
confirmed in production — `bump_visit` bumps `page_views` too, so `/admin`'s
current figures never regress.

4. Add a degrade guard the way the other stores do: if the RPC is missing
   (PostgREST returns `PGRST202`/`PGRST205`, not `42P01`), fall back to
   `bump_page_view` and log once. A page must never 500 because a migration has
   not been pasted yet.

---

## Step 11 — health probe

`app/api/health/route.ts` already reports which keys are present. Add:

```ts
analytics: {
  measurementId: !!process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  apiSecret: !!process.env.GA_API_SECRET,
  salt: !!process.env.ANALYTICS_SALT,
  validateOnly: process.env.GA_VALIDATE_ONLY === "1",
},
```

Booleans only. Never the values.

`GA_VALIDATE_ONLY` left set in production is a silent outage — everything looks
healthy and nothing is recorded. Having it on the health page is what makes that
findable in a minute rather than a fortnight.

---

## Step 12 — register the test suite

`test/run.mjs`: add `"analytics"` to `SUITES`, and either move
`analytics/test/analytics.test.mjs` to `test/analytics.test.mjs` or point the
runner at it. It already exports `name` and `run(t)` in the expected shape.

Until then it runs standalone:

```sh
node --experimental-strip-types --disable-warning=ExperimentalWarning \
     --loader ./test/abuse/alias-loader.mjs analytics/test/analytics.test.mjs
```

75 checks, all passing.

---

## Step 13 — the privacy policy

**Not optional, and not last in spirit — only last in this list because it is
the one change that must be live before the tag is.** `/privacy` currently
states in writing that this site runs no analytics trackers and no third-party
cookies. Shipping the browser tag makes that sentence false while it is still
published.

The conflict, the options, and drafted replacement copy are in
`05-privacy-and-consent.md`. Read it before step 5.

---

## Checklist

```
[x] 1  .env.example + Vercel production variables
[x] 2  SMS events            lib/engine.ts + the Telnyx route
[x] 3  purchase / refund     app/api/stripe/webhook/route.ts, lib/moderation.ts
[x] 4  ga_client_id          lib/payments.ts + both callers
[x] 5  browser tag           app/layout.tsx
[x] 6  page coverage         the ten pages, /ad/<id>
[x] 7  listing events        ad page, homepage, reveal-actions, account-actions
[x] 8  lifecycle             moderation, digest-engine, email-digest, myads
[x] 9  voice                 app/api/voice/route.ts
[x] 10 first-party upgrade   migration 9961 + lib/analytics.ts   ← NEEDS PASTING
[x] 11 health probe          app/api/health/route.ts
[x] 12 test suite            test/analytics.test.mjs in test/run.mjs
[x] 13 privacy policy        app/privacy/page.tsx
```

The one thing still owed to a human: **paste
`supabase/migrations/9961_analytics_upgrade.sql`**. Everything else is live.

## What was deliberately NOT built

- **`line_type` as a user property.** It would need a number lookup on a path
  that does not already do one, to answer a question nobody is asking yet.
- **`listing_expired`.** Expiry is a background sweep with no member action
  behind it; the same fact is already derivable from `listing_sold` against ads
  posted, without another event in the property.
- **A generic catch-all on external link clicks.** GA4's Enhanced Measurement
  already reports those. Two sources for one number is how you end up with two
  numbers that disagree and no way to choose.
