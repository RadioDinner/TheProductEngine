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
| [`07-audit.md`](07-audit.md) | **The 2026-08-20 review** — what is solid, and the ten weak spots found by reading the code. |

## The code

**Live.** The app imports all of it — the browser tag from `app/layout.tsx`,
the server helpers from the engine, the routes and the server actions.

| File | What it is |
| --- | --- |
| `src/config.ts` | Environment, feature gates, and GA4's hard limits in one place. |
| `src/events.ts` | The event catalogue — the contract. Every event, its trigger, and the question it answers. |
| `src/ids.ts` | Salted hashing. How a member is identified to Google without telling Google who they are. |
| `src/track.ts` | Browser emitter. Scrubs anything phone- or email-shaped on the way out. |
| `src/measurement-protocol.ts` | Server-side sender: batching, timeouts, validation, never throws. |
| `src/server-events.ts` | One named helper per business moment, so wiring is a single line. |
| `src/GoogleAnalytics.tsx` | The tag, as one component for `app/layout.tsx`. |
| `src/after.ts` | Keeps a server event alive past the response — serverless kills fire-and-forget work. |
| `src/clicks.ts` | One delegated click listener for the whole site. |
| `src/TrackEvent.tsx` | Lets a server-rendered page fire one event. |
| `supabase/migrations/9961_analytics_upgrade.sql` | Our own counter, upgraded: referrer, campaign, unique people. Cookieless. **Pasted 2026-08-20.** |
| `test/analytics.test.mjs` | 77 checks over the rules GA4 breaks silently. Runs in the main suite. |

Run the tests:

```sh
npm test          # the analytics suite runs inside it
```

## The rule for this folder

It was built staged and inert, then wired in six verified waves. The rule that
produced that is still the rule for changes: **measurement that ships
half-wired is worse than none, because the numbers look real and are not.**
`04-wiring.md` is now the record of where each event sits and why it sits
exactly there.

## The five things worth knowing before touching any of it

1. **A classified ad is a "listing" in GA.** GA4 reserves `ad_click`,
   `ad_impression`, `ad_exposure` and `ad_query`, and silently discards events
   that use them. Our most important events would have vanished with no error to
   search for.

2. **Most of this business is invisible to a browser tag.** Members text; they
   do not browse. That is why the Measurement Protocol path
   (`src/measurement-protocol.ts`) matters more here than on almost any other
   site, and why it is step 2 of the wiring rather than an afterthought.

3. **The privacy policy was rewritten to match** what the tag actually does,
   and shipped in the SAME commit as the tag. "No third-party cookies" and "we
   do not track you around the internet" both remain TRUE — the second only
   while Google Signals stays off. `05-privacy-and-consent.md` has the
   reasoning; there is a comment above the sentence in the code saying it must
   come out the same day anyone turns Signals on.

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
