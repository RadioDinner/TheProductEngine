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
| 22 | **Category subscriptions** — SUBSCRIBE/START answers with a category menu (alphabetical, reformatted from the user's competitor example); subscribers text one category word per message to pick what ads they get; digests filter accordingly | session 009 | **built** (migration 9976) |
| 23 | **Metered click-to-reveal for phone numbers** (anti-scraping, user concern + decision session 009) — the website never renders seller numbers in HTML; a signed-in member clicks "Show number" per ad, metered ~10/day per account (admin-tunable, PIC-quota style), every reveal logged; excessive-reveal flags + one-click block in /admin/insights | session 009 | **built** (migration 9979) |
| 24 | **Category management + toggle replies + spam guard** (extends item 22, builds with it) — members manage their categories from the web (/account), kept in sync with SMS; texting a category name TOGGLES it with a confirmation ("You will now receive ads in the Horses category. To stop receiving them, reply Horses"); gibberish or endless category texts must not spike outbound SMS cost — throttled while legitimate use keeps working | session 009 | **built** (migration 9976) |
| 25 | **Homepage category browser** (extends item 22, builds with it) — a category picker on the homepage ad list so anyone browsing can filter the ads they see by category | session 009 | **built** (migration 9976) |
| 26 | **Location-specific areas under the one brand** — "The Plain Exchange" stays the WHOLE brand; it gains location-specific AREAS (Holmes County first) that people browse and pick from the website. Immediate slice: make the area a visible, first-class concept — site/digest/welcome copy names it, and a web area picker lets people choose. Bones exist: `county` columns default `'holmes'` since init. The unified-brand decision, the multi-area rollout, per-area WhatsApp, and the Amish/Mennonite-only marketplace North Star all live in `LONG_TERM_VISION.md` | session 011 | **backend built, selector HIDDEN** (`lib/areas.ts` registry + `components/LocationSelector.tsx`, gated by `AREAS_SELECTOR_ENABLED=false`; area not yet surfaced in copy) |
| 27 | **"Ask a question" / "Suggest an idea" buttons** — clear buttons somewhere convenient that email the operator, including the sender's contact info, so they can follow up | session 011 | **built** (no migration) |
| 28 | **"NEW AD" leniency** — accept the reversed word order (and run-together "NEWAD") as "AD NEW", so flip-phone typers who send "NEW AD …" get their ad posted instead of a "did you mean to post an ad?" reply | session 011 | **built** (no migration) |
| 29 | **Phone-order card checkout + saved-card billing** — on a member's /admin/users page: shows whether a card is on file; **Bill their saved card** charges it on a verbal OK (BUYCREDIT pricing + discount, double-click-safe); no card yet → open the Stripe checkout in the operator's browser (key the card in while the caller reads it out) or text the member the checkout link; paying grants the credits and saves the card for BUYCREDIT texts | session 011 | **built** (no migration) |
| 30 | **Homepage promo banner** — an operator-set banner at the top of the homepage for running credit sales; text + link live on /admin/settings (clear the text to hide it; link must be a page on this site, falls back to the credits section) | session 011 | **built** (no migration — new config keys fall back to defaults) |
| 31 | **Pay-by-phone card capture** (Twilio `<Pay>` IVR → Stripe card on file) — callers key their OWN card into the phone keypad on a dedicated voice number; Twilio's Stripe Pay Connector tokenizes it (digits never touch the operator, this server, or a log) and it's saved to a Stripe customer; a bearer-authed `POST /charge` bills it off-session per order. The PCI-safe replacement for item 29's operator-keys-the-card call-in flow | session 012 | **LIVE IN PRODUCTION (session 016)** — end-to-end verified on a real call: the whole call now runs at `/api/voice` (`lib/voice.ts`) — the auto-attendant answers on the FIRST RING and nothing dials the operator's cells (session 021 — the ring/whisper path and `VOICE_RING_*` are deleted, not just switched off; 1 = save a card, 2 = voicemail texted to `ADMIN_PHONES` and emailed to `ADMIN_EMAIL` with the audio attached), `<Pay>` tokenizes, and the card is stamped onto the member's account instantly; confirmations go out over the registered Telnyx line. One Stripe account by construction. `pay-by-phone/` is now reference-only. Ops: PCI Mode + Pay Connector + webhook URL + `TWILIO_AUTH_TOKEN` — see `docs/call-in-card-line.md`. NOTE: the Pay Connector's OAuth would not attach to the existing Stripe account (it only ever created new ones), so the app was MOVED to the connector's account `acct_1U6DyY3cJ9GPOvgC` — one Stripe account is a hard requirement, a card saved in one cannot be charged from another |
| 32 | **Multi-picture combine** — a seller who texts several pictures (in one MMS or trickled across messages) gets them automatically combined into a SINGLE collage image that rides the ad (up to 4 pictures; the user's session-011 idea). The ad still carries exactly one photo on the SMS side, so MMS/PIC/digest costs and the one-picture-ad price are untouched; **the website shows the full individual pictures instead of the collage** (session-014 user decision) | session 011 (idea) / session 013 (build) / session 014 (scrapbook style + web-shows-originals) | **built** (no migration — see note) |
| 33 | **Picture-set coaching + combined-photo confirmation** — an AD NEW with a picture now replies "send more pictures one at a time, up to 4 total; quiet for 10 minutes = the set is complete", and once a combined ad's pictures HAVE been quiet for 10 minutes the seller is texted the finished collage (MMS), so they see exactly the one photo buyers will get; a later picture re-arms one fresh confirmation | session 014 | **built** (⚠️ migration 9974 — until pasted the confirmation texts are silently off; the reply coaching works regardless) |
| 34 | **Admin handbook tooltips** — a comprehensive operator handbook mined from the prompt history and session logs, delivered as little "?" boxes beside the admin features: each tip says what the control does, WHY it exists (the request/outage/decision that created it, cited by session number), and what to watch out for; the whole handbook also reads straight through at the bottom of /admin/help | session 015 | **built** (no migration) |
| 35 | **Dollar pricing overhaul** — the credit system is replaced by dollar-denominated ad credit after a competitor-pricing review (their sheet: $65 with up to 4 pictures / $45 text-only, print). User decisions: **$45 text / $60 picture**; **+$15 website-listing add-on, FREE at launch** (machinery built, `web_addon_cents` = 0); **$150 starter credit** on every new member's first post (replaces the 3 free passes); **auto top-up** from the saved card at posting time (replaces BUYCREDIT/YES + the saved-card discount) plus check/phone via admin grants; **BUMP removed completely** ("completely gone, from everywhere, including the FAQ" — the admin re-run tool stays); **business packages repriced $199/$349/$599** (every tier must cost more than one ad). Full sheet + rationale: `docs/pricing.md` | session 016 | **built** (⚠️ migration 9973 — until pasted: prices are correct from code defaults, auto top-up stays OFF fail-closed, but legacy balances display 100× low; paste before launch) |
| 36 | **Insights: manual adjustment + split sender rows** — the operator can correct an Insights figure by hand when it is wrong (money spent, ads served, and people-who-texted are all skewed by pre-launch testing). Also split the sender count into TWO rows: unique people who have texted, and total inbound texts | session 016 | **built** (labels split; correcting the numbers is done by PURGING the rows — see 37/38) |
| 37 | **Insights: reset the Ads rows** — clear/rebase the all-time ad funnel counts (waiting / live / sold / expired / rejected), which testing threw off | session 016 | **built** as the purge tool (⚠️ migration 9966) |
| 38 | **Insights: reset + recalculate on EVERY row** — a reset control on each row, and a recalculate that reflows any total the reset affects (resetting one number may change another's total) | session 016 | **built** as the purge tool — every figure is derived, so removing the rows recalculates all of them at once (⚠️ migration 9966) |
| 39 | **"I need help!" button on nearly every page** — one click files a report carrying every diagnostic we can capture: who they are, whether they have an email, what page they clicked from, date and time, and whatever else is available — so problems can be fixed proactively instead of waiting to be told. Extends item 27 (Ask a question / Suggest an idea), which already emails the operator with contact info | session 016 | **built** (⚠️ migration 9965 — until pasted the button still works and still emails, it just isn't queued) |
| 40 | **Version number in the website footer** — starting at **1.0.3**. The bump rule is now §6 of `new_session_instructions.md`: 3 or fewer features shipped → far-right digit; 4 or more (or a major change) → second digit; the first digit only ever moves when the user says so | session 016 | **built** (no migration — one constant in lib/config.ts, read by the footer and /api/health) |
| 41 | **Users tab: a database-table view** — a spreadsheet-style grid of every member on /admin/users: number, email, status, ads sent, money spent, subscription start date, and as much else as we hold. Filter by column, drop and add columns, and SAVE named views of the data | session 016 | **built** (⚠️ migration 9962 — one database view + saved views table) |
| 42 | **Announce-or-silent pause** — when turning a pause ON, choose whether subscribers are told. Silent is the default; the broadcast is opt-in | session 016 | **built** (no migration) |
| 43 | **Paced release** — when more than N ads are waiting, spread them out with a RANDOM gap (12–18 min default) instead of firing the whole backlog at once; threshold and gap range are settings | session 016 | **built** (⚠️ migration 9963) |
| 44 | **Archive + restore a member** — the reversible counterpart to delete: set someone aside (off the website, out of the lists, no ads going out) without destroying anything, and put them back exactly as they were | session 016 | **built** (⚠️ migration 9964) |
| 45 | **Batched ads with numbered pictures** — ads go out in BATCHES again (a competitor's shape, the user's numbering): ONE text listing several ads, each headed by its AD NUMBER (1022, not 1), then ONE picture message per picture ad with the ad number burned into the picture's bottom-right corner. Only the first picture ever goes out; `PIC 1024` pulls up to two more; the rest live on the website. The batch fires as soon as 3 ads are waiting or the oldest has waited an hour, whichever comes first (both settings) | session 018 | **built** (⚠️ migration 9960) |
| 46 | **Required contact on the feedback forms** — the problem report ("I need help!") and the feature-suggestion form both require a first and last name plus a phone OR an email (each optional on its own, one of the two required); a signed-in member gets the contact fields filled in automatically. The suggestion form is the renamed "Suggest an idea" (item 27) | session 018 | **built** (⚠️ migration 9959) |
| 47 | **Learn a member's name from a form** — filling in either feedback form saves the name onto that member's account, so the operator sees a person instead of ten digits and the forms stop asking twice. Fill-only: a name already on an account is never overwritten, and a form never creates one | session 018 | **built** (⚠️ migration 9958) |

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
- **26 · Location-specific areas under the one brand** (arrived session
  011, user words in prompt history): "I want to make my exchange location
  specific. I want a Holmes county location," refined the same session to
  "I want to KEEP 'The Plain Exchange' brand. I want that to be the whole
  brand, with separate areas that people can browse from the web page."
  So: ONE brand (The Plain Exchange), location-specific AREAS inside it,
  browsable from the website — Holmes County is the first area, not a
  rebrand. Scope for the immediate item: surface the area identity
  (Holmes County) across the product + a web area picker. The rest of the
  direction (Lancaster PA, northern Indiana, Harrisonburg VA, Big Valley
  PA, all plain communities; request-a-new-area; per-area WhatsApp chat via
  Telnyx's WhatsApp Business API; and the Amish/Mennonite-only "facebook +
  sms + craigslist" marketplace North Star) is deliberately parked in
  `LONG_TERM_VISION.md` per the user's instruction that long-term items be
  tracked separately from this list. Build notes: the `county` column
  (default 'holmes') already exists on the core tables and digest
  idempotency is already keyed `(channel, county, scheduled_for)` — v1 of
  this item is mostly naming/copy + making the area a visible, browsable
  product concept, NOT multi-tenant plumbing; don't build area switching
  until an actual second area is greenlit.
- **31 · pay-by-phone card capture** (arrived session 012 — user uploaded
  `plainexchangepaybyphone.zip`; added **as-is**, unmodified). A standalone
  Node/Express service under `pay-by-phone/`: `POST /voice` reads a
  stored-credential consent script then runs TwiML `<Pay>` in tokenize-only
  mode (`chargeAmount "0"`, `tokenType "payment-method"`) so the caller keys
  card/expiry/CVC/ZIP on the keypad and the digits go carrier → Twilio →
  Stripe, never to this app; `POST /pay-result` attaches the returned `pm_…`
  to a Stripe customer keyed by caller phone, sets it default, stamps
  `card_consent_at`, texts a confirmation; `POST /charge` (bearer
  `INTERNAL_API_KEY`) makes an off-session PaymentIntent against the saved
  card. **Kept separate on purpose:** Twilio **PCI Mode is irreversible and
  redacts logs account-wide**, so it wants its own Twilio account/subaccount,
  and the main app is on **Telnyx** (no shared number to fold into). Build
  guards: `.vercelignore` excludes it from the Next deploy; its `package.json`
  is not a workspace (root install ignores it); `tsconfig` globs only
  `**/*.ts(x)` so `server.js` isn't typechecked.
  **NOT wired to member accounts yet (deferred — needs a user decision + it
  touches prod):** as written it's an island. It finds Stripe customers by
  `customers.search` on `metadata['phone']`; the app charges saved cards via
  the account's stored `stripeCustomerId` (`chargeSavedCard` → item 29 "Bill
  their saved card"). So an IVR-saved card is not chargeable from
  `/admin/users` or by BUYCREDIT until (1) the service and app share **one
  Stripe account/key**, and (2) a small bridge stamps the IVR customer onto
  the member's `stripeCustomerId` — the recommended options: have
  `/pay-result` POST `{phone, customerId}` to a new authed main-app endpoint
  that sets `account.stripeCustomerId`, OR add a phone-search fallback to the
  app's `firstSavedCard` when the account has no stored customer id. Confirm
  phone formats line up (app `normalizePhone` vs Twilio `From`/`Caller`, both
  E.164). Pre-reliance punch list is the README's own hardening checklist
  (enforce prod webhook signatures, own phone→customer table, log
  `PayErrorCode`, optional PIN for shared shanty numbers).
- **32 · Multi-picture combine** (idea arrived session 011 — "combine 4
  incoming pictures into a single image before sending them out … only up to
  4"; built session 013 after the user texted several pictures and nothing
  combined). No AI service needed — `sharp` (the standard Node image library,
  now a dependency) composes the collage in-process at ingest. How it works:
  - **One MMS with 2–4 pictures:** each attachment is byte-validated and
    re-hosted individually (`parts/` storage folder, website gallery
    positions 1+), then composed into one collage JPEG (`collage/` folder,
    position 0 — the picture MMS/PIC/digests carry). **Layout by count**
    (session-014 rework + user decision): 2–3 pictures = scrapbook style,
    modeled on the user's competitor examples — NEVER cropped, each keeps
    its full frame and native shape, scaled to fit a corner-anchored
    region of a portrait 4:5 (1200×1500) white page, staggered so typical
    photos overlap slightly (later pictures on top) with white showing
    through; 4 pictures = a clean 2×2 grid, cells filled edge-to-edge
    (cover-cropped — that's what makes it a grid) with thin white
    gutters. EXIF orientation honored; baseline
    JPEG (safe for old handsets + carrier size limits). Attachments past 4
    are dropped and the confirmation says so.
  - **Pictures trickled across messages:** a photo-only MMS from a sender
    with a PENDING ad less than 24 h old attaches to that ad — the collage is
    rebuilt with the new picture(s) up to the cap of 4. Approved ads never
    change silently (pending only). A photo-only message with no such ad
    still gets the how-to-post guidance, and strangers still mint no account.
  - **Pricing is unchanged and fair:** the combined ad is ONE picture ad
    (costPhoto). A follow-up photo landing on a TEXT ad upgrades it and
    charges exactly the difference (costPhoto − costText) — unless a free ad
    pass paid for the ad (a pass covers either kind) or the upgrade was
    already charged; a failed attach refunds the upgrade. Insufficient
    credits → the photo is refused with the exact shortfall, nothing charged.
  - **Provenance lives in storage paths, not a schema change** (no
    migration): `collage/` = replaceable composed image, `parts/` = collage
    source originals, bare path = single photo or emailed-in extra. Emailed
    extras (item 1) never join the collage. Compose failures degrade to
    first-picture-as-photo with the rest in the gallery — a photo problem
    never blocks an ad (session-007 policy).
  - Dev mode (no Supabase storage) keeps the allowlisted URLs: first picture
    = photo, the rest = gallery; unit suite pins the collage geometry/colors
    (`test/photo-collage.test.mjs`).
- **34 · admin handbook tooltips** (user request, session 015: "I want to be
  able to 'Remember' how certain features that we built work, and why they
  exist. Make this through tooltips and little '?' boxes on the admin
  features."). All content lives in **`lib/admin-handbook.ts`** — 80 entries
  in 13 groups (one per admin page + cross-cutting concepts), each with
  title / what / why / optional watch-out, mined from `Session log/`,
  FEATURES.md, and HANDOFF.md, with session numbers cited so the full story
  is findable. Rendered by `components/Tip.tsx` (server lookup; a typo'd key
  fails `tsc`) + `components/HelpTip.tsx` (client "?" button opening a small
  centered card — Escape/backdrop/× close it; content travels only in the
  admin-gated page payload, never a public JS chunk). Placed across all 12
  admin pages (headings, field labels, intro lines; every Settings field has
  one), and the whole handbook reads straight through at the bottom of
  /admin/help. `test/admin-handbook.test.mjs` guards entry completeness +
  that every placed key exists + every page carries tips. Writing rules are
  in the module header: never invent history; never hardcode tunable
  numbers; plain language.
- **33 · Picture-set coaching + combined-photo confirmation** (user request,
  session 014). Two halves:
  - **Coaching replies:** an AD NEW that saves a picture replies "Got your
    ad! … If you have more pictures, please send them one at a time - up to 4
    total. If we don't hear from you within 10 minutes, we'll assume this is
    the only picture." Multi-picture and follow-up confirmations say how many
    pictures the ad now shows, how many more fit, and promise the combined
    photo. Sending pictures one message at a time is deliberate advice —
    carriers split multi-attachment MMS unreliably.
  - **Combined-photo confirmation (migration 9974):** the 5-minute cron
    (`/api/cron/digests` → `lib/collage-notify.ts`) finds pending/approved
    ads from the last 25 h (one hour past the attach window, so sets that
    finish near the window's edge still confirm) whose position-0 photo is a
    `collage/` object and
    whose newest picture (`ad_photos.created_at`, new column) is ≥10 quiet
    minutes old, claims each by compare-and-set on `ads.collage_notified_at`
    (new column; at-most-once — overlapping cron ticks can't double-send),
    and texts the seller the collage as an MMS through the outbound choke
    point (`pic` class, so PAUSE/blocklist/under-attack all apply; capped at
    25 sends/tick). A picture arriving after a confirmation makes the stamp
    older than the newest picture, which re-arms exactly ONE more send after
    the next quiet stretch. The 24 h attach window is unchanged — "10
    minutes" is when the set is ANNOUNCED complete, not when attaching
    closes (late pictures still attach while the ad is pending, and earn a
    fresh confirmation). Pre-9974 the cron warns once and sends nothing;
    `/api/health` probes `migration9974`. Pure decision math + seller copy
    unit-tested (`lib/collage-confirm.ts`, `test/collage-confirm.test.mjs`).

- **36/37/38 · Resetting Insights — a design question to settle BEFORE
  building.** Insights stores no numbers. Every figure on that page is
  derived, live, from the raw rows: inbound messages, the ad records, and the
  append-only `credit_ledger`. So there is nothing to "reset" in place — the
  build has to choose one of three shapes, and they are not equivalent:
  - **(a) A launch cutoff.** One setting: ignore everything before a given
    date. Fixes every skewed row at once, needs no per-row controls, and
    keeps every number honest and reconcilable. This is almost certainly what
    "my testing threw off the numbers" actually wants.
  - **(b) Per-row manual offsets** (what item 36 literally asks for). Doable,
    but it means the Insights figures stop tying out to the ledger and the
    message log. For counts that is untidy; for MONEY it is a real problem —
    the ledger is append-only precisely so the money can always be
    reconstructed, and a hand-edited "money spent" would be the one number in
    the system that cannot be traced to entries.
  - **(c) Purge the test data.** Delete the test rows themselves. Every
    number then becomes correct everywhere at once, permanently — not just on
    Insights but in the ledger, the funnel and the audit log.
  Recommendation: (c) for the pre-launch test junk, plus (a) as the standing
  control, and reserve (b) for counts only — never for money. Worth ten
  minutes with the user before writing any of it.
- **36 · The two sender rows may already exist.** `/admin/insights` renders
  "Texts received" (total inbound in the window) and "People who texted"
  (unique senders) as separate figures today. If the ask is really about the
  numbers being wrong rather than missing, this half of item 36 may reduce to
  relabelling — check the page before building.
- **39 · "I need help!"** worth capturing at build time: page URL, referrer,
  signed-in member id/phone, whether an email is on file, timestamp, user
  agent, viewport, and the last error the page saw. Ask whether the report
  should also text/email the operator immediately or just queue in admin.
- **40 · Version number.** Needs a single source of truth (a constant in
  `lib/config.ts` is the obvious home) so the footer, `/api/health` and any
  future about-page all read the same value.

- **41 · Users table view.** Columns we can already fill from what is stored,
  so this needs no new data collection: phone, email, member id, member since,
  subscribed/unsubscribed, email-subscribed, verified, posting-banned, offense
  count, ads posted, ads sold, money spent, money added, current balance,
  auto-top-up on/off, card on file, starter credit taken, PIC balance, last
  active, categories subscribed, line type (session 016), blocked. Two things
  to settle before building: (a) **saved views** need somewhere to live —
  a small `admin_views` table keyed to the operator is the obvious shape, and
  it is the only part needing a migration; (b) **paging vs. everything** —
  the member list is small now but this screen is the one that gets slow
  first, so sort/filter belong in the query, not in the page. Worth checking
  whether it should share the CSV export path, if one is wanted, since "filter
  then export" is usually the next request after a grid like this.

- **36/37/38 · How the "reset" landed.** Offered a cutoff date, per-row manual
  offsets, or a purge, the user chose the purge — the only option that makes
  every figure right everywhere at once AND keeps them reconcilable with the
  rows underneath. The "two rows" half of 36 turned out to be a labelling
  problem: both figures already existed, reading as two versions of the same
  number. They are now "Unique people who texted" and "Total texts inbound".
- **42 · Silent by default was the point.** The notice used to be automatic,
  which is right for an outage and wrong for everything else — pausing ads
  before launch would have texted every subscriber that the service is in
  technical trouble when it plainly isn't.
- **43 · Where the schedule is stamped.** In the DRAIN, not at the moment a
  pause lifts, so every way a queue backs up is covered (pause, outage,
  overnight window, tripped budget) rather than only the one we thought of.
  The gaps are random because a fixed interval is itself a machine signature.
  Do the arithmetic on a big backlog: 20 ads at a 15-minute average is five
  hours, so what doesn't clear inside a day's window goes the next day.
- **44 · Archive vs delete.** Two tools on purpose. Archive is for a real
  person and changes nothing they own — no refund, no text, ledger untouched,
  their money still theirs. Delete (the purge tool) is for your own test data
  and cannot be walked back. The user page and the handbook both say so.

- **45 · Why the number is IN the picture.** A picture arriving as its own
  message says nothing about which of the four ads above it belongs to. The
  badge is the only thing tying photo to line — and to `PIC 1024`, which is
  how a buyer asks for more. It is drawn as vector PATHS, not `<text>`:
  librsvg needs a font fontconfig can find, the serverless runtime ships
  none, and a `<text>` badge renders BLANK there while looking perfect on any
  developer machine. Do not "simplify" it back.
  One picture per ad, never the set: a three-picture ad would otherwise cost
  three MMS to every subscriber. The cost breaker counts a picture as 3
  segment-equivalents and its ceiling rose from 12,000 to 40,000 to match —
  at the old number it would have halted sending most days.
  Batching also RESTORED the admin re-run (bumps ride a batch again) and
  fixed a latent production bug: session 016's per-ad slot key `ad#1022` was
  squeezed into a timestamp column as `adT1022:00:00Z`, which Postgres
  rejects, so every instant-send compose threw in prod while the dev file
  store was perfectly happy. Batches carry a real `slot_key`.
- **46 · The problem report kept its optional NOTE.** That was the whole
  point of item 39 — a stuck member usually cannot describe what went wrong,
  and the diagnostics describe it for them. What changed is the REPLY: a
  report nobody can answer is a mystery instead of a person to call back. The
  same rules now cover the question form on /contact, which previously
  accepted a signed-in session in place of typed contact details.
- **47 · Fill-only, and why the rule is that strict.** Both forms are open to
  anyone, so a typed phone number is a CLAIM about identity, not proof of it.
  A signed-in session always wins; failing that the typed number is used, but
  only ever to fill a BLANK name, never to replace one and never to create an
  account. Worst case is a wrong name on a record rather than somebody
  relabelling a stranger's account — and an operator's correction can't be
  undone by the next form that household fills in. The columns are read
  lazily (like `auto_topup` before 9973), so a missing migration can never
  take an account lookup down.
