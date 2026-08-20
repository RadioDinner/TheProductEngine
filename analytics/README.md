# analytics/

Everything about **measuring The Plain Exchange** lives in this folder: what we
count today, what we want to know, how Google Analytics is set up, and the
drop-in code that produces the numbers.

## Why a folder of its own

Measurement is not one file. It is a taxonomy (what counts as an event), a
console configuration (property, stream, custom dimensions, key events), a
client-side tag, a **server-side** path for everything that happens off the
website (SMS, MMS, the call-in card line, cron sends), a privacy posture, and a
set of questions the operator actually asks on a Monday morning. Scattering
that across `lib/`, `docs/` and a migration is how measurement rots. Keeping it
together means one place to read, one place to change, one place to audit.

## What is in here

| File | What it is |
| --- | --- |
| `README.md` | This index. |

More lands here as the Google Analytics work is built: the audit of what we
measure today, the measurement plan, the GA4 setup guide, the staged code, and
the wiring instructions.

## The rule for this folder

Nothing in `analytics/` is wired into the running app until a wiring step says
so explicitly and someone applies it. Code staged here is **inert by design** —
it can be read, reviewed and merged without changing a single byte of the
site's behaviour. That is deliberate: measurement code that ships half-wired is
worse than no measurement, because the numbers look real and are not.

## What already exists outside this folder

The site is not blind today. `lib/analytics.ts` holds a first-party,
cookie-free page-view counter backed by Supabase (`page_views`,
`bump_page_view`, `visit_stats` — migration `9998_analytics.sql`), and the
admin Insights panel reports operational figures. Those keep working. Google
Analytics is being added **alongside** them, not on top of them: the
first-party counters stay the source of truth for anything that touches money
or delivery, because they are ours, they are exact, and they do not depend on a
visitor's browser executing a third-party script.
