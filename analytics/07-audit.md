# Audit — 2026-08-20

A review of the analytics as built, done by reading the code rather than the
plan. Findings are ranked by what they cost, not by how hard they are to fix.

---

## What is genuinely solid

Worth stating first, because the findings below are a short list against a
large surface:

- **PII cannot leak through a parameter.** `track.ts` scrubs anything phone- or
  email-shaped from every string on the way out, and `GaItem` has no
  `item_name` field. The leak is always through the field nobody thought about;
  this closes that class rather than a list of known-risky fields.
- **Money is counted from the webhook, inside the ledger-ref guard.** A Stripe
  retry cannot report revenue twice, and a reloaded success page cannot report
  it at all.
- **Members are a salted hash, and off-web events derive a stable client_id
  from it.** One flip-phone seller is one GA user across a year of texts.
- **Reserved GA4 names are avoided and unit-tested**, so this product's most
  important events cannot silently vanish into `ad_click`.
- **The first-party counter degrades rather than breaking** when a migration is
  missing, and warns once rather than per request.

---

## 🔴 1. Server-action events are on the lossy path

**The biggest finding, and it is invisible from the reports.**

`analytics/src/after.ts` exists because serverless kills fire-and-forget work
when the response is sent. It takes Next's `after()` by injection —
`setAfterImpl(after)` — and that call lives in exactly four files:

```
app/api/cron/digests/route.ts
app/api/stripe/webhook/route.ts
app/api/telnyx/inbound/route.ts
app/api/voice/route.ts
```

Server actions do not load those modules. So for every event emitted from a
`lib/*-actions.ts` file, `afterResponse()` finds no implementation and falls
back to running the work inline, unawaited — precisely the behaviour the file
was written to avoid.

**Events on the degraded path:**

`listing_reveal` · `listing_reveal_blocked` · `chat_start` · `login` ·
`begin_checkout` · `contact_submit` · `town_hall_submit` · `email_signup` ·
`listing_sold` (web lane) · `listing_approved` · `listing_rejected` · `refund`

That includes **two of the six key events**. The symptom is not an error — it
is an undercount of unknown size that still looks entirely plausible.

**Fix:** register the implementation where server actions will load it.
`lib/reveal-actions.ts` and `lib/account-actions.ts` already import
`next/server`, so it costs no new dependency there. **`lib/moderation.ts` and
`lib/digest-engine.ts` must NOT** — both are loaded by the test harness under
plain node, where `next/server` does not resolve. For those, the admin server
actions that call them are the right place.

---

## 🔴 2. `generate_lead` is a key event that nothing emits

It is in the catalogue, it is on the list of six key events to mark in the
console, and **no code path sends it**. Business sponsorship checkout emits
nothing at its start.

So the business-advertising funnel has an end (`purchase` fires when a package
is created) and no beginning. "How many businesses start buying and how many
finish" is unanswerable, and business advertising is the highest-value single
action on the site.

**Fix:** emit it in `lib/business-actions.ts` `startBusinessCheckout`, beside
the existing `gaClientId` read, with `value`, `currency` and the tier.

---

## 🟡 3. The catalogue over-promises

`analytics/src/events.ts` is described as the contract. Four events in it are
never emitted:

| Event | Status |
| --- | --- |
| `generate_lead` | Should be wired — see above |
| `chat_message_sent` | Not wired. Chat *starts* are counted, depth is not. |
| `categories_changed` | Not wired. |
| `listing_expired` | Deliberately skipped — a background sweep with no member action behind it. |

A contract that lists things the system does not do is a contract nobody can
trust. Either wire them or mark them as planned in the file itself.

---

## 🟡 4. Site search is now measured twice

The console guide said to leave Enhanced Measurement's **Site search** on until
the custom `search` event shipped. **It has shipped.** Both now fire on every
homepage search — `view_search_results` from Google's tag and `search` from
ours.

Two numbers for one thing, disagreeing at the edges forever. **Turn Site search
off now.**

---

## 🟡 5. The two counters will disagree, permanently, and that is correct

Today: **150 views, 3 unique people.** Some of that gap is the two tables
having different start dates, but the structural cause will persist:

- The first-party counter counts **bots** — it is a server-side hit counter and
  a crawler looks like a visitor.
- GA **filters known bots automatically**.

So GA will report fewer visitors than `visit_days`, forever, and neither is
wrong. Left unexplained this looks exactly like a broken integration. Worth
sampling `page_views` against GA once, understanding the ratio, and then
expecting it.

---

## 🟡 6. Nothing notices when collection stops

If the tag breaks, the salt is rotated, or `GA_VALIDATE_ONLY` is left set, the
numbers go quiet and nobody is told. `/api/health` reports configuration, not
flow.

The three custom insights in `06-operating-the-numbers.md` are the cheap
version of this and are not yet set.

---

## 🟢 7. `analytics/README.md` is now actively misleading

It still says the code is "imported by nothing", that `tsc` is clean "because
nothing in the app references it yet", that the migration is "not yet
numbered", that there are 75 checks (there are 77), and — under **The rule for
this folder** — that nothing is wired until someone applies `04-wiring.md`.

All of that was true when written and all of it is now false. A confident,
stale document is worse than no document.

---

## 🟢 8. Traffic from our own texts and emails is unattributable

SMS clients send no `Referer` header, and most email clients strip it. Every
visitor driven by our own messages lands as "direct" and is indistinguishable
from someone who heard about the service at an auction.

The only fix is UTM tags on the links we send. **Email is free to tag.** SMS
costs ~15 characters, and at a segment boundary that is real money on every
send — an operator decision, not a technical one.

---

## 🟢 9. Console leftovers

None urgent, all cheap:

- Key events unstarred (only `purchase`, by GA's default)
- Internal traffic filter still **Testing** — it collects nothing until Active
- `GA_DEBUG_MODE` may still be set in Vercel
- Search Console unlinked
- No second Administrator on the Analytics account
- The four explorations not built

---

## 🟢 10. Chat depth is invisible

`chat_start` is counted; `chat_message_sent` is not. So "do conversations
continue or die after one message" — a direct read on whether the website's
messaging is worth keeping — cannot be answered.
