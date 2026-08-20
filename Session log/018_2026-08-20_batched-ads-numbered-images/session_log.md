# Session 018 — batched ads, numbered pictures (2026-08-20)

Branch `claude/batched-ads-numbered-images-aupcvh`. **The user said explicitly:
"wait to commit to main until I tell you."** Everything is on the branch,
pushed, awaiting their word.

**Version 1.1.6 → 1.1.7** (§6: three features shipped — 45, 46 and 47 — so the
far-right digit moves; three or fewer keeps it on the third digit).

## What the user asked for

Their competitor sends a batch: one text listing four ads numbered 1-4, then
three separate picture messages, each picture stamped with the ad's number in
the batch. The user wants the same shape with two differences: **the ad NUMBER
instead of 1-4** (1022, 1023, 1024…), and **only the first picture goes out** —
`PIC 1024` pulls up to two more, the rest live on the website.

They also asked, mid-session:
- Can a balance be adjusted silently? (**It already can** — see below.)
- A "suggest a feature" form, and required name + contact on the problem report.

They also asked how the competitor fits ~700 characters in a text without it
becoming an MMS. **Answer: it isn't one message.** A long SMS is split by the
sender into 153-character segments carrying a reassembly header; the handset
glues them back together. The reader sees one message, the carrier bills six.
Nothing about LENGTH makes an SMS an MMS — only attaching media does. So the
batch ceiling here is a cost decision, set at 918 GSM-7 characters = exactly
six segments, which comfortably holds a 4-ad batch with header and footer.

## Feature 45 — batched ads with numbered pictures

Session 016 replaced batching with one-text-per-ad instant send. This restores
batching and keeps the good parts of instant send (the send window, paced
release, the outbox drain, category packing — all of it was per-EDITION rather
than per-schedule, so none of it had to change).

- **Triggers** (`batchReady`, pure + unit-tested): 3 ads waiting, or the oldest
  having waited 60 minutes — whichever first, both settings, both only inside
  the 7am-9pm Mon-Sat window. Either can be set to 0; **both** at 0 falls back
  to sending, because a paid ad must never be stranded by a typo in Settings.
  ONE batch per pass, so a backlog of thirty goes out as successive batches
  over successive cron ticks, never as one thirty-ad wall.
- **The text**: `The Plain Exchange No. 42 - Aug 20:` then `1022) …` per ad,
  blank lines between, and a standing footer (`Reply AD` / `PIC <id>` /
  `Reply STOP`) on EVERY batch — it used to ride only the day's first text,
  which was right when a text was one ad and is wrong now that a batch is a
  handful a day. The PIC example names an ad in that batch that actually HAS
  more pictures.
- **The pictures**: one message per picture ad, carrying the ad's FIRST
  picture with `AD 1024` burned into the bottom-right corner. Parts are
  ordered text-first, so the drain's columnar order means everyone reads the
  list before the photos land under it.
- **PIC changed meaning**: it now sends the two EXTRA pictures. An ad with one
  picture answers "that one went out with the ad" and spends NO pull.

### The badge (`lib/ad-badge.ts`) — read this before touching it

Every glyph is a hand-drawn vector PATH. Not a stylistic choice: sharp renders
SVG through librsvg, `<text>` needs a font fontconfig can find, and the
serverless runtime ships **no fonts**. A `<text>` badge renders blank or as
tofu THERE while looking perfect on any developer machine — a failure that
cannot be caught locally and would put unlabelled pictures in front of every
subscriber. Twelve glyphs (0-9, A, D) is all a badge needs. The unit suite
renders one for real and probes the pixels, so "the ink is actually there" is
a test, not a hope.

Pictures are also downscaled to 1200px/q80 on the way out (MMS deliverability;
carriers transcode or reject big attachments). Every failure degrades one step:
no badge → the clean original; no absolute URL → skip that picture and let the
ad's line advertise PIC.

### ⚠️ A LATENT PRODUCTION BUG, found and fixed

`digests` has no slot-key column: the identity was squeezed into
`scheduled_for` as `<day>T<hour>:00:00Z`. That works for a calendar key. It
does **not** work for session 016's per-ad key `ad#1022`, which became the
string `adT1022:00:00Z` — Postgres rejects it. **Every instant-send compose
threw in production** while working perfectly against the dev file store
(which keys on the raw string). It went unnoticed because ads are paused for
the pre-launch hold, so the queue is usually empty.

Fixed two ways: `digests.slot_key` (migration 9960) is now the identity, and
`slotIdentityTimestamp` maps ANY non-calendar key to a valid synthetic 1970
instant for the pre-paste fallback. The unit suite pins it as a regression.

### Cost, honestly

A picture message counts **3 segment-equivalents** against
`digestDailySegmentBudget` (roughly Telnyx's MMS-to-segment price ratio). The
budget rose 12,000 → 40,000 in the same breath: at the old ceiling the breaker
would have halted sending most days, which is a stopper rather than a safety
net. It is still a hard ceiling on a runaway. Worth watching once the list
grows — this is the number that decides what a busy day costs.

## Feature 46 — who filed it

Problem reports and the feature-suggestion form now require a first and last
name plus a phone OR an email (each optional alone, one of the two required —
the user's rule, in their words). Shared, pure, unit-tested rules in
`lib/contact-details.ts`; the phone parser forgives `(330) 555-0123`,
`330.555.0123` and a leading 1. A signed-in member gets the contact fields
prefilled — the help panel fetches them when it OPENS, not on every page
render, and fills only fields still empty so it cannot clobber typing.

The problem report's NOTE stays optional. That was the whole point of item 39
and it is still true. What changed is the reply path.

"Suggest an idea" (item 27) is renamed **Suggest a feature** — the footer
button, the page heading, the metadata. Same `?type=idea` URL, so old links
and the analytics key still work. Note it applies the new rules to the
question tab too: one form, one rule.

## The balance question — it was already silent

The user asked whether adjusting a balance from the admin end texts the member.
**It does not, and never did.** `adminGrantCredits` writes a ledger row and
nothing else; `addLedgerEntry` has no outbound path at all. Billing a saved
card and keying a card into checkout are silent too. The only things on
/admin/users that message anyone are "Text them the link" (a checkout link,
which is the point) and Add a member (the invite). Most likely they remembered
adding a member WITH starting credit, which does text.

Rather than build something that exists, the page and the handbook now SAY it,
so the question doesn't need asking again.

## Feature 47 — a member's name, learned from a form

The user, after 46 shipped: "if they ever fill out a 'submit an idea' or 'I
need help' form, save their names to their user account." Both forms now do.
The account gains `first_name`/`last_name` (migration 9958) and the panel and
the contact page prefill them next time, so nobody is asked twice.

**Fill-only, and the rule is deliberate.** A signed-in session always wins.
Failing that the typed phone is used — but only ever to fill a BLANK name,
never to replace one, and a form never creates an account. Both forms are open
to anyone, so a typed number is a claim about identity rather than proof of
it: first-writer-wins means the worst case is a wrong name on a record instead
of somebody relabelling a stranger's account, and it keeps an operator's
correction from being undone by the next form that household fills in. The
`is null` guards live in the UPDATE itself, so two submissions at once cannot
race into a half-written name.

The columns are read LAZILY, never through `USER_SELECT` — the same rule
`auto_topup` follows. An account lookup is on the critical path of nearly
every page, and a core select naming a column that a pending migration has not
created yet is how a whole site 500s.

## ⚠️ Three migrations to paste

0. `supabase/migrations/9958_member_names.sql` — `users.first_name/last_name`.
1. `supabase/migrations/9960_batched_ads.sql` — `digests.slot_key`, the two
   batch settings, `photos_in_broadcast` → true, and the budget raise (a
   CONDITIONAL update, so re-pasting can never undo the operator's own tuning).
2. `supabase/migrations/9959_help_report_contact.sql` — the four contact
   columns on `help_reports`.

All three degrade safely until pasted; `/api/health` probes `migration9960`,
`migration9959` and `migration9958`.

## Directional decisions

1. **Ad numbers, not positions.** "1022)" is the number the badge shows, PIC
   takes, SOLD takes, and the website uses. The competitor's 1-4 means nothing
   an hour later.
2. **One picture per ad on the broadcast.** The premium product gets seen; a
   three-picture ad still costs one MMS per subscriber, not three.
3. **The standing footer rides every batch.** Cheap at a few batches a day,
   and the right posture for a bulk program.
4. **The batch key is the head of the queue** (`batch#<first new ad>#<first
   bump>`). Stable enough that two overlapping cron ticks compose the same key
   (no double send), unique enough that an admin re-run gets its own.
5. **Paced release is now largely dormant** — it paces DIGESTS, and batching
   means there is rarely more than one undelivered. Batching is the burst
   control now. Left in place; nothing to change.

## Open / next

- **Paste both migrations**, then watch the first real batch.
- The 10DLC campaign description still says "up to 4 digests/day" (carried
  since session 016). Batching makes that closer to true than instant send did,
  but the filing is still the operator's to update. The Telnyx HELP
  auto-response still advertises BUMP and CREDITS (session 017 item, open).
- Consider queueing feature suggestions like help reports — today they email
  only. "Five people asked for X" is worth being able to see.
- The analytics `listingBroadcast` event reports per-EDITION segments, which
  now include picture cost. Fine, but the number changed meaning; worth a note
  if anyone charts it across the session-018 boundary.

## Verified

tsc clean · build clean · unit **1033 → 1153** (new suites `batch` 82,
`contact-details` 38) · abuse suite unchanged (the two 🔴 are the
pre-existing annotated notes, not regressions).
