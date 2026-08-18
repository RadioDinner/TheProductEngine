# Session 015 — 2026-08-17/18

Branch: `claude/admin-handbook-tooltips-q917kd` (the designated task branch;
NOT merged to main by me — no merge instruction this session).

## The ask

One prompt: "I want to make a comprehensive handbook for myself, as an
admin, based off the prompt history and context from prompts and things
from the past. I want to be able to 'Remember' how certain features that we
built work, and why they exist. Make this through tooltips and little '?'
boxes on the admin features."

## What shipped (FEATURES item 34)

- **`lib/admin-handbook.ts`** — the handbook itself: **80 entries in 13
  groups** (one group per admin page + a "How it all hangs together"
  concepts group). Every entry: title / what (how the control actually
  works, verified against the code) / why it exists (the user request,
  outage, abuse case, or decision that created it — cited by session
  number, with the user's own words quoted where they explain a why) /
  optional "watch out". Mined by reading the ENTIRE history corpus:
  all 14 `Session log/*/session_log.md`, key `prompt_history.txt` files
  (001 founding grilling, 009 feature blitz), FEATURES.md, and all of
  HANDOFF.md. Writing rules are codified in the module header: never
  invent history, never hardcode tunable numbers (say "set on Settings"),
  plain language for a non-programmer operator.
- **`components/HelpTip.tsx`** (client) — the little "?" button and the
  card it opens: a small centered overlay (not an anchored popover, so it
  can sit inside table cells/labels/headings without clipping), closes on
  Escape / backdrop / ×, restores focus, aria-expanded/dialog semantics.
  The card resets inherited text styling so a "?" inside an uppercase chip
  or a strong tag renders the same card.
- **`components/Tip.tsx`** (server) — `<Tip k="digests.sendEarly" />`;
  the key is TypeScript-checked (a typo fails `tsc`), and the lookup stays
  server-side so handbook text travels only in the admin-gated page
  payload, never a public JS chunk.
- **Placed across all 12 admin pages**: headings, section intros, field
  labels. Every numeric field on Settings carries its tip (the FIELDS
  array gained a typed `tip` key); Review/Ads got a one-line intro strip
  whose "?"s cover the per-row controls (badges, reject buttons, bump,
  delete) without repeating a button per row.
- **/admin/help grew "The handbook — every '?' in one place"** — the same
  80 entries grouped by page, read straight through, each linked section
  heading pointing at its admin page. (The existing long-form help prose is
  untouched; the handbook complements it.)
- **CSS** (globals.css): `.help-tip-btn` (ledger-blue circle), overlay/card
  in the paper-and-ink system (serif card title, red-barred "Watch out"),
  `.handbook-entry` for the read-through.
- **`test/admin-handbook.test.mjs`** (suite 524 → **532**): entry
  completeness (title/what/why present, card-sized titles), every key files
  under a known page group, the read-through covers every entry, every
  `<Tip k>` / `tip:` key placed in `app/admin/**` exists, and every admin
  page carries at least one tip.

## Content highlights (what the handbook remembers)

The origin stories now one click from the control they explain, e.g.:
bump cost's five-months-free-ad leak (session 005) · the PIC quota's
"3/day, bank 20" ask + abuse-suite proof (006) · sms-diag's birth in the
double-cause outage (007, missing 0011 + missing TELNYX_API_KEY) · the
reveal meter as the answer to the user's own scraping worry (009) · the
"horses endlessly" category throttle (009) · digests-stay + the
[7,12,16,20] zero-code offer (011) · Send early vs Send extra (007) ·
delete-vs-reject refund semantics (008) + the member "game over" matrix
(009) · the segment-budget breaker's rolling-window/0-means-paused
decisions (003) · the Vercel upload-corruption saga behind the sms-diag
self-test + checker (014) · migration discipline / drift / retry-swallow
as concepts entries.

## Verification

- `npm test` **532/532** (new admin-handbook suite 8/8).
- `tsc --noEmit` clean; `next build` clean.
- **19/19 Playwright walk checks** (repo shoot.tmp.mjs convention, deleted
  after): real login flow (dev code echo + set-password step), tips
  present on all 12 admin pages, card opens with why-it-exists + session
  citation, Escape closes, bump-cost tip tells the five-month story,
  handbook section renders all 80 entries, screenshots reviewed
  (review/settings/help/users).

## Process notes

- A 14-agent mining workflow was launched first but **failed on an
  environment bug**: the workflow runtime's permission handler stripped
  the parameters off EVERY subagent tool call ("The permission handler
  returned updatedInput for Read that failed schema validation … The tool
  input from the model was valid"), so no agent could read a single file.
  Recovered by mining the whole corpus directly in the main session
  (~4,000 lines) — which also kept the handbook voice uniform. If a future
  session sees workflow agents failing with all-tools-rejected, it's this
  harness bug, not the script.
- Session folder is `015_2026-08-17` (session started 2026-08-17, ran past
  midnight).

## Open questions / next step

- The tips deliberately do NOT cover non-admin surfaces (member-facing
  pages) — extend the same machinery there if ever wanted.
- Handbook maintenance: when a future session builds/changes an admin
  feature, add/update its entry in `lib/admin-handbook.ts` (the unit test
  will catch dangling keys). Suggest folding this into
  new_session_instructions if the user wants it as a standing order.
- Carried backlog unchanged (session 013/014): Stripe prod config is still
  the launch blocker; migrations 9974 + 9980 re-paste still on the user.
