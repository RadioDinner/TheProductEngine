# Privacy, consent, and one sentence that has to change

**Read this before wiring the browser tag.** There is a direct, published
conflict between what `/privacy` promises today and what Google Analytics does.
It is not a technicality, it is not something to fix afterwards, and it is not
something a consent banner makes go away.

---

## The conflict, in the site's own words

`app/privacy/page.tsx`, under **Cookies** (lines 156–165):

> This website uses one kind of cookie: the one that keeps you signed in. **No
> advertising cookies, no analytics trackers, no third-party cookies, and no
> web beacons or tracking pixels** — on the site or in our emails.
>
> We do count page visits, but the counter runs on our own server without
> cookies and stores no personal information — it cannot identify you.

And under **How we use it** (line 92):

> We do not use your information for advertising other people's products, and
> **we do not track you around the internet**.

Adding the GA4 browser tag makes the phrase *"no analytics trackers"* false the
moment it deploys. The **What we share** list (lines 122–127) — carrier, email
provider, Stripe, hosting — would also be incomplete, because Google would then
be receiving data about members and is not on it.

Two things in that copy survive intact, and are worth keeping:

- **"No third-party cookies" stays true.** GA4's `_ga` cookie is set on our own
  domain and is a first-party cookie. This is a real distinction, not a lawyer's
  one, and the plain-language copy can say so honestly.
- **"We do not track you around the internet" stays true** — *provided* Google
  Signals stays off and ad personalisation stays denied. That is exactly what
  step 5 of the console setup and the `consent: DENIED` on every server event
  are for. Turn Google Signals on later and this sentence becomes a lie.

Good copy is not the goal here. The goal is that a member who reads the page
learns what actually happens. This audience in particular did not sign up to be
measured by a company they have never heard of, and finding out later — from
somebody else — is how a small local service loses the trust it runs on.

---

## Three ways forward

### Option A — server-side only

Send events from our servers with the Measurement Protocol and never load
Google's JavaScript. No third-party script, no `_ga` cookie, nothing about the
member's browser leaves the building except the events we deliberately choose.

- **Keeps:** every cookie sentence true, word for word. Only "no analytics
  trackers" needs amending, and the amendment is mild and honest.
- **Covers everyone.** This is the part people miss: the server-side path sees
  the flip-phone member and the visitor with JavaScript off, and the browser tag
  never will. On this service, coverage is *better* this way.
- **Attribution still works.** Referrer and UTM parameters are available
  server-side from the request and can ride on the event.
- **Costs:** device, browser and geography reports become meaningless, because
  GA sees our server, not the visitor. No scroll, engagement time, or
  client-side session behaviour. Realtime is thin.

### Option B — browser tag, advertising surface off, policy rewritten (**recommended**)

The full GA4 setup as designed in this folder: the tag on member-facing pages,
Google Signals off, ad storage denied permanently, and the policy updated to
describe it plainly.

- **Keeps:** "no third-party cookies", "no advertising cookies", "we do not
  track you around the internet" — all still true.
- **Gives:** the acquisition and behaviour answers that motivated this whole
  exercise. Question 1 in the measurement plan — *where do members come from* —
  is answered properly by this and only approximately by anything else.
- **Costs:** one first-party analytics cookie, data about web visitors going to
  Google, and a paragraph of the privacy policy rewritten.

### Option C — browser tag with cookies denied

Load the tag with `analytics_storage: 'denied'` so it runs cookieless.

- Honest-sounding, and mostly not worth it: the data still goes to Google, so
  the "no analytics trackers" sentence needs the same amendment as Option B,
  while user and session counts become modelled approximations. **You give up
  the accuracy and keep the disclosure.** Reach for this only if a real consent
  requirement appears.

`GoogleAnalytics.tsx` supports C already — pass `analyticsConsent={false}` — so
the choice stays reversible without a code change.

---

## The recommendation

**Ship Option A first, then move to Option B once the policy is live.**

Not a hedge — an order of operations. Step 2 of `04-wiring.md` (SMS and payment
events) is Option A exactly: it needs no consent decision, involves no cookie,
covers every member rather than the browser-using minority, and starts
answering questions this week. The browser tag then adds the web behaviour on
top, after the policy has been updated, which is the sequence that never leaves
a published promise untrue.

If the choice is to stay on Option A permanently, that is a defensible position
for this audience and this brand. It is not the usual advice, and on most sites
it would be wrong. Here the JavaScript-capable share of visitors is the *small*
part of the membership.

**Ohio has no comprehensive consumer privacy law in force, and GDPR does not
reach a US-only service, so no consent banner is legally required for either
option.** The binding constraint here is not a statute — it is the sentence this
business chose to publish about itself. That is a higher bar than the law, and
it was chosen deliberately. Meet it.

---

## Drafted replacement copy

For `app/privacy/page.tsx`. Plain language, same voice as the rest of the page.
Apply at step 13 of `04-wiring.md` — **before** the tag ships, not after.

### Replace the Cookies section

```
<h2>Cookies</h2>
<p>
  This website uses two kinds of cookie, both set by us, and neither one
  follows you off this site. The first keeps you signed in. The second is
  a counting cookie for Google Analytics, which we use to see how many
  people visit, which pages they read, and how they found us — so we know
  whether the service is reaching the people it is meant for.
</p>
<p>
  No advertising cookies, no third-party cookies, and no web beacons or
  tracking pixels — on the site or in our emails. We have turned off
  Google&rsquo;s advertising features, so nothing here is used to build an
  advertising profile of you or to show you ads anywhere else.
</p>
<p>
  Google Analytics is told what pages were viewed and what actions were
  taken. It is never told your phone number, your email address, your name,
  or what your ads say. When we need to recognise a returning member, we
  send a scrambled code that stands in for the account — it cannot be turned
  back into your phone number.
</p>
<p>
  We also count page visits with our own counter, which runs on our server
  without cookies and stores no personal information.
</p>
```

### Add Google to "What we share"

```
<li>Google Analytics, to count visits and tell us how people find the site.</li>
```

### Leave line 92 exactly as it is

> "We do not use your information for advertising other people's products, and
> we do not track you around the internet."

Still true, and it stays true only as long as **Google Signals is off** and
**ad personalisation is denied**. If anyone ever turns those on, this sentence
must come out the same day. Worth a comment in the code above it.

### If Option A is chosen instead

The Cookies section keeps its first paragraph unchanged (one cookie, sign-in
only) and gains:

```
<p>
  We use Google Analytics to understand how the service is used, but not in
  the usual way: no Google code runs in your browser and no Google cookie is
  set. Our own server reports what happened — an ad was posted, a page was
  read — with a scrambled code in place of your phone number. Google is never
  told who you are.
</p>
```

---

## Rules that hold under every option

1. **No PII, ever.** Enforced in code, not by care: `analytics/src/track.ts`
   scrubs anything phone- or email-shaped out of every string parameter, and
   `events.ts` has no field for an ad's name. Members write their own phone
   numbers into ad bodies constantly — the site masks them for that exact
   reason.
2. **Members are a salted hash.** `ANALYTICS_SALT` is a real secret: there are
   only ten billion US phone numbers, so anyone holding the salt can reverse
   every hash by brute force. Store it like a password.
3. **Google Signals stays off.** It is the switch that would make the "around
   the internet" sentence untrue.
4. **Data retention 14 months** in GA. Anything that must be answerable in three
   years lives in our own tables (`sql/first-party-upgrade.sql`), where the
   visitor token hashes the calendar day into itself and so cannot follow anyone
   across days — not by us, not later, not deliberately.
5. **Nothing on `/admin`.** Not for privacy — for accuracy. The operator's own
   traffic would distort every rate on a service this size.
6. **A member asking to be forgotten:** GA has a User Deletion API keyed on
   `user_id`. Because `user_id` is a deterministic hash of the phone number, we
   can recompute a specific member's id and delete them from GA without storing
   any mapping. Worth knowing before someone asks.
