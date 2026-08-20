# Session 017 — 2026-08-20 — Google Analytics, end to end

## What shipped

A complete measurement system for a business where **most of the activity never
touches a web browser**. That constraint shaped every decision in it.

`analytics/` — eight documents, ten code modules, a migration, and 85 tests.
All on `main`. `analytics/README.md` is the way in; `analytics/00-todo.md` is
the live tracker; `analytics/07-audit.md` is the review and what it found.

### Commits (in order)

| Hash | What |
| --- | --- |
| `d2b9167` | The `analytics/` folder — one home for how we measure the site |
| `2c32247` | The staged GA4 library: config, catalogue, salted ids, MP sender |
| `16d36b1` | The six documents |
| `d1f0ba8` | Merge the folder to `main` |
| `11c95de` | Wave 1 — the money path and the SMS command surface |
| `52603c8` | The browser tag AND the rewritten privacy policy, one commit |
| `e9f0845` | HELP: stop replying — the carrier already answers it |
| — | Waves 1b–6: engine outcomes, lifecycle, web surface, voice, user properties, migration 9961 |
| `664a9ae` | Session close-out, version 1.1.6 |
| `52a1e91` | Merge the audit fixes — three defects |

### Git posture

The instructions changed three times. Commit a folder to `main` first, then the
branch; then stay inside that folder because several sessions were running;
then commit what existed and hold `main`; then resume. All followed.

**That constraint turned out to be the reason every merge was conflict-free.**
Confining a large piece of work to one new folder while other sessions moved
`app/`, `lib/` and `supabase/` meant zero overlapping paths, twice.

## Directional decisions

1. **A classified ad is a "listing" in GA.** GA4 reserves `ad_click`,
   `ad_impression`, `ad_exposure` and `ad_query` and discards events using them
   behind a `204`. This product's most important events would have vanished
   with nothing to search for. Enforced by a test.

2. **Server-side first, browser tag second.** Most members never load a page.
   The Measurement Protocol path covers everyone and needs no consent decision.
   This inverts the usual order and is right for this audience.

3. **Members are a salted SHA-256, never the phone.** Off-web events derive
   their `client_id` from that hash rather than a random one — a random id per
   text would turn one seller into hundreds of one-event users.

4. **GA is the behavioural layer; Supabase stays the record.** When they
   disagree, Supabase is right.

5. **Privacy option B**, chosen by the user: browser tag plus a rewritten
   policy, shipped in the SAME commit so the page was never live promising
   something the site contradicted.

6. **HELP is answered by the carrier now, not by us** (user decision) — it was
   double-replying, and the carrier copy was stale.

7. **The internal-traffic IP filter was DECLINED** (user decision). The
   code-level admin exclusion is sturdier; an IP filter fails silently when a
   home connection changes address.

## What the audit found, and why it matters

Three defects, and the ranking is the lesson.

**Twelve events were on the lossy path.** `after.ts` takes Next's `after()` by
injection, and the injection was registered only in the four API routes. Server
actions never load those, so events fell back to unawaited fire-and-forget.

**Web ad posting emitted nothing.** `post_submit` fired only from the SMS
engine, so every ad carried `channel: "sms"`. The report would have read **100%
SMS with total confidence.**

That is the sentence worth carrying forward: **a missing number gets
investigated; a confident wrong one gets acted on.** Both defects produced
plausible output and no error. Neither would have been caught by a test that
only checked what the code does — they were caught by asking what the numbers
would have to be if the code were right.

The guard added afterwards reflects that: a unit test cannot catch "a file
forgot an import", so the suite now reads `lib/*.ts` **statically** and fails
if an emitting file lacks the registration. Verified to bite by removing one.

**And the user found one I missed.** Page views were double-counted — Enhanced
Measurement's history-based page views firing on top of ours. They found it by
walking four pages in an incognito window and counting: 4 pages, 12 views. I had
told them to leave Enhanced Measurement's page views alone without checking the
sub-option. The habit that caught it — check a number by hand — is now the
quarterly reminder in `06-operating-the-numbers.md`.

## Open for the next session

Nothing required. `analytics/00-todo.md` has the optional list: key events to
star as they appear, `chat_message_sent`, the four explorations, the three
alerts, Search Console, UTM tags on email links.

**Two things to verify once the reports catch up:** page views should be
roughly half (proving the double-count fix stuck), and `post_submit` should
show both `sms` and `web` after an ad is posted from the website.

⚠️ **Carried, and the operator's:** the Telnyx HELP auto-response is now the
service's only answer to HELP and still advertises BUMP and CREDITS; the 10DLC
campaign description still says "up to 4 digests/day".

## Version

**Left at 1.1.7.** This session moved it to 1.1.6 for the analytics work;
session 018 then took it to 1.1.7. Everything after that merge was FIXES, and
§6 says fixes do not bump.

## Worth knowing

- **The Measurement Protocol returns `204` for payloads it throws away.** Wrong
  event name, missing `client_id`, a 26th parameter — all `204`. Build every
  new event against the debug endpoint first.
- **Registering a GA custom dimension is not retroactive**, and the Scope
  dropdown does not reset between saves. Ten got created as Item scope, which
  is GA4's tightest bucket at 10, and blocked further work.
- **Firebase auto-creates GA4 properties** and one of them loads by default —
  every setting is per-property.
- **The container's clone was shallow**, which faked unrelated histories.
  `git fetch --unshallow`.
