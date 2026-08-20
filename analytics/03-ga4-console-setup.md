# Setting up the GA4 property

Do this before any code is wired. Several of these settings only affect data
collected *after* they are changed — get them wrong and the fix does not
backfill, because the data was never kept.

Google rearranges the Admin screens regularly. The setting **names** below are
stable; if a path is wrong, search the Admin page for the name in bold.

---

## Before you start

**There is no "business" version of Google Analytics to sign up for.** GA4 has
no personal-versus-business account type: you sign in with any Google account —
a plain `@gmail.com` is fine — and the first thing you create is an *Analytics
Account*, which is a container with a name on it. Typing `The Plain Exchange`
as that name is the whole of "making it a business account."

Two traps on the way in:

- **Searching "Google Analytics for business" lands on Analytics 360**, the paid
  enterprise tier (roughly $150k/year, every button says "Contact sales"). If
  you are looking at a sales form rather than a signup, that is the wrong
  product. Go to `analytics.google.com` directly.
- **Google Business Profile and Google Workspace are different products** — the
  Maps listing and paid email respectively. Neither is required and neither
  gets you Analytics.

What *does* matter is **ownership**: use an account the business controls and
will not lose, because the property will hold years of history. A personal
Gmail is fine if it is one that will still exist in five years. Add a second
Administrator as soon as you are in (step 12) — one account with sole access is
one forgotten password away from losing all of it.

---

## 1. Create the account and property

**First time:** `analytics.google.com` → **Start measuring**. The flow walks
account → property → business details → objectives → terms → data stream, and
hands you the Measurement ID at the end.

**Adding to an existing account:** **Admin** (gear, bottom of the left rail) →
**Create** → **Property**.

> **If you already use Firebase or Google Cloud, you probably already have a
> property — and it is the wrong one.** Firebase auto-creates GA4 properties
> named after the project with a random suffix (`permitpro-9db15`). It will be
> the property that loads by default, so the Admin screens will look like they
> are already set up. Do not reuse or rename it: it belongs to that Firebase
> project. Create a separate property for this site.
>
> **Every setting below is per-property.** The switcher at the top of the page
> keeps whatever property loaded last, so check it says `The Plain Exchange`
> before each step — otherwise you spend an hour carefully configuring
> somebody else's app.

On the **account data-sharing checkboxes**, untick **"Google products and
services"** — that is the setting that lets Google use this data for its own
products, which sits badly beside what `/privacy` promises members. "Technical
support" and "Account specialists" are harmless.

The business-details screen (industry, size) only tailors which reports are
shown by default. `Shopping` and `Small — 1 to 10 employees` are fine and
change nothing that cannot be changed later.

| Field | Value | Why it matters |
| --- | --- | --- |
| Property name | `The Plain Exchange` | — |
| Reporting time zone | **(GMT-05:00) Eastern Time — New York** | Every other daily figure in this app is bucketed in Eastern time (`lib/et.ts`, the send window, the picture allowance). A property on Pacific or UTC time would report a different "today" than `/admin`, and reconciling them later is miserable. |
| Currency | **US Dollar (USD)** | Revenue is sent in dollars. |

On the **business objectives** screen pick "Generate leads" and "Examine user
behavior", or "Get baseline reports" for all of them. It only decides which
reports are surfaced first and can be changed any time.

Accept the Terms of Service with country **United States** (the Analytics terms
plus the data-processing terms).

> **The time zone cannot be changed retroactively.** Changing it later leaves a
> permanent seam in the history where the day boundary moved.

---

## 2. Create the web data stream

**Admin → Data collection and modification → Data streams → Add stream → Web.**

- **Website URL:** the canonical host, exactly as it is served —
  `https://theplainexchange.com` or `https://www.theplainexchange.com`, matching
  whatever `SITE_URL` is set to. Not both; picking the one people are not
  redirected to produces a self-referral in every report.
- **Stream name:** `Website`.

The stream page shows the **Measurement ID**, `G-` followed by ten characters.
That is `NEXT_PUBLIC_GA_MEASUREMENT_ID`.

### Enhanced measurement

**Leave the toggle on, and leave nearly all of it alone.** Enhanced Measurement
is free data collected by Google's own tag; the only rule worth applying is
**never measure the same thing twice in two different ways**, because the two
numbers will disagree by a few percent forever and nobody will know which to
believe.

Applying that rule here:

- **Site search — LEAVE ON.** The homepage search passes its query as `?q=`
  (`app/page.tsx`), which is one of GA4's default search parameters, so the
  automatic `view_search_results` works correctly with no configuration at all.
  Turn it off only at the moment the custom `search` event ships (wiring step
  7), which adds `results_count` — "people searched for this and got nothing"
  is the actionable half, and the automatic version cannot know it. Until then,
  turning this off buys nothing and costs all search data.
- **Form interactions — off, but it is a preference.** Every form on this site
  is a server action, so `form_destination` resolves to a Next action id rather
  than anything readable, and `form_id`/`form_name` are usually empty. Every
  form fires it — sign-in, search, chat, settings toggles — so `form_submit`
  becomes an undifferentiated "somebody submitted something" that sits in the
  events list looking like a conversion. Noise hygiene, not correctness.
  Leaving it on breaks nothing.
- **Video engagement — irrelevant either way.** It only fires on embedded
  players, and there are none. Off is tidier; on costs nothing.

Leave **on**: page views, scrolls, outbound clicks, file downloads.

---

## 3. Create the Measurement Protocol API secret

**Admin → Data streams → `Website` → Measurement Protocol API secrets →
Create.** Nickname it `server` .

Copy the value into `GA_API_SECRET`. It is **server-only** — it authorises
writing events into the property. Never give it a `NEXT_PUBLIC_` prefix, never
put it in a client component, never paste it into a support ticket.

---

## 4. Data retention — change this now, it defaults to two months

**Admin → Data collection and modification → Data retention.**

- **Event data retention: 14 months** (the maximum on the free tier; the
  default is 2).
- **Reset user data on new activity: On.**

This only governs the *explorations* — the standard reports keep aggregates
longer — but every cohort, funnel and retention analysis in
`06-operating-the-numbers.md` reads from the retained data. Left at two months,
"how did last spring compare" is unanswerable, and no setting change brings the
deleted data back.

Fourteen months is also why `sql/first-party-upgrade.sql` exists: anything you
want to be able to ask in three years has to live in our own database.

---

## 5. Turn the advertising surface off

**Admin → Data collection and modification → Data collection.**

- **Google signals: OFF.** This is the switch that joins a visit to a signed-in
  Google identity across sites. It is precisely the "tracking you around the
  internet" that `/privacy` says we do not do.
- **Granular location and device data collection:** leave region defaults; there
  is nothing to gain from finer granularity for an Ohio-only service.

The code says this twice more — the tag pushes
`allow_google_signals: false` before `config`, and every server event carries
`ad_user_data: DENIED`. Belt and braces on purpose: a console setting changed by
somebody else, later, should not be able to quietly opt members in.

---

## 6. Reporting identity

**Admin → Data display → Reporting identity → Blended.**

`Blended` uses the `user_id` when it exists, the device when it does not. That
is what stitches a member's texts to their browsing into one person. `By device`
would report a flip-phone seller and their occasional web visit as two
unrelated users.

---

## 7. Filter out the operator's own traffic

Two layers, because either alone leaks.

**In the console:** Admin → Data streams → `Website` → Configure tag settings →
**Show all** → **Define internal traffic** → Create. Match `traffic_type`
`internal` to the operator's home and office IP addresses.

Then **Admin → Data filters** → the `Internal Traffic` filter → set to
**Active**. It ships as **Testing**, which does nothing but tag the data. This
is the single most commonly missed step in a GA4 setup, and the symptom is a
service whose most engaged user is the person who runs it.

**In the code:** the tag is not rendered on `/admin` at all
(`04-wiring.md`). IP filters break the moment the operator opens the site on
their phone over cellular; not rendering the tag does not.

---

## 8. Stop Stripe showing up as a referrer

**Admin → Data streams → `Website` → Configure tag settings → Show all → List
unwanted referrals.** Add:

```
stripe.com
checkout.stripe.com
```

A member who pays is redirected to Stripe and back. Without this, GA ends their
session at the redirect and starts a new one attributed to `stripe.com` — so
every paying member appears to have been *acquired from Stripe*, and the
acquisition report, the one thing this whole exercise exists to produce, is
wrong in exactly the place it matters most.

---

## 9. Register the custom definitions

**Admin → Data display → Custom definitions.** Create each one from
`02-measurement-plan.md`, matching the parameter names exactly — they are
case-sensitive and cannot be renamed later without breaking historical data.

Event-scoped dimensions: `channel`, `listing_category`, `command`, `reason`,
`method`, `outcome`, `payment_channel`.

User-scoped dimensions: `member_status`, `signup_channel`, `line_type`,
`has_saved_card`.

Custom metrics (set the unit — `wait_minutes` is *minutes*, `days_to_sell` is
*standard*, not currency): `photo_count`, `segments`, `recipients`,
`wait_minutes`, `days_to_sell`, `reveals_left`, `duration_seconds`.

> Registering a dimension is **not** retroactive. It reports from the day it is
> created. Do this before the events start flowing, not after you go looking for
> one.

---

## 10. Mark the key events

**Admin → Data display → Key events → New key event**, and add by name. The
event does not have to have been seen yet:

`sign_up`, `post_submit`, `listing_reveal`, `listing_sold`, `purchase`,
`generate_lead`.

`purchase` carries `value` and `currency`, so revenue appears in Monetization
with no further configuration.

---

## 11. Link Search Console

**Admin → Product links → Search Console links.** Requires verifying the domain
in Search Console first (a DNS TXT record, or the existing site verification).

Worth the twenty minutes for a local classifieds site: it is the only way to see
what people typed into Google to find you. "Amish classifieds Ohio" versus "used
farm equipment near me" is a different marketing plan, and neither shows up
anywhere else.

---

## 12. Users, and a second administrator

**Admin → Account access management.** Add a second person, or a second account
you control, as **Administrator**. One account with sole access to years of
history is one forgotten password away from losing all of it.

---

## 13. Verify, before believing anything

In order. Do not skip to the reports — the standard reports lag by up to 24–48
hours, and staring at an empty one teaches you nothing about whether it works.

0. **`/api/health`** — confirms the deployment actually has the variables. Note
   it needs the operator bearer token in production:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/health`.
   Look for `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `GA_API_SECRET` and
   `ANALYTICS_SALT` all true. **Vercel applies an environment change only on
   the next deploy**, so if they are false after setting them, redeploy.
1. **Validate the payload shape.** Set `GA_VALIDATE_ONLY=1` and send one event.
   `validateServerEvents()` in `analytics/src/measurement-protocol.ts` returns
   Google's own complaints; an empty array means the payload is acceptable.
   **The live endpoint returns 204 for payloads it throws away** — this is the
   only honest check of the shape.
2. **Set `GA_DEBUG_MODE=1`, unset `GA_VALIDATE_ONLY`, and watch DebugView.**
   Reports → **DebugView**, events within seconds.

   > **Server events do NOT appear in DebugView by default.** DebugView shows
   > only events flagged `debug_mode`, which the browser tag sets via the
   > Google Analytics Debugger extension and which a Measurement Protocol
   > event has to carry explicitly. `GA_DEBUG_MODE=1` is what adds it. Without
   > that, a freshly wired server integration is unverifiable for up to 48
   > hours — which reads exactly like a broken integration and sends people
   > rewriting code that was working all along.

   Turn it back off once you have seen the events land.
3. **Realtime** — Reports → Realtime. Works for both the browser tag and server
   events without any debug flag, because the library always sends
   `engagement_time_msec` and `session_id`. Coarser than DebugView, but it is
   the honest "is anything arriving at all" check.
4. **Then wait a day** before drawing any conclusion from a standard report.

If DebugView is empty for a server event but validation passed, the usual cause
is a missing `client_id` or a timestamp outside the 72-hour window. Both are
returned by `sendServerEvents` as `skipped`.

---

## 14. The environment variables

Set on the **Production** environment in Vercel only. Preview and development
deployments must not have `NEXT_PUBLIC_GA_MEASUREMENT_ID` set — that absence is
what keeps test traffic out of the property, and it is more reliable than any
runtime check.

```
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-0P031ZCC9Z   # public; ships in the page
GA_API_SECRET=<from step 3>                  # server only
ANALYTICS_SALT=<48+ random characters>       # server only, treat as a password
# GA_VALIDATE_ONLY=1                         # temporary, for step 13
```

The measurement id above is **this site's real one**, for the property created
2026-08-20. It is recorded here because it is not a secret — it ships in the
HTML of every page — and hunting for it in the console later is a nuisance.

It still belongs in an environment variable rather than hardcoded in the app.
That is what keeps preview and local builds out of the property: they simply do
not have the variable set, which is more reliable than any runtime check of
which environment we are in.

Generate the salt with `openssl rand -hex 32`.

**`ANALYTICS_SALT` is a secret with teeth.** It is what stands between a hashed
member id and the member's phone number: there are only ten billion US phone
numbers, so anyone holding the salt can reverse every hash by brute force in
minutes. Store it like a password. Rotating it resets user continuity in GA —
new hashes, new users, broken cohorts — so rotate deliberately, not casually.

Add all three to `.env.example` with these comments when the wiring lands.
