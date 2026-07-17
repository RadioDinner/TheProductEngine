# FEATURES — the running feature list

Standing convention (user instruction, session 008): when the user adds a
feature to the feature list, append it here — keep the user's numbering, note
the session it arrived in, and track build status. This file is the list
itself; build details live in the session logs and HANDOFF.md.

| # | Feature | Added | Status |
|---|---------|-------|--------|
| 0 | **USER_ID** — a way of identifying people beyond phone/email: unique, random, 6-digit, never duplicated; ids freed by an account merge are not reused for a whole year | session 008 | **built** (migration 9986) |
| 1 | **Email-in extra ad pictures** — sellers email more pictures for an ad; the website listing shows them all; the email digest and SMS still carry only the one picture | session 008 | **built** (migration 9985) |
| 2 | **Profiles: confirmed buyer/seller ratings** — only confirmed parties can rate. `SOLD 1040` replies asking for the buyer's phone number; then invites `RATE 1–5`; the named buyer gets the same invitation to rate the seller | session 008 | **built** (migration 9984) |
| 3 | **Profile picture + pickup address** — settable by the member; the address is private to them, optionally shareable with a buyer they're in conversation with | session 008 | **built** (migration 9983) |
| 4 | **Chat** — on-platform messages between buyers and sellers, keyed on user ids, so nobody's phone number is exposed | session 008 | **built** (migration 9983) |
| 5 | **Digest numbers** — every digest carries a number, incrementing by 1 from 1; counter reset at build time | session 008 | **built** (migration 9982) |
| 6 | **Chat nudge cap** — no party gets a "message waiting" text more than once a day (item 4 shipped with a 3-hour dedup; tighten it to 24 h) | session 008 | **built** (no migration) |
| 7 | **Verified members** — a green check mark, granted and revoked manually by the operator as they verify real buyers/sellers; verified members get perks in the long run | session 008 | **built** (migration 9981) |
| 8 | **Admin "add a member"** — from /admin/users: a button that texts an invite ("to sign up, reply START", with opt-out + instructions), and the ability to set their starting credits right there | session 008 | **built** (no migration) |
| 9 | **Web ad posting** — LOGGED-IN members can post ads from the website; it spends credits exactly like texting one in (and says so clearly); the picture rules stay explicit: ONE picture rides the ad listing, any additional pictures are WEB ONLY | session 008 | **built** (no migration) |
| 10 | **Mixed SMS + chat messaging** — chat messages are copied to the recipient's SMS (a real copy of the message, not "you have a message waiting"); an SMS reply routes back into the chat thread on the site AND to the other party's SMS if they have one | session 008 | **on hold** (user decision: chat stays web-only with once-a-day nudges for now) |
| 11 | **Hide the SMS signup strip for signed-in members** — the "Get the ads by text — text SUBSCRIBE to (330) 960-7170…" compliance section is hidden (or made much less obvious) once someone is logged in | session 008 | **built** (no migration) |
| 12 | **Header messages icon + notifications** — signed-in members get a messages icon at the top of every page with a little red unread count (Joe replies → Jacob sees a red "1"), and an alert when a reply arrives | session 008 | **built** (no migration) |
| 13 | **Modern chat threads** — sent messages bubble from the right, received from the left; a "report this message" path for review; links can't be sent; and every message on the TPE exchange is audit logged | session 008 | **built** (migration 9980) |
| 14 | **Pictures in chat** — people in a conversation can send each other pictures; a picture NEVER rides the SMS copy (no MMS doubling) — the SMS side just gets "View image on the web" (or messages them directly) | session 008 | **built** (migration 9980) |
| 15 | **Messaging performance overhaul** — sending a message has a distinct lag; overhaul the whole messaging system's speed | session 008 | **built** (migration 9980 — send_chat RPC; multi-query fallback until pasted) |
| 16 | **Member ad management ("My ads" tab)** — signed-in members get a "My ads" tab in the header next to the messages icon / their member link; from it they can mark an ad sold, bump it, change the picture that rides `PIC`, add additional pictures, or delete it themselves. Delete refund rules (user decision): posted but not yet approved → refund the credit; approved but never sent in any digest → refund the credit; ever sent in a digest → no refund ("game over") | session 009 | **built** (no migration) |
| 17 | **Business advertising packages** — a website link titled "Advertising for Businesses"; businesses buy a package that runs their ad in a digest once a day: 1 week $39.99, 2 weeks $59.99, 1 month $89.99; same approval process as regular ads | session 009 | **built** (migration 9978) |
| 18 | **Town hall** — a main-website feature where (eventually) people add upcoming events, with the option to advertise the event via an SMS or email blast; pricing not settled — probably $19.99 per event listing; same approval process as regular ads; renders as a homepage sidebar on the RIGHT of the ads | session 009 | **built** (v1 board, no blast; migration 9977) |
| 19 | **"Featured" rotating sidebar spots** — LEFT of the homepage ads: two Featured slots stacked on top of each other, each rotating every 8 seconds through up to 3 ads (6 sellable spots total); operator posts them manually; they are image ads that may link to external websites | session 009 | **built** (posting + rotation; selling flow awaits pricing; migration 9977) |
| 20 | **Accessibility statement** — a footer page adapted from the user's template with truthful Plain Exchange specifics (WCAG 2.1 AA aim, partial compliance declared for member-submitted photos, SMS as the accessible alternative channel) | session 009 | **built** (no migration) |
| 21 | **Refund policy** — a footer page reflecting the system's actual refund rules: ordinary decline → auto refund; deleted before approval or before ever broadcasting → refund; ran in any digest → spent; violation → kept + strike; pack purchases discretionary per terms | session 009 | **built** (no migration) |
| 22 | **Category subscriptions** — SUBSCRIBE/START answers with a category menu (alphabetical, reformatted from the user's competitor example); subscribers text one category word per message to pick what ads they get; digests filter accordingly | session 009 | not started |
| 23 | **Metered click-to-reveal for phone numbers** (anti-scraping, user concern + decision session 009) — the website never renders seller numbers in HTML; a signed-in member clicks "Show number" per ad, metered ~10/day per account (admin-tunable, PIC-quota style), every reveal logged; excessive-reveal flags + one-click block in /admin/insights | session 009 | **built** (migration 9979) |
| 24 | **Category management + toggle replies + spam guard** (extends item 22, builds with it) — members manage their categories from the web (/account), kept in sync with SMS; texting a category name TOGGLES it with a confirmation ("You will now receive ads in the Horses category. To stop receiving them, reply Horses"); gibberish or endless category texts must not spike outbound SMS cost — throttled while legitimate use keeps working | session 009 | not started |
| 25 | **Homepage category browser** (extends item 22, builds with it) — a category picker on the homepage ad list so anyone browsing can filter the ads they see by category | session 009 | not started |

## Item notes (decisions made while building — flag anything to change)

- **0 · USER_ID**: 6 random digits, leading zeros allowed (stored as text,
  `000000`–`999999`). Existing accounts are backfilled by migration 9986; new
  accounts get an id at creation. A merge retires the losing account's id
  into `retired_user_ids` with a timestamp; generation refuses ids retired
  less than a year ago (older tombstones are reaped lazily).
- **1 · extra pictures**: emailed to the inbound address with the ad number
  in the subject (e.g. "Ad 1042" / "#1042"); images are byte-sniffed
  (jpg/png/gif/webp only) and re-hosted exactly like MMS photos. They attach
  to the ad **pending admin review** — the review happens on the ad's row in
  /admin/ads (approve or discard per picture). Only the sender address linked
  to the ad owner's account OR any address, admin decides at review time
  (v1: any address may submit, review is the gate). The digest/SMS/PIC photo
  stays position 0 only.
- **2 · ratings**: a short-lived SMS conversation context (24 h) drives the
  SOLD → buyer-phone → RATE flow; SKIP (or any other command) opts out
  gracefully. Both directions invited: the seller rates the buyer, the named
  buyer is texted an invitation to rate the seller. One rating per person per
  sale; 1–5 stars; averages show on the website ad page and /admin/users.
- **3 · profile**: set on the signed-in /account page. Profile picture is
  byte-sniffed + re-hosted (public); pickup address is stored private and
  only ever leaves via an explicit "share my pickup address" action inside a
  chat conversation (item 4).
- **4 · chat**: web-only v1 (flip-phone members keep using SMS/phone as
  today). "Message the seller" on an ad page opens a thread keyed on the two
  user ids; threads live under /account/messages; a deduped SMS nudge tells
  the other party they have a message waiting on the website.
- **5 · digest numbers**: the number is assigned when a digest composes
  (SMS edition; its email mirror shows the same number). Numbering starts at
  1 for the first digest composed after migration 9982 — past digests are not
  renumbered.
- **6 · chat nudge cap**: built with the item-10 decision — the dedup window
  in `nudgeBySms` (lib/account-actions.ts) went from 3 h to 24 h. No
  migration.
- **7 · verified members**: `users.verified_at` (migration 9981) doubles as
  flag + audit stamp. Grant/revoke lives on /admin/users ("Mark verified ✓")
  — no self-serve path anywhere, by design. Shown as a green ✓ on the ad
  page ("Verified seller"), the member's account page, and beside member
  numbers in chat. Perks are deliberately NOT implemented yet — the flag is
  the foundation; hang perks off `getVerifiedAt` when decided.
- **8 · admin add-a-member**: creates the account on the spot, optionally
  grants starting credits (ledger `grant` entry, note included), and texts a
  compliant invite (identifies us, "reply START", up-to-4/day + msg&data
  rates, HELP/STOP, the /sms link). Invite is deduped to one per number per
  24 h and refuses already-subscribed numbers; reply-class, so pause/
  blocklist/caps all apply. START then runs the normal subscribe flow
  (welcome + carrier opt-in confirmation).
- **9 · web ad posting**: reuse the SMS pricing path exactly (free pass →
  credits; starter grant on first post) so web and text ads cost the same.
  UI must say the price BEFORE posting. Picture rules on the form: one
  "listing picture" slot (= the paid MMS/digest picture, photo price) vs
  "extra pictures (web only)" — reusing the item-1 gallery. Ads still land
  in the review queue like everything else. **Length (user decision,
  session 008): web ads get the SAME character cap the SMS path enforces —
  the `maxChars` setting (default 300, tunable on /admin/settings) — with a
  live character counter and a reminder that the exact text rides the SMS
  digest, so keep it brief.** One number governs both lanes; the digest
  packer already fits ads that size cleanly, and the emoji/link content
  filter applies the same.
- **10 · mixed SMS+chat**: SUPERSEDES item 6's nudge-once-a-day — instead of
  a nudge, the recipient's SMS gets the actual message text, and their SMS
  reply routes back into the thread (and on to the other party's SMS).
  ⚠️ Resolve before building: every chat message becomes a billed SMS (the
  nudge was designed to cap exactly that), reply-routing needs a way to know
  WHICH thread an inbound text answers (most-recent-thread heuristic or a
  short reply code), and chat texts must respect STOP/pause/caps. Decide the
  cost posture with the user at build time.
- **11 · hide signup strip when signed in**: the strip is TCR-compliance
  surface for VISITORS; a signed-in member already opted in (or knows how).
  Keep it in the page for crawlers/compliance if needed — likely render only
  when there's no session, or collapse to one small line. Touches the shared
  layout/footer component.
- **12 · header messages icon + notifications**: unread count comes from
  `listChatsFor` (already computed); render an icon + red badge in the site
  header for signed-in members. "Alert on reply" v1 = the badge appearing on
  next page load; true live alerts would need polling or push — decide how
  fresh it must be at build time (a light poll of an unread-count endpoint
  every ~60 s is probably plenty for this audience).
- **13 · modern chat threads**: right/left bubbles need chat-specific CSS
  (today it reuses the dev-sim thread styles); "report this message" flags a
  message for the operator (needs a small table or a flag column + an admin
  review surface); link-blocking can reuse `hasLink` from
  lib/content-filter.ts (reject at send with a friendly note); audit-logging
  every chat message REVERSES a session-008 decision (chat messages
  deliberately stayed out of the admin message log) — when built, log them
  (probably into the existing messages table or an admin chat viewer) and
  note the privacy stance on /admin/help.
- **14 · pictures in chat**: web-side upload (byte-sniffed + re-hosted like
  every other image) and, once item 10's SMS reply-routing exists, an
  inbound MMS in a chat context lands the photo in the thread. The rule that
  keeps costs sane: **media never rides outbound SMS copies** — the SMS side
  of a picture message is text only ("[Name] sent a picture — view it at
  ThePlainExchange.com/account/messages"), so no MMS doubling, ever. Chat
  photos should count against a sensible per-thread cap and follow item
  13's report/audit rules.
- **15 · messaging performance overhaul** — where the send lag actually
  comes from (diagnosis, session 008): `sendChat` is a full server-action
  round trip with NO optimistic UI, and in prod each send strings together
  ~8 sequential Supabase queries (member lookup → chat row → insert →
  last_message_at update → read-watermark upsert → other-party phone) plus
  the nudge check (`countRecentOutboundContaining` runs an ILIKE scan over
  the messages table — likely the worst offender) BEFORE the redirect, then
  the thread page re-renders with another ~6 queries (membership, messages,
  and a full `listChatsFor` just for the header). Overhaul menu: make the
  page a client component with optimistic append; collapse the send path
  into one RPC (or parallelize + drop redundant lookups); take the nudge off
  the critical path (Vercel `waitUntil`); fetch a single-thread summary
  instead of `listChatsFor`; index or restructure the nudge-dedup check
  (e.g. a `last_nudged_at` column instead of scanning message bodies).
  Measure before/after with server timing logs.
- **16 · member ad management** (arrived session 009, user words recorded in
  the session prompt history): header tab "My ads" beside the messages icon /
  member link. Per-ad actions for the owner: mark sold, bump (exact SMS BUMP
  semantics — `bumpCost` charged when > 0, one queued per ad), change the
  `PIC` picture (position 0), add additional pictures (web-only extras →
  review-gated like item 1), delete. **Delete refund matrix (user decision,
  verbatim intent): pending (not yet approved) → refund; approved but never
  sent in ANY digest (`broadcast_at` null) → refund; ever sent in a digest →
  no refund, "game over."** Delete reuses the soft-delete machinery from
  migration 0013→9987 (status `deleted`, photos removed, queued bumps
  dropped) — member-initiated this time, with the refund matrix on top;
  refunds must be idempotent (ledger ref) and free-pass-paid ads refund the
  pass the way benign rejection does. Build decisions to flag to the user:
  (a) a REPLACEMENT position-0 picture goes through admin review before it
  swaps in (manual-review-everything ethos; otherwise a swap bypasses
  moderation); (b) web mark-sold offers an optional "buyer's phone" field so
  the item-2 sale/ratings flow still gets fed (skippable).
- **17 · business advertising** (arrived session 009): the site link reads
  "Advertising for Businesses" (the prompt-history original carries the
  user's spelling; the rendered link uses the corrected spelling). Recorded
  pricing: $39.99 / 1 week, $59.99 / 2 weeks, $89.99 / 1 month — the package
  runs the business's ad in a digest once a day for the duration.
  DECIDED (user, session 009 AskUserQuestion): (a) purchase flow = **Stripe
  self-serve now** — businesses pick a tier and pay via hosted Checkout; the
  ad still lands in the review queue before it ever runs; (b) digest
  placement = **labeled sponsor line** — rides as a clearly-labeled extra
  line (e.g. "Sponsor:") that does NOT consume one of the 10 member FIFO
  slots; (c) links = **allowed after review** — business ads may carry a
  link via the mayPostLinks() seam; manual review is the safety valve.
  Still to design at build time: scheduling machinery (daily re-broadcast
  for the package duration — likely a small migration for package/expiry
  tracking), breaker interaction (a guaranteed-daily sponsor line must not
  silently die when the segment budget trips — surface it to the operator),
  and margin check per tier against docs/profitability.md (a 1-week package
  ≈ 7 extra broadcasts of one sponsor line to the whole list).
  **Approval (user, session 009): business listings go through the SAME
  approval process as regular ads** — payment never skips the review queue.
- **22 · category subscriptions** (arrived session 009; the user pasted a
  competitor's menu and asked for better formatting, different examples,
  alphabetical order). DRAFT welcome menu (GSM-7-safe, pending user OK):
  "Welcome to The Plain Exchange! Pick what you want ads for - text one
  word per message: / ALL - every ad / BUGGIES - buggies & bikes / DOGS -
  dogs & puppies / GARDEN - lawn & garden / HORSES - horses & tack /
  HOUSEHOLD - household, furniture, realty / HUNTING - hunting, fishing,
  camping / LIVESTOCK - goats, ponies, small animals / MACHINERY -
  machinery & equipment / WANTED - wanted & everything else / Text HELP for
  help. Text STOP to end." Semantics: one word per text (per the user's
  example); multiple categories allowed; category words become first-class
  commands; existing subscribers grandfather to ALL. DECIDED (user, session
  009 AskUserQuestion): **menu draft approved as-is**; **delivery = ONE
  COMBINED digest per slot** containing only the subscriber's categories
  (never one text per category); **the operator assigns the category at
  review** (dropdown on the review queue; web posting may offer a seller
  picker the operator can override).
- **24 · category management + toggle + spam guard** (session 009, builds
  WITH item 22 as one lane): (a) **Web management**: a Categories section on
  /account with the ten checkboxes — same store as SMS, either side's change
  shows on the other; web saves confirm ON-PAGE only (no SMS sent for web
  changes — outbound texts cost money and the member is looking at the
  answer). (b) **Toggle semantics** (user's copy pattern): texting a
  category name flips it. ON: "You will now receive ads in the Horses
  category. To stop receiving them, reply Horses." OFF: "You will no longer
  receive Horses ads. To get them again, reply Horses." Default/grandfather
  = ALL; picking a specific category switches to selective; replying ALL
  returns to everything; removing the last category warns "you're not
  getting any ads now — reply ALL or a category name" instead of going
  silently dark. (c) **Spam/cost guard** (user: gibberish or "horses
  endlessly" must not spike usage): category confirmations ride the
  existing per-number reply reservation (reserve_sms, 9995) so the hourly
  cap is the hard backstop; ON TOP, a category-specific confirmation
  throttle — after N category toggles in an hour (default 5, tunable) the
  member gets ONE "changes still apply; text LIST to see your categories"
  notice and further confirmations go silent for the hour (state still
  toggles; costs nothing outbound). Gibberish keeps the existing
  unknown-command handling + its dedup; UNDER ATTACK mode already
  suppresses unknown replies entirely. Add a LIST command (free-form
  category status check, same throttle class).
- **25 · homepage category browser** (session 009, builds WITH 22/24): a
  row of category links above the homepage ad list (server-rendered filter
  via a query param, e.g. /?category=horses — works without JS, plays fine
  with the existing pagination and the 18/19 sidebars). "All" is the
  default; the active category is visibly marked; categories with zero
  current ads still render (grayed) so the taxonomy is learnable. Ad detail
  pages show their category as a link back to the filtered list.
- **23 · metered click-to-reveal** (session 009; the user spotted the risk:
  one burner-phone account could scrape every seller number off the site).
  Decided posture: numbers NEVER render in page HTML (list rows or detail);
  a per-ad "Show number" action reveals server-side for signed-in members,
  with a daily allowance + rolling bank exactly like PIC pulls
  (`pic-quota`-style pure math + atomic RPC; defaults ~10/day, admin-tunable
  on /admin/settings, 0 = off). Every reveal is recorded (account, ad,
  time) — /admin/insights gains an excessive-reveals flag (like
  picAbusePerDay) with the existing one-click block. Friendly out-of-reveals
  message, deduped. SMS digests unchanged (numbers are the product there;
  bulk-limited to the daily cap by nature). Needs a migration (reveal log
  table + RPC) — number assigned at build; also mask numbers inside ad BODY
  text on the web reveal path, not just the contact line (scrapers read
  bodies too; body PII masking exists for titles — extend it). Chat remains
  the no-number contact path. Build notes: needs a migration (subscriber
  category prefs + ads.category), commands.ts parsing, welcome rewrite in
  engine.ts, digest composer filtering + outbox interaction, admin review
  dropdown + web-posting field, /admin/help doc. The digest cost model
  changes with per-category filtering — fewer segments per subscriber on
  average (people get less), worth noting in profitability.
- **18 · Town hall** (arrived session 009): an events board on the main
  website — people post upcoming events; optionally pay to push the event as
  an SMS or email blast. Pricing NOT settled (user: "probably just $19.99 a
  listing for an event") — confirm before wiring Stripe amounts. **Approval
  (user decision): same review process as regular ads.** Design notes for
  build time: "eventually" signals phased delivery — v1 could be the events
  page + posting + review + display (no blast), blast as phase 2; an SMS
  blast to the whole list is the single most expensive action in the product
  (digest-scale cost for one event) — it must ride the outbox/segment-budget
  machinery, be labeled, and respect quiet hours/slots; events need a date
  field and should auto-expire after the event date; likely its own table +
  migration and its own review queue tab (or a type flag reusing the ads
  pipeline — decide against the ads-table-overload tradeoff at build).
  **Placement (user, session 009): Town hall renders as a homepage SIDEBAR
  on the RIGHT-hand side of the ads** (see item 19 for the matching left
  sidebar; homepage becomes featured-left / ads-center / town-hall-right,
  and both sidebars must collapse gracefully on narrow screens).
- **19 · Featured rotating sidebar** (arrived session 009, user words in
  prompt history): LEFT of the homepage ads, TWO Featured slots stacked
  vertically; each slot rotates every 8 seconds through up to 3 ads → 6
  sellable spots total. Operator-posted ONLY (manual, via admin — no
  self-serve); each spot is an IMAGE ad and may link to an EXTERNAL website
  (explicit exception to the no-links rule — acceptable because only the
  operator can post them; still re-host images like everything else, and
  use rel="sponsored noopener" on outbound links). Rotation is client-side
  (8 s timer — needs a small client component; pause rotation when the tab
  is hidden). Pricing for selling Featured slots: not stated yet — ask
  before wiring any checkout. Needs admin CRUD (image + link + slot + order
  + active toggle), likely one small migration for a featured_spots table.
  Mobile: sidebars stack (featured above / town hall below the ads, or
  collapse) — decide at build; never horizontal-scroll the homepage.
