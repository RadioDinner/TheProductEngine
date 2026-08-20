# analytics/

Everything about **measuring The Plain Exchange** lives in this folder: what we
count today, what we want to know, how Google Analytics is set up, the drop-in
code that produces the numbers, and how to read them without fooling yourself.

## Start here

| Read this | If you want to |
| --- | --- |
| [`00-todo.md`](00-todo.md) | **The shared worklist.** What is done, what is next, and who owns it. |
| [`01-what-we-measure-today.md`](01-what-we-measure-today.md) | Know what the service already counts, and the eleven questions it cannot answer. |
| [`02-measurement-plan.md`](02-measurement-plan.md) | See the nine questions, the events that answer them, and the dimensions to register. |
| [`03-ga4-console-setup.md`](03-ga4-console-setup.md) | Set up the GA4 property, step by step. Do this first. |
| [`04-wiring.md`](04-wiring.md) | Turn it on — the exact changes outside this folder, in the order to make them. |
| [`05-privacy-and-consent.md`](05-privacy-and-consent.md) | **Read before wiring the browser tag.** The privacy policy currently promises the opposite of what GA does. |
| [`06-operating-the-numbers.md`](06-operating-the-numbers.md) | Actually use the numbers: the Monday routine, four reports, and how not to read noise. |

## The code

Staged, typechecked, and **imported by nothing**. `tsc --noEmit` is clean and
`next build` is clean with it present, because nothing in the app references it
yet.

| File | What it is |
| --- | --- |
| `src/config.ts` | Environment, feature gates, and GA4's hard limits in one place. |
| `src/events.ts` | The event catalogue — the contract. Every event, its trigger, and the question it answers. |
| `src/ids.ts` | Salted hashing. How a member is identified to Google without telling Google who they are. |
| `src/track.ts` | Browser emitter. Scrubs anything phone- or email-shaped on the way out. |
| `src/measurement-protocol.ts` | Server-side sender: batching, timeouts, validation, never throws. |
| `src/server-events.ts` | One named helper per business moment, so wiring is a single line. |
| `src/GoogleAnalytics.tsx` | The tag, as one component for `app/layout.tsx`. |
| `sql/first-party-upgrade.sql` | Our own counter, upgraded: referrer, campaign, and unique people. Cookieless. Not yet numbered — see `04-wiring.md` step 10. |
| `test/analytics.test.mjs` | 75 checks over the rules GA4 breaks silently. |

Run the tests:

```sh
node --experimental-strip-types --disable-warning=ExperimentalWarning \
     --loader ./test/abuse/alias-loader.mjs analytics/test/analytics.test.mjs
```

## The rule for this folder

Nothing in `analytics/` is wired into the running app until `04-wiring.md` says
so and someone applies it. Code staged here is **inert by design** — it can be
read, reviewed and merged without changing a single byte of the site's
behaviour. That is deliberate: measurement code that ships half-wired is worse
than no measurement, because the numbers look real and are not.

## The five things worth knowing before touching any of it

1. **A classified ad is a "listing" in GA.** GA4 reserves `ad_click`,
   `ad_impression`, `ad_exposure` and `ad_query`, and silently discards events
   that use them. Our most important events would have vanished with no error to
   search for.

2. **Most of this business is invisible to a browser tag.** Members text; they
   do not browse. That is why the Measurement Protocol path
   (`src/measurement-protocol.ts`) matters more here than on almost any other
   site, and why it is step 2 of the wiring rather than an afterthought.

3. **The privacy policy currently says we run no analytics trackers.** In
   writing, on `/privacy`. Shipping the browser tag makes that false while it is
   still published. `05-privacy-and-consent.md` has the conflict, three ways
   forward, and drafted replacement copy.

4. **Google is never told who anyone is.** Members are a salted SHA-256 of their
   phone number, and the browser emitter strips anything phone- or email-shaped
   out of every string parameter — not from a list of risky fields, from all of
   them, because the leak is always through the field nobody thought about.

5. **When GA and Supabase disagree, Supabase is right.** GA drops what ad
   blockers block, models what consent denies, samples what gets large, and
   forgets after 14 months. Fine for understanding behaviour. Not acceptable for
   counting dollars.

## What already exists outside this folder

The site is not blind today. `lib/analytics.ts` holds a first-party,
cookie-free page-view counter backed by Supabase (`page_views`,
`bump_page_view`, `visit_stats` — migration `9998_analytics.sql`), and
`lib/insights.ts` powers a genuinely good operational dashboard at
`/admin/insights`. Those keep working, unchanged.

Google Analytics is being added **alongside** them, not on top of them: the
first-party counters stay the source of truth for anything that touches money or
delivery, because they are ours, they are exact, and they do not depend on a
visitor's browser executing a third-party script.
