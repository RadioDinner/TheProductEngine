# Session 021 — 2026-08-21

Branch `claude/twilio-error-18602-4f4tnj`. Ran **in parallel with session 022**,
which is most of what this session ended up being about by the end.

## What shipped

| Commit | Summary |
|---|---|
| `e7588aa` | The call line never dials the operator's cell again |
| `814d52e` | Test mode: send real ads to test numbers and nobody else |
| `39f6c30` | Merge of `origin/main` (session 022) — one doc conflict, both sides kept |
| `24a5a5e` | Standing protocol for parallel sessions, and a migration collision check |
| `ab7b8e4` | Split HANDOFF: live state stays, the narrative moves to an archive |

Version **1.4.9 → 1.4.11** (§6). Session 022 moved it to 1.4.10 in parallel;
this session took the far-right digit once more from where that landed. Unit
tests **1464 → 1533** (new suites `test-mode` 43, `category-delivery` 26).

## 1. The call line stopped dialing the cell

The user asked where calls get forwarded to their phone, assuming it was a
Twilio setting. It was not: Telnyx forwards the public number to Twilio, Twilio
holds only a webhook, and **the app decided** — `VOICE_RING_FIRST` /
`VOICE_RING_TO` / `VOICE_RING_SECONDS`, read in `lib/voice.ts`.

Session 020 had already made the menu answer first but kept the ring-first path
behind a flag. The cell was still ringing, so the flag was set in production.
The user said "change the code", and the decision was to **delete rather than
default off**: "off by default" and "cannot happen" are different guarantees,
and only the second was asked for. Seven functions, three route stages and
three env vars are gone; `voice.test.mjs` asserts all seven names are absent
from the module and that no TwiML stage emits `<Dial`.

Also changed: an unknown `?step=` now serves the menu instead of hanging up, so
a call already ringing a cell when the deploy landed reaches the card line
rather than an apology.

## 2. Test mode

**The design rule, and the thing worth carrying: test mode narrows the
AUDIENCE and changes nothing else.** An ad posted while it is on is a real ad —
real number, price, review queue, batching, category partitioning, segment
accounting. Only the recipient list is cut down. A faked pipeline proves
nothing about the real one.

Two decisions that fell out of that, both applications of the same idea:

- **Enforced in the store layer** (`listSubscribersWithCategories`), not at the
  four call sites that ask who receives a digest. The fifth call site somebody
  adds next year is exactly the one that would leak a test send to the whole
  list. `createAd` marks test ads in the dispatcher for the same reason.
- **The narrowing filters the real list and never invents a recipient**, so a
  test number only receives ads if it is a genuine subscriber — with its own
  category prefs, opt-out state and block status. Synthesizing a recipient
  would bypass exactly the plumbing a test exists to exercise.

**It expires itself after 4 hours**, and that is the load-bearing property, not
a convenience: test mode left on is worse than an outage, because ads keep
flowing, every screen reads healthy, and the whole list silently receives
nothing. A corrupted or absent deadline reads as EXPIRED; on-with-no-valid-
numbers reads as INERT rather than as a service-wide blackout.

Test ads carry **two** flags: `webListing:false` (an already-migrated filter,
so hiding works with no migration pasted) actually hides them, and `is_test`
(migration 9951) is only the label for cleanup.

## 3. Category testing

The user said "we've never done any category testing." Half true. The unit
coverage was already good — 91 checks over the pure decisions. What did not
exist was **who receives which ad**. `test/category-delivery.test.mjs` (26
checks) covers it against the real composer, which is pure so no database is
needed. Verified non-vacuous by breaking `adMatchesCategories`: 11 checks
failed, then restored.

Their reported review-vs-welcome category mismatch **was not real** — both
surfaces read the same `CATEGORIES` constant. Rendering the two lists side by
side was what settled it; they confirmed "I was wrong."

## 4. The parallel-session collision, and the protocol

Sessions 021 and 022 collided. **Both independently claimed
`Session log/021_2026-08-21b`** (022 renamed itself), both rewrote the top of
`HANDOFF.md`, and a stale local `main` — 80 commits of unrelated history from
before a force-push — meant `git checkout main` silently restored a months-old
working tree mid-merge.

**The insight: git does not protect you here.** Merge conflicts are the SAFE
failure — loud, and they get fixed. The dangerous collisions merge cleanly. Two
sessions taking the same descending migration number produce two
differently-named files, git merges both without a word, and because migrations
are pasted by hand nobody can tell there were two. The second never runs.

- `new_session_instructions.md` **§8** is the standing protocol.
- `CLAUDE.md` gained **rule 0** (fetch first) so it is picked up at load.
- **`npm run check:migrations`** is the tooling, chosen because it is the one
  collision that is a data bug rather than a conflict.

Session 022 handled its side well — it left *"keep both"* in the conflict zone,
which made the resolution trivial hours later. That is now the documented
practice.

## 5. HANDOFF split

`HANDOFF.md` was 2,548 lines and the hottest file in the repo — 8 of 12
consecutive commits touched it, and it was the ONLY conflict in the 021/022
merge. Split into live state (~237 lines) and `HANDOFF-ARCHIVE.md` (the
session-by-session narrative, verbatim). Verified by check: all 76 original
headings survive, and the only substantive lines that changed are the stamp and
the one warning deliberately promoted into Open items.

## Directional decisions

- **Delete, don't default-off**, when the user asks for a behaviour to stop.
- **Enforce at the choke point, not the call sites** — used twice here.
- **A safety switch that can be left on must expire itself.**
- **Keep both sides** of a HANDOFF conflict, always.
- Offered and **declined for now**: slug-based session folders instead of the
  `NNN_` counter.

## Twilio 18602 — closed

Open at session start (it named the branch), **verified by session end**. The
user resolved the EIN question themselves. No code involved. What the error
means is recorded in `HANDOFF.md` under Provisioning.

## Next session

- The **10DLC campaign description at Telnyx** is still wrong (7am–9pm, "up to
  4 digests a day"). Carried across three sessions now; no code reaches it.
- **Unused balances** is still undecided and shapes a published policy page.
- Test mode is built but **never exercised on a real phone** — the user needs
  to set test numbers and text SUBSCRIBE from both.
- Open items 1–5 in `HANDOFF.md`.
