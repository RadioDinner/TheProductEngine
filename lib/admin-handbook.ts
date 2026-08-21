/**
 * The admin handbook — the operator's memory, distilled from the project's
 * session history ("Session log/", FEATURES.md, HANDOFF.md) into small "?"
 * tips placed next to the admin features they explain (session 015, user
 * request: "I want to be able to 'Remember' how certain features that we
 * built work, and why they exist").
 *
 * Each entry answers three questions: WHAT the control actually does, WHY it
 * exists (the request, outage, abuse case, or decision that created it —
 * cited by session number so the full story is findable in `Session log/`),
 * and optionally what to WATCH OUT for. Rendered by <Tip k="…" /> beside the
 * control, and read straight through at the bottom of /admin/help.
 *
 * Writing rules (keep these when adding entries):
 * - Never invent history. If a control has no recorded reason, say so.
 * - Tunable numbers live on Settings — never hardcode them in tip text.
 * - Plain language; the reader is the operator, not a programmer.
 */

export interface HandbookEntry {
  title: string;
  what: string;
  why: string;
  gotchas?: string;
}

/** Page groupings for the read-through view on /admin/help. */
export const HANDBOOK_PAGES: { prefix: string; label: string; href: string }[] = [
  { prefix: "dashboard", label: "Dashboard", href: "/admin" },
  { prefix: "money", label: "Money", href: "/admin/money" },
  { prefix: "review", label: "Review queue", href: "/admin/review" },
  { prefix: "digests", label: "Digests", href: "/admin/digests" },
  { prefix: "reports", label: "Reports", href: "/admin/reports" },
  { prefix: "insights", label: "Insights", href: "/admin/insights" },
  { prefix: "ads", label: "All ads", href: "/admin/ads" },
  { prefix: "business", label: "Business packages", href: "/admin/business" },
  { prefix: "featured", label: "Featured spots", href: "/admin/featured" },
  { prefix: "users", label: "Users", href: "/admin/users" },
  { prefix: "subscribers", label: "Subscribers", href: "/admin/subscribers" },
  { prefix: "messages", label: "Message audit log", href: "/admin/messages" },
  { prefix: "calls", label: "Calls", href: "/admin/calls" },
  { prefix: "help", label: "Help reports", href: "/admin/help-reports" },
  { prefix: "purge", label: "Purge a member", href: "/admin/purge" },
  { prefix: "settings", label: "Settings", href: "/admin/settings" },
  { prefix: "smsdiag", label: "SMS diagnostics", href: "/admin/sms-diag" },
  { prefix: "concepts", label: "How it all hangs together", href: "/admin/help" },
];

const ENTRIES = {
  /* ---------------- Dashboard (/admin) ---------------- */

  "dashboard.overview": {
    title: "What this page is for",
    what: "The first screen after you sign in: whether the service is running, how many people are subscribed by text and by email, how many ads are live, and anything sitting waiting on you. Every figure links to the page that owns it.",
    why: "Session 019, the user's ask: an admin dashboard at /admin, starting with current SMS subscribers, current email subscribers, active ads and a system health status. The review queue used to be here and moved to its own Review tab — it is still one click away, and its count is on this page so a waiting ad can never go unnoticed.",
    gotchas: "Every number is counted fresh on each load, straight from the database, so it can disagree with a figure on Reports only if the two are asking different questions — and where they overlap they are defined to match. Subscriber counts here and on Subscribers use the same definition; \"active ads\" means approved and still running, so sold, expired and deleted ads are out.",
  },
  "dashboard.health": {
    title: "The system health verdict",
    what: "One line saying whether the service is working, with the checks it is built from underneath. \"All systems go\" means ads are on, messages are on, neither pause is set, texting is configured and nothing is backed up. Anything else names what is wrong and where to fix it.",
    why: "The user's session-019 ask, in their words: \"when ads and messages are on and not paused and running, put status 'All systems go'\". The point is a single glance that answers \"is my service actually running?\" without opening Settings, Digests and the Vercel dashboard in turn.",
    gotchas: "Quiet hours are NOT a fault, and neither is Saturday going quiet an hour early (see Settings). Outside the send window ads queue by design — that window is a promise the compliance copy makes to every subscriber — so the panel stays green and the summary tells you when the next batch goes. Colouring a normal night red would teach you to ignore the panel, which is the only way a health panel can really fail. A pause, by contrast, is always red, because only you can clear it.",
  },
  "dashboard.smsSubscribers": {
    title: "Current SMS subscribers",
    what: "Numbers currently subscribed to the ad texts. Counted the same way the Subscribers tab lists them: a member with a phone number and a live subscription date.",
    why: "The first figure the user asked for. It is the size of the audience every approved ad reaches, so it is the number that decides what an ad is worth and what a batch costs to send.",
    gotchas: "A STOP clears the subscription date, so this figure drops the moment someone opts out and rises again on a fresh re-subscribe. It counts SUBSCRIBERS, not members — someone with an account who never subscribed is not in here.",
  },
  "dashboard.emailSubscribers": {
    title: "Current email subscribers",
    what: "Addresses currently subscribed to the email editions, including email-only signups who have no phone account at all.",
    why: "The user's second figure. Email is the channel with no per-message cost and no carrier to answer to, which makes it the cheapest place for the list to grow.",
    gotchas: "Someone can be on both lists; the two tiles are not exclusive and should not be added together to get \"total audience\".",
  },
  "dashboard.activeAds": {
    title: "Active ads",
    what: "Ads running right now — approved, and not sold, expired, rejected or deleted. The note underneath splits them into the ones already on the website and the ones approved but still waiting for their batch to go out.",
    why: "The user's third figure. It answers \"how much is actually for sale on my service today\", which is the number a seller, a sponsor and a buyer all care about.",
    gotchas: "An ad only appears on the website once it has actually broadcast, so the two halves of the note are genuinely different states, not a rounding difference. A big \"waiting to go out\" number outside the send window is normal; a big one during the window means look at Digests.",
  },
  "dashboard.pendingReview": {
    title: "Waiting for review",
    what: "Ads sitting in the review queue for your yes or no, with a count of any picture ads still collecting pictures underneath.",
    why: "The review queue moved off /admin in session 019 to make room for the dashboard. Its count stayed here so moving the page could never mean an ad quietly waits for days — the tile is the reminder the old landing page used to be.",
    gotchas: "Picture ads still collecting are deliberately NOT in the queue yet: they appear once the seller stops sending (about ten minutes) or hits the four-picture maximum, so you never approve an ad that is only half its photos.",
  },

  /* ---------------- Money (/admin/money) ---------------- */

  "money.overview": {
    title: "Cash collected is not income",
    what: "Four figures that keep apart what you have EARNED, what you are HOLDING for other people, and what you have GIVEN away. Read fresh from the credit ledger on every load — the same rows a member's own money history shows.",
    why: "The user's session-018 question: \"how do I measure ACTUAL income, since fifty people prepaying $50 and never posting is $2,500 collected but nothing earned.\" Before this page the service could only tell you how much money had arrived, which is the number most likely to be mistaken for profit.",
    gotchas: "Money on a member's account is a LIABILITY until an ad runs — it is refundable, and it is not yours. If you ever want one number for \"how is the business doing\", it is \"of that, paid for with real money\": ads that ran and that somebody actually paid cash for. Adjustments written before migration 9957 are unclassified and counted as given away, which understates cash collected on purpose — an honest floor beats a confident guess.",
  },
  "money.earned": {
    title: "Revenue earned",
    what: "What members have actually spent on ads, less anything refunded back to a balance because an ad did not run. This is the moment money stops being theirs and starts being yours.",
    why: "An ad running is the thing you sold. Until then their money is a deposit, however long it has been sitting there.",
    gotchas: "It is split below into the part paid with real money and the part paid with credit you gave away. Only the first is income; the second is the cost of the welcome offer showing up as if it were a sale.",
  },
  "money.collected": {
    title: "Cash collected",
    what: "Every dollar that actually arrived — card payments through Stripe, plus cheques, cash and phone orders you entered as a payment on a member's page.",
    why: "Insights' \"Money added\" counts only Stripe, so before migration 9957 every cheque you took by hand was invisible in it. This figure is the one that matches your bank.",
    gotchas: "It counts money IN, not money kept: subtract what is still owed to members to see what is genuinely yours. And it is all-time, not a period — it does not shrink when a refund goes out, which is what the \"paid back out\" row is for.",
  },
  "money.owed": {
    title: "Still owed to members",
    what: "Unspent balance that members actually paid for. Refundable, and not income. The percentage says how much of everything you have collected is still somebody else's.",
    why: "This is the number behind the user's worry about prepaid balances. A big figure here is not a windfall, it is a debt — and if it grows faster than revenue earned, the service is collecting money it hasn't earned the right to keep.",
    gotchas: "Credit you gave away is NOT in here; that sits under \"given away\" because it can never be refunded as cash. A member's own page shows their share of this as Refundable.",
  },
  "money.given": {
    title: "Credit issued",
    what: "Welcome credit, credit added with an invitation, and courtesy make-goods. A marketing cost, all time.",
    why: "It looks like money on a member's balance and spends like money on an ad, but it never came from anyone's wallet — so it can never be revenue and can never be refunded. Keeping it in its own box is what stops the welcome offer flattering the income figure.",
    gotchas: "The welcome offer is capped: starter credit times the member limit is the most that can ever be issued this way (currently $8,000). If this figure is climbing toward that, the launch offer is doing its job — check whether paid ads are following.",
  },

  /* ---------------- Review queue (/admin/review) ---------------- */

  "review.queue": {
    title: "Why every ad waits for you",
    what: "Every ad — texted, web-posted, business, or event — sits here until a human approves it. Nothing broadcasts or appears on the website without your yes.",
    why: "A founding decision from the very first grilling session: \"manual review with credit refund on rejection works … I want to review ads manually initially\" (session 001). The human gate is also the safety valve that lets other rules stay loose — links, categories, and business ads are all judged here rather than by rigid automation.",
    gotchas: "The seller was already charged when the ad arrived (dollars off their ad-credit balance). Rejecting is what settles the money — see the two reject buttons.",
  },
  "review.flagged": {
    title: "The Flagged badge",
    what: "A word on your Settings word filter matched this ad. Flagged words sort their ads to the top of the queue so you look closely; auto-reject words never reach the queue at all (bounced instantly, nothing charged, kept in the audit log).",
    why: "From the first session: \"I want to build a small rejection system to analyze for specific words … in the admin portal … so I can add/remove words as I choose\" (session 001). Firearms were banned by name in session 009 — the stated rules and post form say so; matching word-filter entries were left to you to add.",
  },
  "review.linkBadge": {
    title: "The link badge",
    what: "The ad contains a web link or bare domain. It is flagged for your judgement, not stripped automatically — edit the link out before approving, or reject.",
    why: "The service is a walled garden: links in member ads are edited out or the ad is rejected. The decision to FLAG rather than auto-strip was deliberate (session 004) — an automated rule can't tell spam from a legitimate reference, and manual review was already the model. Business packages are the sanctioned exception: they MAY keep one link, judged at review (session 009).",
  },
  "review.pictureBadge": {
    title: "Picture ads in review",
    what: "The thumbnail links to the full-size photo. For a multi-picture ad this is the finished collage — exactly the one image a buyer's PIC pull will send. The website shows the full individual pictures instead of the collage (display-only filter; the collage stays for SMS).",
    why: "What-you-approve-is-what-sends: sellers who texted several pictures get them combined into one collage (session 013 build of the session-011 idea), and after competitor examples the layout became scrapbook style for 2–3 pictures / a clean 2×2 grid for 4 (session 014, user decisions). The website switched to showing the originals the same session: \"I want the full size, non collage images … on the website.\"",
    gotchas: "Emoji are stripped from ad text before you ever see it (they flip an SMS digest to pricier encoding and read badly on flip phones) — the sender's exact original stays in the message log.",
  },
  "review.editText": {
    title: "Editing before approval",
    what: "The text box is live — fix typos, trim length, or remove a link, then Approve. Your edit becomes the public/broadcast text.",
    why: "Admin ad-editing was in the founding spec (session 001). The seller's original message is never lost: every inbound text is kept verbatim in the message audit log (\"I want absolutely every message logged\" — session 001).",
  },
  "review.category": {
    title: "Assigning the category",
    what: "You pick the category at review; it decides which selective subscribers get the ad and where it files on the website. Web posters may suggest one — it only pre-fills your dropdown.",
    why: "User decision, session 009: \"You, at review\" won over seller-assigned — the operator judges what a thing is, same ethos as manual review. Uncategorized is safe by design: an uncategorized ad rides EVERY subscriber's digest and shows under All, so a skipped dropdown can never make an ad unsendable.",
  },
  "review.reject": {
    title: "The two reject buttons",
    what: "Reject–refund returns the full dollar charge and texts the seller your reason. Reject–violation keeps the charge and records a strike; three strikes bans the number from posting (reversible on their user page).",
    why: "Verbatim founding rules (session 001): \"If their ad gets rejected for something inappropriate, use their credits. If its a false positive, don't use credits\" (money since session 016's dollar pricing) and \"If they offend 3 times, they're banned.\" Refunds are idempotent (guarded by a ledger reference) so a double-click or a race with the seller deleting can never refund twice (sessions 002, 009).",
    gotchas: "Leave the reason blank and a sensible default is texted. For an ad that must simply disappear, this is still the right flow — Delete on the Ads tab never refunds and never notifies.",
  },
  "review.chatReports": {
    title: "Reported chat messages",
    what: "A member pressed \"Report this message\" in a website conversation. You see the message, both parties, and a resolve/dismiss choice — resolving only clears the report; any real action (strikes, bans, blocks) stays yours on the sender's user page.",
    why: "Part of the session-009 chat rebuild (FEATURES item 13). It reversed an earlier privacy stance: session 008 deliberately kept chat OUT of the audit log, but an operator asked to act on a reported message has to be able to read the conversation — so since session 009 every chat message is logged, and the reversal is documented on the help page.",
  },
  "review.townHall": {
    title: "Town hall event approvals",
    what: "Free community-event listings for the /town-hall board and the homepage right sidebar. Approve or decline — nothing was charged, so declining owes nothing. Approved events drop off by themselves the day after the event date.",
    why: "The user's session-009 ask: a Town hall where people add upcoming events, \"an approval process same as the regular ads.\" v1 is deliberately the free board only — the paid SMS/email event blast is a later phase whose pricing (\"probably just $19.99 a listing\") was never settled, so nothing about events sends messages today.",
  },

  /* ---------------- Digests (/admin/digests) ---------------- */

  "digests.slots": {
    title: "Slots, and what they cost",
    what: "EMAIL edition times (Eastern Time), set on Settings — 7am, noon and 5pm by default. SMS no longer uses these: since session 016 each ad is TEXTED the moment you approve it. An email edition carries the ads texted since the last one, so email stays a summary; an empty edition sends nothing.",
    why: "Email mirroring was a session-007 user decision (before that, email had its own schedule and union-of-digests content). A fact worth remembering from session 003 — the user spotted it: slot COUNT is nearly cost-neutral, because each ad broadcasts only once per day regardless of slots; the real cost driver is ads × subscribers. And from session 011: slots [7, 12, 16, 20] is a zero-code change that matches every registered 10DLC word (\"up to 4 digests/day … morning, noon, afternoon, evening\") if faster delivery is ever wanted.",
    gotchas: "Session 011 kept digests over per-ad sending because of the registered \"up to 4 digests a day\" frequency promise; session 016 REVERSED that on the user's decision — the published copy now says frequency varies inside a published Mon-Sat send window, so the 10DLC campaign description has to say the same — session 020 moved that published window to 7am-6pm, which means the campaign description needs the new hours too. Each email edition carries one sponsor banner, rotated by fewest-so-far.",
  },
  "digests.adminMessage": {
    title: "Message every subscriber",
    what: "Your own text, sent individually to every SMS subscriber - not a line riding an ad batch (that is what business sponsors are). Schedule it, and it goes out on the next run INSIDE the send window. The time you pick is the earliest it may go, never an exact appointment.",
    why: "Session 020, the user's request, with their own example: \"Are you liking The Plain Exchange? Feel free to call and leave a voice message with feedback! Thank you for being a great part of our community.\" Asked how it should behave, they said: to all subscribers, as an individual message, during active hours only.",
    gotchas: "It is billed per subscriber, like any broadcast - anything over 160 characters costs TWO segments to every single person on the list, and the compose box tells you the current count before you send. Category choices deliberately do NOT apply: those are about which ADS a member wants, and this is a note about the service. The blocklist does apply. A message scheduled into a Sunday or an evening is not lost - it waits for the next open window, which is why the field says 'no earlier than'. Cancel only works before it has gone.",
  },
  "digests.queue": {
    title: "The queue is the truth",
    what: "This list shares its selection code with the real composer, so what you see is literally what the next digest will carry: new ads first in approval order, queued bumps filling what's left, capped at the per-digest maximum set on Settings.",
    why: "Built in session 007 so the page can never disagree with reality — the same function (selectDigestItems) drives both. New-ads-outrank-bumps is a founding rule (session 001).",
  },
  "digests.reorder": {
    title: "Move up / Move down",
    what: "Swaps the ad's place in the approval order, which is the order the digest prints.",
    why: "Part of the session-007 queue-controls batch, built the day real SMS went live and the queue needed hands-on control.",
  },
  "digests.skipNext": {
    title: "Skip next digest",
    what: "Holds the ad out of the next digest only; it returns to the queue automatically afterward (the Held section shows it, with a Release button to bring it back early).",
    why: "Session-007 queue controls. Its migration (ads.hold_until) caused that day's second migration race — the deploy read a column that wasn't pasted yet, the cron crashed, and the 4 PM digest was missed. That incident is why schema-dependent features now degrade gracefully and /api/health probes each migration.",
  },
  "digests.backToReview": {
    title: "Back to review",
    what: "Reverts the ad to pending — it leaves the queue and the website and waits in the Review tab again. Any queued bump is dropped.",
    why: "Session-007 queue controls: the undo for an approval you thought better of, without the finality of rejecting or deleting.",
  },
  "digests.sendEarly": {
    title: "Send early vs Send extra",
    what: "Send early composes the UPCOMING slot right now, under that slot's identity — the scheduled run then no-ops, and the queue is consumed. Send extra sends an extra edition right now consuming NOTHING — the same queue still rides at the regular slot. Both are labeled in the SMS header and the email subject.",
    why: "Built in session 007 for breaking-news moments (an auction tomorrow, a found dog). The two-button split exists because \"send it now\" means two different things: move the slot up, or add an edition.",
    gotchas: "Send extra means subscribers get the same ads twice that day — that's the point, but remember it counts against the segment budget like any digest.",
  },
  "digests.draining": {
    title: "Queued deliveries draining",
    what: "Sent digests deliver through an outbox: one row per subscriber per message part, drained in bounded batches by the 5-minute cron, columnar (every subscriber gets part 1 before anyone gets part 2), resuming across ticks. This counter is what's still in flight.",
    why: "The session-003 delivery rework — before it, a timeout could half-send a digest. The outbox made sending resumable, idempotent, and race-safe, and it's where the segment-budget breaker and STOP-purging hook in (a STOP or block cancels that number's queued rows at SEND time, not just compose time — session 004 security fix).",
    gotchas: "If this number sits still, check Settings: a pause or a tripped segment budget parks the drain (rows wait, nothing is lost — it resumes on its own).",
  },
  "digests.history": {
    title: "Digest numbers & history",
    what: "Every digest that actually carried ads gets the next number (\"Plain Exchange No. 3 …\"); skipped empty slots consume nothing. The email edition mirrors the number. \"Composed\" means built and enqueued — delivery state lives in the outbox.",
    why: "Numbering was FEATURES item 5 (session 008), with the counter reset to 1 at build per the user's ask — it gives subscribers and the operator a shared way to say \"that was in No. 12.\"",
  },

  /* ---------------- Reports (/admin/reports) ---------------- */

  "reports.overview": {
    title: "What Reports is for",
    what: "The pulse page: subscriber counts, website visits, and ad volume at a glance. Deeper who-does-what tables live on Insights; the raw lists live on Subscribers.",
    why: "Built in session 002, the first session after deploy, so the operator could watch the service grow without touching the database.",
  },
  "reports.visits": {
    title: "How visits are counted",
    what: "Counted server-side on the homepage and ad pages — no cookies, no JavaScript required, no tracking scripts.",
    why: "Built in session 002 to fit the audience and the ethos: plain-community visitors on old browsers or with JS off still count, and there is nothing for a privacy policy to apologize for.",
  },
  "reports.subscriberDates": {
    title: "Subscriber counts",
    what: "\"Active\" means currently subscribed. A STOP clears the subscription; re-subscribing starts a fresh date.",
    why: "Session 002 (counts) and session 007 (the Subscribers tab with per-number dates). SMS and email are separate editions — one person can be both (a merge/link on their user page records that).",
  },

  /* ---------------- Insights (/admin/insights) ---------------- */

  "insights.purpose": {
    title: "What Insights is for",
    what: "Who uses the service — and who abuses it. Top advertisers, heaviest texters, picture-pull volume, number look-ups, engagement, most-bumped ads, over a 7/30/90-day window. Always computed fresh.",
    why: "Built in session 003 alongside the first abuse controls. The tables double as the blocklist's front door: the worst offenders surface here ranked, each with a one-click Block.",
  },
  "insights.block": {
    title: "One-click Block",
    what: "A blocked number is dropped the instant it texts — no reply, no account, no charge — and never receives a digest. The incoming text is still recorded for your records. Unblock lives on Settings.",
    why: "Part of the session-004 operator-safety build (with the pause switches and UNDER ATTACK mode), designed after the threat-modeling decision that trust and cost-safety come first. Logging-then-dropping keeps the forensics trail the audit ethos requires.",
  },
  "insights.picFlags": {
    title: "The Excessive picture flag",
    what: "Numbers pulling more than the Settings threshold of PIC photos in 24 hours are flagged red. The real cost control is the PIC daily allowance + bank (also on Settings); this flag is the human-attention layer on top.",
    why: "Picture texts (MMS) are the most expensive thing the service sends per message. The flag arrived in session 003; the hard quota arrived in session 006 after brutal abuse testing (\"PIC hammer 5 days → exactly 3 MMS/day\" — the suite proved the ceiling holds).",
  },
  "insights.revealFlags": {
    title: "Number look-ups: the scraper signature",
    what: "Each count is DISTINCT sellers' numbers revealed by that member (re-viewing an ad they already revealed is free and uncounted). More than the Settings threshold in 24 hours flags them — with the usual one-click Block.",
    why: "The user spotted the risk in session 009: \"technically anyone could create a web profile and log in to start scraping numbers out.\" The answer (user-picked): metered click-to-reveal — numbers never render in the page code at all, each member gets a daily allowance that banks like PIC pulls, and every reveal is recorded. A real buyer never notices the meter; a scraper hits it in minutes and shows up here.",
  },
  "insights.engagement": {
    title: "The engagement score",
    what: "A weighted blend of texting, posting, picture pulls, bumps, and purchases — the people most alive on the service float to the top.",
    why: "From the session-003 insights build: meant for spotting champions (and future verified members) as much as problems.",
  },
  "insights.mostBumped": {
    title: "Most-bumped ads",
    what: "Which ads keep riding digests via re-runs. Only YOU can queue these now — the member-facing BUMP command was removed entirely in session 016 (user decision: \"completely gone, from everywhere\").",
    why: "Worth watching because of a proven leak: with free member bumps, the session-005 abuse suite kept a cheap ad alive five months for $0. Session 016 closed it by removing the feature; this table now just shows your own curation.",
  },

  /* ---------------- All ads (/admin/ads) ---------------- */

  "ads.list": {
    title: "The all-ads ledger",
    what: "Every ad in every status, searchable by text or ad number, filterable by status — including deleted, because deletion is a soft state, not an erasure.",
    why: "Ad-number search was fixed in the session-005 correctness audit; the deleted filter came with soft deletion (session 008). History is never rewritten here — past digests and the message log keep their ad numbers forever.",
  },
  "ads.bump": {
    title: "Admin Bump (re-run)",
    what: "Queues the ad to ride the next digest (after new ads). An expired ad relists first. Free, and operator-only: the member-facing BUMP command was removed in session 016.",
    why: "Session 007, deliberate: the operator re-running an ad is curation, not revenue. One queued re-run per ad is a founding rule (session 001). Session 016 removed the seller's own BUMP everywhere (user decision: \"completely gone, from everywhere, including the FAQ\") — this button is the only way an ad rides twice.",
  },
  "ads.edit": {
    title: "Inline edit",
    what: "Change the public text or category any time — pending, approved, or expired. The seller's original stays in the message log.",
    why: "Inline editing arrived in session 007 when the digest queue needed hands-on control; the category joined in session 009 with the category system.",
  },
  "ads.delete": {
    title: "Delete vs Reject",
    what: "Delete removes an ad in ANY status: off the website and out of the digest queue immediately, queued bump dropped, photo removed from storage. It is a soft delete — past digests and the message log keep the number. No refund, no text to the seller.",
    why: "Requested at the end of session 007, built in session 008. Soft-by-design because broadcast history must never be rewritten (the digest_items record is append-only, same ethos as the money ledger). Delete stays refund-free deliberately: the confirm box shows what the seller paid so a deserved refund goes through Adjust balance on their page — YOUR judgement, not automation.",
    gotchas: "For an ad still in review, prefer Reject — that's the flow that refunds (benign) or strikes (violation) and tells the seller. Members deleting their OWN ads follow a stricter matrix (session 009, user's words): pending → refund; approved but never digested → refund; ever ridden a digest → \"game over,\" no refund.",
  },
  "ads.photoSubmissions": {
    title: "Emailed-in pictures",
    what: "Pictures emailed to the ads@ address with the ad number in the subject wait here per ad. Approve → the picture joins the ad's WEBSITE gallery (positions 1+); the paid MMS picture keeps position 0 and stays what SMS/PIC/digests carry. A \"replacement listing picture\" submission (from the member's My ads page) swaps position 0 instead — after your approval.",
    why: "FEATURES item 1 (session 008): flip-phone sellers often have a relative with email. Review is the gate because an email From line is easy to fake; keeping extras web-only means emailed pictures can never add MMS cost or bypass picture-ad pricing. The replacement flow rides the same review because a silent swap would bypass moderation (session 009, item 16 decision).",
    gotchas: "The address was renamed in session 013: ads@theplainexchange.com is the pictures-in address; the old photos@ still works (routing is by the part before the @, domain-wide in Resend — no config needed for new addresses).",
  },

  /* ---------------- Business (/admin/business) ---------------- */

  "business.model": {
    title: "How business packages work",
    what: "Businesses pay up front on the public /advertising page (tiers set in session 009; repriced to $199/$349/$599 in session 016 so every tier costs more than a single classified), then land here for review — paying never skips the human gate. Approving starts the run that day.",
    why: "FEATURES item 17, the user's ask verbatim: \"a package of running in a digest once a day for 1 week, 2 weeks or a month.\" Stripe self-serve, the labeled sponsor line, and links-allowed-after-review were all explicit user picks that session. Same-approval-as-ads was its own instruction: \"for business listings, I want an approval process same as the regular ads.\"",
  },
  "business.sponsorLine": {
    title: "The Sponsor line",
    what: "An active package rides the FIRST digest of each day as a clearly-labeled \"Sponsor:\" line placed above the member ads — never consuming one of the member slots. The email edition mirrors it with the link clickable. Sponsor text goes through the same character cleaning as everything else and counts against the segment budget.",
    why: "\"Labeled sponsor line\" was the user's pick (session 009) over giving businesses a member slot: advertisers get guaranteed daily placement, members lose nothing, and the label keeps the digest honest about what's paid.",
  },
  "business.missedDays": {
    title: "Missed days extend the run",
    what: "A package is done when its ad has ridden the bought number of days — not on a calendar date. A day with no digest (pause, tripped budget, no member ads) doesn't count; the schedule column shows \"N missed days — run extends.\"",
    why: "Designed so a guaranteed-daily promise can't be silently eaten by the segment-budget breaker or a pause — the session-009 adversarial review flagged exactly that failure mode, and the answer was to extend rather than swallow.",
  },
  "business.refundDue": {
    title: "Declined = refund by hand",
    what: "A declined package never ran, so per the refund policy the money goes back — but nothing refunds automatically. Do it in the Stripe dashboard (Payments → search the payment ref → Refund), then press \"mark done.\"",
    why: "Deliberate: no code path in this app can move money OUT. Every refund of real dollars is a human in the Stripe dashboard — the same reasoning that keeps credit adjustments note-required and ledgered.",
    gotchas: "If someone pays while the business migration is missing, the package can't be stored — the Stripe webhook then 503s ON PURPOSE so Stripe retries until the migration lands (session-009 review fix), and the server log carries \"PAID PACKAGE COULD NOT BE STORED.\"",
  },

  /* ---------------- Featured (/admin/featured) ---------------- */

  "featured.concept": {
    title: "The Featured sidebar",
    what: "Four homepage slots — two stacked on each side of the ads — each rotating every 8 seconds through up to 3 image ads. Slots 1-2 are the left column, 3-4 the right. A spot runs 30 days from the day it is approved.",
    why: "The user's spec, nearly verbatim (session 009): \"two side bar ad spots that will rotate every 8 seconds … up to 3 ads on each … I will manually post these Featured advertisers … image ads, capable of linking to external websites.\" Session 019 priced them ($199 for a 30-day run), widened the board to four — \"two stacked on each side\" — and added the public request page and its queue, so a business can ask rather than having to know to phone you.",
    gotchas: "The left column shows its heading and the \"Reserve your spot here\" link even when nothing is running, unlike the other sidebars, which hide when empty. That is deliberate: before the first spot is sold that column IS the advertisement for the product, and hiding it would leave the request page unreachable from the front page.",
  },
  "featured.timeline": {
    title: "The four slots across dates",
    what: "One row per slot, one bar per booked run, drawn across the days it holds. The red line is today. Hover a bar for who it is and its exact dates. Finished runs stay drawn, greyed, so you can see what came before as well as what is booked.",
    why: "The user's session-019 ask: \"I want all 4 of the slots showing as rows with durations across dates.\" The queue page can only say a date; this shows why that date — which slot frees when, where the gaps are, and how far out the board is sold.",
    gotchas: "Which slot a run sits in is DERIVED, not stored: the same earliest-free-slot rule that booked it is replayed to draw it, so this picture can never drift from the schedule. That also means the slot numbers here are about the calendar, not about which side of the homepage a spot appears on — slots 1-2 render on the left and 3-4 on the right, but a run moving between them would change nothing a visitor sees.",
  },
  "featured.queue": {
    title: "The featured request queue",
    what: "Businesses ask for a spot on the public request page; they land here oldest first. Approving one BOOKS it a start day — today if a spot is free, otherwise the day the earliest-running spot finishes. The button says which day before you press it.",
    why: "The user's session-019 rules: four spots, two stacked on each side of the homepage, $199 for a 30-day run, and \"if I have 3 confirmed businesses for the month, and 2 more people apply, if both are valid/approvable, the first one submitted will get the 4th spot.\" The queue is stored order, so that promise is a fact about the data rather than something you have to remember on a busy morning.",
    gotchas: "The four runs do NOT share a calendar month — each is its own 30 days from the day IT was approved, so they finish on different dates and a spot opens whenever the earliest-finishing one finishes. Approve out of order and you take the slot from whoever asked first: the position shown here is re-checked against submission time when you press the button, so a stale page cannot let a later request jump the line. Nothing is charged for a request you decline; the public page promises that.",
  },
  "featured.links": {
    title: "Why these links are allowed",
    what: "A spot may link out to an external website — the one sanctioned exception to the no-links rule — and the link is marked as a paid placement (rel=\"sponsored\") so search engines treat it honestly.",
    why: "Safe because only you can post here (session 009): the walled garden is enforced by who holds the pen, not by a filter. Images ride the same byte-checked upload pipeline as every other picture in the app — shrunk in the browser first, so a phone photo uploads in a second.",
  },
  "featured.rotation": {
    title: "Order, rotation, and motion",
    what: "Order sets the rotation sequence inside a slot; only the first 3 active spots rotate (a warning shows if more are on). Rotation pauses when the browser tab is hidden, and visitors who prefer reduced motion get dots to page through instead.",
    why: "The reduced-motion fallback is part of the site's accessibility posture (WCAG AA aim, session 009's accessibility statement) — motion never traps a reader.",
  },

  /* ---------------- Users (/admin/users) ---------------- */

  "users.invite": {
    title: "Add a member",
    what: "Creates the account immediately, optionally grants starting ad credit in dollars (a ledger entry, noted as an invite grant), and texts ONE compliant invite: who we are, \"to sign up, reply START,\" rates/frequency disclosure, HELP/STOP. One invite per number per day; already-subscribed numbers are refused.",
    why: "FEATURES item 8 (session 008). The strictness is the point: this is outreach to someone who never texted us first — one polite knock, not a campaign. Everything about the wording matches the registered 10DLC program, and nothing else is ever sent unless they reply START.",
  },
  "users.memberId": {
    title: "Member IDs",
    what: "Every member gets a unique random 6-digit ID (leading zeros allowed). Chat and the website identify people by this number so nobody's phone number is exposed.",
    why: "FEATURES item 0 (session 008): \"a way of identifying people beyond phone/email.\" IDs freed by an account merge are tombstoned for a full year before they can be reissued — so a recycled number can't inherit someone else's reputation or conversations.",
  },
  "users.verified": {
    title: "The green check",
    what: "Grant or revoke ✓ Verified here — nowhere else, and there is deliberately no self-serve path. It shows on the ad page, the member's account, and in chat.",
    why: "FEATURES item 7 (session 008): the check means a human vouched for a real, known buyer or seller. Perks for verified members are deliberately unbuilt — the mark is the foundation, and it's also the enforcement seam for the long-term plain-community-membership vision (session 011, LONG_TERM_VISION.md).",
  },
  "users.ratings": {
    title: "Where ratings come from",
    what: "Star averages here and on ad pages come only from CONFIRMED sales: a seller texts SOLD, names the buyer's phone number, and then each side may RATE 1–5 the other — once per ad, matching parties only.",
    why: "FEATURES item 2 (session 008). Store-enforced matching is what makes the stars mean something: nobody can rate a stranger, so \"rated ★ 4.8 by 5 confirmed buyers\" is real.",
  },
  "users.starterCredit": {
    title: "The starter credit",
    what: "New members get a one-time dollar grant (amount set on Settings) — but only when they post their first ad, not when the account is created. \"Granted\" here means it already fired and never fires again.",
    why: "\"Every new account ships with $150 ad credit\" (session 016, replacing the session-001 three-free-passes grant when pricing moved to dollars). Deferring the grant to the first post was a session-005 user decision: a number that only subscribes or lurks mints zero liability.",
  },
  "users.credits": {
    title: "Adjust balance (and why the note is required)",
    what: "The balance is an append-only ledger in dollars: every grant, purchase, spend, and refund is a line, and the balance is the sum. Adjusting requires a non-zero dollar amount AND a note (\"phone order,\" \"check #204\") — the note is the audit trail. It is SILENT: the member is never texted or emailed about a balance change made here.",
    why: "Money histories should be append-only (a bug can't silently overwrite a balance, and you can always see exactly what happened) — same session-001 log-everything ethos as the message log. Cash or check payments go through here, deliberately outside Stripe — the session-016 decision: \"they can send a check after a phone conversation.\"",
    gotchas: "Nothing on this panel messages the member except \"Text them the link\" (a checkout link, which is the whole point of that button) and Add a member (which sends the invite). Billing a saved card, keying a card into checkout yourself, and adjusting the balance are all silent — the member sees the new balance when they reply BAL or open their account page.",
  },
  "users.phoneOrder": {
    title: "Phone order",
    what: "A caller pays by card: bill the saved card on their verbal OK (double-click-safe) for a preset or custom amount (custom runs $1–$5,000, the same fat-finger ceiling as Adjust balance; the custom box wins when both are set), or collect a card — open Stripe's checkout here and key it in as they read it, or text them the link. The money lands automatically; the card is saved so their future ads can top up automatically.",
    why: "FEATURES item 29 (session 011): a review of the payment system found everything existed EXCEPT call-in card capture — and callers who can't text a smartphone are exactly this audience. The card number goes straight into Stripe and is never seen or stored by this site.",
    gotchas: "The pay-by-phone keypad service (FEATURES item 31, under pay-by-phone/ in the repo) is the PCI-safe upgrade — the caller keys the card themselves and nobody ever hears it. Since session 016 the app ADOPTS an IVR-saved card automatically (it searches Stripe by the caller's phone and stamps the member's customer id) — so once that service is deployed ON THE SAME STRIPE ACCOUNT, a call-in card just shows up here as \"Card on file\" and auto top-up works. The service itself still needs its own Twilio number + PCI Mode setup per pay-by-phone/README.md.",
  },
  "calls.list": {
    title: "The call log",
    what: "Every call to the card line: when it came in, who called (linked to their account), how long they stayed on, and what came of it — answered by you, reached the menu, saved a card, card failed, or left a voicemail. Voicemail links open the audio in Twilio.",
    why: "\"I want to know when someone calls, how long they stay on the call and who called\" (user, session 016) — before this the only record was Twilio's console. Rows are written by /api/voice as the call happens; the authoritative total length arrives from Twilio's status callback after the caller hangs up, so a call still in progress shows the bridged-conversation time or nothing at all.",
    gotchas: "Needs migration 9972_call_log.sql. Without it the page is simply empty — logging never blocks a call in progress, so an unpasted migration costs history, not phone service. Total-length figures only appear if the number's \"Call status changes\" webhook points at /api/voice?step=status.",
  },
  "users.merge": {
    title: "Merge / link identities",
    what: "A PHONE does a full merge: ads, money, strikes, saved card, and subscription state move to this account; the other account is deleted; its message history stays under the old number in the log (never rewritten). An EMAIL links the address here — the member then gets both editions.",
    why: "Built in session 007 when real signups made duplicates real (the same person texting in and signing up by email). The user's call: SMS + email identities are one person; a phone means full merge.",
  },
  "users.moderation": {
    title: "Strikes and the posting ban",
    what: "Strikes count rejected-for-violation ads; at three, posting is banned automatically. Both are editable here — set strikes, lift or impose the ban. A ban stops posting/selling only; browsing and buying still work.",
    why: "Session-001 founding rules: \"If they offend 3 times, they're banned … I want to be able to reverse bans on the admin portal.\"",
  },

  /* ---------------- Subscribers (/admin/subscribers) ---------------- */

  "subscribers.list": {
    title: "Reading this list",
    what: "Everyone currently receiving digests, newest first. The date is when the CURRENT subscription started — a STOP clears it, a later re-subscribe starts fresh.",
    why: "Built in session 007, the day real SMS went live, so \"who exactly is getting this\" always has an answer. The email edition is confirmed opt-in (the address only counts after its confirmation link is clicked — that's what keeps the sending domain's reputation clean).",
  },

  /* ---------------- Messages (/admin/messages) ---------------- */

  "messages.log": {
    title: "The audit log",
    what: "Every message in and out, forever: commands and replies, each subscriber's copy of every digest, MMS attachments (the 📷 links), and — since the chat rebuild — every on-site chat message. Filter by number to reconstruct any conversation.",
    why: "A founding order, verbatim: \"I want all communication gets logged in an audit trail. I want absolutely every message logged\" (session 001). Chat joining the log was a documented stance reversal (session 009): reports can't be judged without reading the conversation. This log is the forensics record — it is deliberately never trimmed or rate-limited.",
    gotchas: "A reply shown here proves the app SENT it, not that the carrier delivered it. For delivery truth, use SMS diagnostics (/admin/sms-diag) — the session-007 outage looked exactly like \"replies sent\" here while nothing real existed.",
  },

  /* ---------------- Settings (/admin/settings) ---------------- */

  "settings.pause": {
    title: "The two emergency stops",
    what: "PAUSE ADS stops ads going out — approved ads queue and ride the moment you resume, nothing is lost. PAUSE REPLIES stops member-facing messages that are NOT ads (command replies, PIC pictures, moderation notices) while the ads keep flowing. They are independent; use either or both. Sign-in codes, alerts to you, and the outage notice itself are never stopped.",
    why: "Reworked in session 016 from a three-way switch (off/partial/full). The user's reasoning: a wobble in the account plumbing is no reason to go silent on the ads — \"I want the ads still to go off\" — and an operator in a hurry should not have to work out which of three modes matches the failure.",
    gotchas: "Turning either switch ON TEXTS EVERY SUBSCRIBER a technical-difficulties notice — real money and real attention, so flip it deliberately. Turning it back off is silent. The notice is sent once, on the off→on edge, so re-saving an already-paused switch never re-texts anyone.",
  },
  "settings.underAttack": {
    title: "UNDER ATTACK mode",
    what: "One switch, four levers: stop replying to unknown/gibberish texts, skip new-subscriber catch-up, auto-tighten the per-number and service-wide reply caps, and throttle ALL outbound to the per-minute ceiling below. Pair it with the blocklist.",
    why: "Session 004: designed for a spam flood or a hostile actor, where each lever alone is too slow. The abuse suite (sessions 005–006) verified the caps hold under sustained hammering — worst case one number costs about $0.58/hour in replies, and this mode cuts that further.",
  },
  "settings.costs": {
    title: "Ad pricing",
    what: "What a text ad and a picture ad cost, in dollars. Changes apply immediately, to SMS and web posting alike (one price, both lanes — a session-008 decision).",
    why: "Dollar pricing arrived in session 016 after a competitor-pricing review (their sheet: $65 with pictures, $45 text-only in print) — the user's decision: \"$45 text / $60 picture,\" replacing the credit system outright. The profitability model (docs/profitability.md, session 005; sheet in docs/pricing.md) shows a $45 ad clears its delivery cost at any plausible list size — the pricing bet is conversion, not cost.",
  },
  "settings.webAddon": {
    title: "The website-listing add-on",
    what: "The extra dollars a WEBSITE listing costs on top of the ad price. At 0 (the launch value) every ad lists on the website automatically, free. Above 0: web posts buy it with a checkbox; SMS ads default to NOT listed.",
    why: "Session 016, the user's design: \"The +$15 is an additional charge … a photo ad on the website would be $60+15 … I'll initially offer those for free.\" The machinery shipped ready so flipping this one number turns the charge on.",
    gotchas: "Flip it only AFTER migration 9973 is pasted (it adds ads.web_listing). The SMS lane has no self-serve way to buy the add-on yet — that flow is a documented seam in docs/pricing.md; until it's built, an SMS seller who wants the website listing needs you to arrange it.",
  },
  "settings.starterCredit": {
    title: "The starter credit",
    what: "The one-time dollar grant every new member gets on their FIRST post (never at account creation). Set 0 to turn new-member free money off.",
    why: "Session 016: \"Every new account ships with $150 ad credit.\" At $150 that covers 3 text ads or 2 picture ads; the user's earlier \"3 free ads of any kind\" promise would need $180 (3 × the picture price). First-post-only is the session-005 anti-abuse rule — minted numbers that never post cost nothing.",
  },
  "settings.digestCap": {
    title: "Max ads per batch",
    what: "The FIFO cap on how many queued ads ONE batch carries — one batch text, or one email edition; the overflow rides the next one. Sponsor lines ride OUTSIDE this cap.",
    why: "From the founding spec (session 001), when it capped a digest's size in SMS segments. Session 016 briefly made it a pure throughput bound (one text per ad); session 018 brought batching back, so it is once again the literal length control on the message subscribers receive.",
    gotchas: "Not a daily limit and never a reason an ad doesn't send — a capped batch just leaves the rest queued for the next one. Remember it caps PICTURES too: a batch of 10 picture ads is 10 picture messages to every subscriber.",
  },
  "settings.batchTriggers": {
    title: "When a batch goes out",
    what: "Two triggers, whichever comes first: enough ads are waiting (the count), or the oldest has waited long enough (the timer). Defaults are 3 ads / 60 minutes. Setting one to 0 turns that trigger off; setting BOTH to 0 falls back to sending whatever is waiting, because a paid ad must never be stranded by a typo here.",
    why: "The user's session-018 words: \"I'll run the batch every hour, or as soon as I have 3 or 4 ads.\" The count is what makes a busy morning feel live; the timer is what stops a single ad sitting all day waiting for company it never gets.",
    gotchas: "Both triggers only ever fire inside the send window, so nothing goes out overnight — the overnight queue leaves as one batch when the window opens, because by then the oldest ad has long passed the timer. Approving an ad checks the count trigger immediately, so approving the third ad sends the batch there and then.",
  },
  "settings.saturdayClose": {
    title: "Saturday's early close",
    what: "The hour SMS really stops on a Saturday, end EXCLUSIVE like the published window — 5pm means the last Saturday text leaves at 4:59pm. Every other day runs to the published close. Set it to the same hour as the published close to drop the shortening and run Saturday like any weekday.",
    why: "Session 020, on community advice the user brought back: \"9pm is way too late to send ads on Saturday nights, and 6 would work for the week days.\" A Plain household's Saturday evening runs into the rest day. The user went one step further than the advice — \"I'll publish that the ads run 7am to 6pm Monday to Saturday but I want to secretly stop sending ads by 5pm on Saturdays\" — so the shortening is REAL but UNPUBLISHED: no member-facing page, welcome text or compliance line quotes it, and the approval text drops its \"we text between…\" clause in that hour rather than contradict itself.",
    gotchas: "It can only ever make Saturday SHORTER. A value later than the published close is pulled back to it, because sending past the published hours would break the promise the compliance copy makes to every subscriber — the one thing this setting must never do. It is an SMS rule only: the email edition has no send window (an inbox has no bedtime) and still composes at its usual times.",
  },
  "settings.maxChars": {
    title: "Max ad length",
    what: "One cap for both lanes: texted ads and web-posted ads (the web form shows a live counter).",
    why: "Session-008 user decision: web ads get the SAME cap the SMS path enforces, because the exact text rides the SMS digest either way — a long web ad would cost real segment money.",
  },
  "settings.expiryDays": {
    title: "Website listing length",
    what: "How long an approved ad stays live ON THE WEBSITE before expiring (you can relist an expired ad from the Ads tab). It is also how long PIC keeps answering for that ad, since PIC serves what the website still holds.",
    why: "From the founding spec. Worth knowing: Supabase originally never expired ads at all — live-on-site-forever — until the session-005 audit caught it and wired expiry into the cron.",
    gotchas: "This is NOT how long the text runs. Since session 016 the text goes out exactly once, the moment the ad is approved — nothing re-sends it, so changing this number never changes what anyone receives by SMS. It only moves the website's expiry date and the PIC window.",
  },
  "settings.replyCaps": {
    title: "The three reply caps",
    what: "Per-number replies/hour (past it, that number gets silence for the hour — inbound still logged), per-number pictures/hour (a burst limit), and a service-wide replies/hour circuit breaker. Digests never count against these; STOP is always answered.",
    why: "Built in session 002, before launch, because every reply costs money and an attacker texting the number thousands of times must hit a ceiling. Verified live in dev: 22×HELP → exactly 20 replies, then silence, STOP still confirmed.",
  },
  "settings.picQuota": {
    title: "PIC allowance & bank",
    what: "Each number gets N picture pulls per Eastern day; unused pulls bank up to the cap, like a sinking fund. 0 turns the daily quota off (the hourly cap still applies). Denials are a friendly text, deduped.",
    why: "The user's session-006 ask, numbers included: \"how many pulls a number gets per day and how many they can bank … e.g. 3/day, bank 20.\" MMS is the priciest send, and PIC pulls are free to the buyer — this is the real cost control. The abuse suite proved it: a 5-day PIC hammer got exactly 3 MMS/day; two idle weeks then a burst delivered exactly the bank cap.",
    gotchas: "A mistyped ad number never burns a pull (the quota is charged only when a photo is actually about to send). With the default ON, a photo-heavy buyer hits the wall — raising the daily number or the bank is a live product decision, flagged since session 006.",
  },
  "settings.reveals": {
    title: "Number look-up metering",
    what: "How many \"Show number\" reveals a signed-in member gets per day, the bank cap, and the Insights flag threshold. Re-viewing an already-revealed ad is free. 0 turns metering off.",
    why: "The user's session-009 realization: \"anyone could create a web profile and log in to start scraping numbers out.\" Numbers never render in the page code at all; this meter is why one burner account can't walk the whole list. Chat stays unmetered on purpose — messaging a seller is never the thing to throttle.",
  },
  "settings.categoryThrottle": {
    title: "Category confirmation throttle",
    what: "After N confirmed category toggles/LIST checks in an hour, the member gets one \"changes still apply\" notice and further confirmations go silent for the hour — the toggles STILL apply, they just cost nothing outbound. 0 = unthrottled.",
    why: "The user's session-009 worry, verbatim: \"if people just text gibberish, or say horses endlessly, it could spike our usage. I need a way of preventing that but still allowing legitimate use.\" Silent-but-applied was the answer: abuse costs nothing, legitimate use always works.",
    gotchas: "One exception is never silenced: the \"you're not getting any ads now\" warning when someone removes their last category — going quiet there would strand them dark without knowing.",
  },
  "settings.globalBreaker": {
    title: "The service-wide breaker",
    what: "The most command replies the whole service will send in an hour — the ceiling on reply spend if many numbers attack at once. Digests have their own budget and never count here.",
    why: "Session 002: the worst case isn't one abuser, it's a coordinated flood. This is the circuit breaker for that day.",
  },
  "settings.segmentBudget": {
    title: "The digest segment budget",
    what: "Digests are billed per SMS segment (~153 characters), and a broadcast is segments × subscribers — the biggest bill in the system. This caps billed segments per ROLLING 24 hours; at the cap, digest sending pauses, rows wait, you get one email, and it resumes as the window frees room. 0 pauses digests entirely.",
    why: "The session-003 circuit breaker. Two deliberate details: the window rolls (a midnight-reset budget can be gamed at the boundary), and 0 means OFF-as-in-paused, never unlimited (fat-fingering a 0 must fail safe). The alert fires exactly once per trip, not every 5 minutes.",
    gotchas: "As the list grows this number needs deliberate raising — the budget is doing its job when a digest waits.",
  },
  "settings.picAbuseFlag": {
    title: "Excessive-picture flag",
    what: "The threshold for the red \"Excessive\" flag on Insights' picture table. A flag, not a block — the quota above does the enforcing.",
    why: "Session 003: the human-attention threshold, so a scraper-ish pattern gets your eyes before it needs your hand.",
  },
  "settings.throttlePerMin": {
    title: "Under-attack throttle",
    what: "A global sends-per-minute ceiling enforced ONLY while UNDER ATTACK mode is on; excess sends defer to the next minute rather than dropping.",
    why: "Session 004: the flow-rate valve for an active incident — everything still eventually sends, just never in a flood.",
  },
  "settings.slots": {
    title: "Digest send times",
    what: "The hours (Eastern) digests compose; the email edition uses the same times. The Digests tab shows the next occurrence.",
    why: "Remember two session findings before touching this: slot count is nearly COST-neutral (each ad broadcasts once a day regardless — session 003, the user's own catch), and [7, 12, 16, 20] matches every registered 10DLC word if faster delivery is wanted (session 011's standing offer). What slots must never exceed: the registered \"up to 4 digests/day\" promise.",
  },
  "settings.banner": {
    title: "The homepage banner",
    what: "Operator-set text at the top of the homepage, with a link that must point at a page on this site. Clear the text and save to hide it.",
    why: "FEATURES item 30 (session 011), built for running sales and announcements. On-site links only, because the walled-garden rule applies to your own banner too.",
  },
  "settings.wordFilter": {
    title: "The word filter",
    what: "Two lists — flag-only words sort their ads to the top of review; auto-reject words bounce instantly, nothing charged, no strike, logged for the audit trail. The page opens showing COUNTS ONLY: add and remove by typing the words that change. \"Show the full list\" brings up the whole thing as editable text when you want it. Matching is whole-word and ignores capitals, so \"gun\" catches Gun but not shotgun; short phrases work too.",
    why: "Session-001 founding ask, verbatim: \"a small rejection system to analyze for specific words … so I can add/remove words as I choose.\" Auto-reject charges nothing deliberately — a robot's judgement shouldn't cost a seller money; only your reject-violation does that. It moved off Settings into its own tab in session 016 (user decision) because the one-word-at-a-time widget made a real list unmanageable: you could not see it whole, paste one in, or move six words between lists without twelve clicks.",
    gotchas: "THE LIST IS HIDDEN BY DEFAULT AND THAT IS THE POINT (session 019, the user's words: \"if I load the webpage on my work computer, I'll get all kinds of flagged because of the bad language\"). A filter worth having is several hundred obscene words; rendering them all handed that screen to whatever workplace web filter was watching the browser. The words go from the database to the server and stop there — only counts reach your browser unless you click Show. Nothing remembers that click, so the page always opens hidden again. In the REVEALED view the boxes ARE the filter: a word you delete from a box stops being filtered when you save, and emptying both needs the confirm tick. That Save form only exists in the revealed view — beside empty boxes it would be a one-click way to wipe the whole filter. Add and Remove can never shorten the list by accident: Add is append-only, and Remove reports back how many of the words you typed weren't actually there.",
  },
  "help.reports": {
    title: "Help reports",
    what: "Filed by the \"I need help!\" button in the corner of every page. Each report carries the page, whether they were signed in and as whom, whether we hold an email for them, their browser, screen size and timezone, where they came from, and the last error the page threw — plus anything they chose to type.",
    why: "Session 016, the user's ask: capture \"all the data I can possibly get, this way I can pro-actively get fixes in place.\" The reason the typed note is OPTIONAL is the whole point of the feature — a stuck member usually cannot describe what went wrong, so the diagnostics describe it for them. Requiring a sentence first would lose exactly the reports worth having.",
    gotchas: "Every report ALSO emails you the moment it is filed (user decision), so this page is for working through them, not for finding out. Watch for patterns rather than individual reports: three from one page in an hour is a bug even when no single one reads like one. Identity is read server-side from the session cookie and never from the form, so a report cannot claim to be from someone else. If migration 9965 isn't pasted the button still works and still emails — reports just aren't collected here.",
  },
  "users.table": {
    title: "The members table",
    what: "Every member as one spreadsheet: numbers, emails, dates, ads posted and sold, money spent, added and on hand, texts in, last active, line type, card on file, strikes, bans, blocks and more. Drag a heading's ⠿ handle to move a column, drag the line between two headings to resize, type under a heading to filter, click a heading to sort, and save a named layout for yourself.",
    why: "Session 016, the user's ask for a \"database table viewer like screen\" — the search-one-member page answers \"what about this person\", and this answers \"who are my members\": who spends, who has gone quiet, who signed up and never posted. Rebuilt as a real grid in session 019 on the user's follow-up: \"remove the horizontal scrollbar … like a pervasive database viewer table or excel.\"",
    gotchas: "The columns are always refitted to the width of the screen, so dragging one wider takes the space from its neighbour rather than pushing the page sideways — that is why there is no horizontal scrollbar. It comes back only if you tick on more columns than can fit at their minimum width, and the page says so when that happens. Long values are clipped with an ellipsis; hover a cell to see it in full. It is one database VIEW over live data, so every number matches its source exactly, and filtering and sorting happen in the database rather than in the page — which is what keeps it quick as the list grows. Money filters are in DOLLARS, the way the column reads, and filter boxes take >= <= > < = in front of a number or a date. Columns, order, filters and sort all live in the URL, so a layout can be bookmarked or handed to someone else; widths live in your own browser. Saved layouts are per operator, and saving over a name replaces it.",
  },
  "users.refundable": {
    title: "Refundable vs the balance",
    what: "The balance is what the member can spend. REFUNDABLE is the part of it that was ever their own money — what they paid by card, cheque or cash, less anything they have already spent past their free credit, less anything already sent back. It is the most that may ever go back to their card.",
    why: "The user's session-019 ask: \"prevent people from depositing 20 and then getting refunded for the free ad credit.\" Someone who adds $20 and collects the $40 starter credit has a $60 balance, of which $20 was theirs. Refunds are done by hand, so nothing but memory stopped $60 going back for a $20 payment. Now the page does the arithmetic and the payout form refuses to exceed it.",
    gotchas: "Spending eats the GIVEN credit first, deliberately — so a member who posts one ad still has their own money refundable, rather than being told their $20 is gone while $40 of our free credit sits in the account. Granted credit is never refundable as cash at any point, for any reason: it never touched their wallet. Rows written before migration 9957 are unclassified, and both defaults err toward refunding LESS — an old credit counts as given, an old debit counts as already paid out.",
  },
  "users.adjustKind": {
    title: "Why the adjustment asks what kind it is",
    what: "Payment received = real money arrived (a cheque, cash, a phone order) and stays refundable. Courtesy credit = a make-good you are giving away, which never becomes refundable cash. Money sent back = a payout to their card, entered as a negative amount and capped at the refundable figure.",
    why: "Before migration 9957 all three were written as one kind, `adjustment`, told apart only by the note you typed. That made two questions unanswerable: how much cash has actually been collected (Insights counted only Stripe, so every cheque was invisible), and how much of this member's balance may be refunded.",
    gotchas: "Pick the right one at entry time — the ledger is append-only, so a mis-classified row can only be corrected by another row, not edited. If you are unsure, courtesy is the safe choice: it never inflates what can be refunded. A payout that would exceed the refundable figure is refused outright rather than warned about.",
  },
  "users.archive": {
    title: "Archive vs delete",
    what: "ARCHIVE sets a member aside — off the website, out of the subscriber lists, no ads going out, queued sends dropped — without destroying anything. Their balance, ads, ledger and history stay intact, and restoring returns them exactly as they were. DELETE (the Purge tab) removes them and everything they touched, with no archive and no restore.",
    why: "The user's session-016 ask for both: \"If I delete them they're gone. I also want an archive feature. If I archive them, I can restore them.\" They are two different tools on purpose. Archive is for a real person — someone who asked to be taken off, a seller gone quiet, an account you want out of the way while you work out what is going on. Delete is for your own test data.",
    gotchas: "Archiving does NOT refund, does NOT text them, and does NOT touch their ledger — their money is still their money, which is the whole point of doing it with a flag instead of a delete. Queued sends ARE dropped, so an archived member's ad can't fire when the queue next drains; restoring doesn't put those back, but a live ad rides the next pass on its own. Reach for archive first with anyone real: a delete cannot be walked back.",
  },
  "purge.purpose": {
    title: "Purging a member",
    what: "Deletes a member and everything attached to them — ads, pictures, logged texts and emails, ledger entries, conversations, number look-ups, ratings, sales, strikes, events, calls, queued sends — then the account. One transaction: it either all goes or none of it does.",
    why: "Session 016, the user's problem: pre-launch testing left real rows behind and Insights was reading them. Nothing on Insights is a stored number — every figure is derived live from these rows — so there was no total to edit. Offered a cutoff date and per-row manual adjustments instead, the user chose to purge, which is the only option that makes every figure right everywhere at once and keeps them reconcilable.",
    gotchas: "CANNOT BE UNDONE — no archive, no restore. It is the one place the append-only ledger rule is deliberately suspended, and it is for clearing your OWN test data, not for dealing with a member you have fallen out with: block or ban them instead, both of which keep the record. Preview always runs first and the word DELETE has to be typed; changing the number after previewing drops you back to a fresh preview rather than purging whoever is in the box. Sent digests keep their numbering and history, the member's six-digit id is retired for a year rather than reused, and blocked numbers stay blocked.",
  },
  "settings.pacedRelease": {
    title: "Spreading a backlog",
    what: "When more than N ads are waiting, each one gets its own release time, spaced by a random gap between the shortest and longest you set. Below N nothing is spread and ads go the moment they're approved — spreading is what happens when something went wrong, not the normal path.",
    why: "Session 016, the user's decision, prompted by the launch hold: ads pile up whenever the queue can't move — an ads pause, an outage, overnight, a tripped budget — and the drain used to empty everything the instant the hold lifted. A dozen stored-up ads meant every subscriber getting a dozen texts back to back. Bad for a first impression, and on a new 10DLC campaign a sudden burst is exactly the pattern carriers act on. The gap is RANDOM because a metronome is itself a machine signature.",
    gotchas: "Do the arithmetic before trusting it: 20 ads at a 15-minute average is five hours, so a big backlog may not clear inside one day's send window — what doesn't go today goes tomorrow. Setting the threshold to 0 turns spreading off entirely. A max below the min is raised to meet it rather than treated as a negative gap, which would dump the whole backlog at once — the exact thing this prevents.",
  },
  "settings.lookup": {
    title: "Number checks (VoIP policy)",
    what: "Asks Twilio what kind of line a number is — real mobile, landline, business VoIP, or an app number like Google Voice or TextNow — the first time it matters, and remembers the answer. The three switches below decide what an app number may still do. Costs about half a cent per member, once.",
    why: "Session 016, the user's question: \"how do we make sure they use a real number?\" Signing up proves only that a number can receive one text, so an app number passed exactly like a real cell phone. That put the launch offer at risk — 200 slots at the starter-credit amount — and let a burner account harvest sellers' numbers through website look-ups.",
    gotchas: "TEST IT before relying on it — there is a \"Test a number check\" tool right below the switches. Because the policy fails open, wrong credentials look EXACTLY like nobody having used an app number yet: both are silence. Checking a number you know is the only way to tell a working check from one that has been failing since the day you set it up. It deliberately does NOT block VoIP signups: blocking costs real customers, and a community running on shared phones and answering services would lose several. It withholds the free credit and the look-ups instead, so the attacker's return goes to zero while a real person on a VoIP line trades normally. BUSINESS VoIP is treated as a real number — only app-style lines are affected. Needs TWILIO_ACCOUNT_SID set; with the switch off nothing is looked up and nothing changes. Every failure — outage, bad credential, pending migration — reads as \"allow\", and a failed check is never remembered, so an outage costs one retry rather than mislabelling a member forever.",
  },
  "users.lineType": {
    title: "A member's line type",
    what: "What Twilio said this number is, cached from the first check. \"Not checked\" means the number checks are off, the lookup hasn't been needed yet, or it failed — all three mean the member is treated as real.",
    why: "Session 016. It answers \"is this a person or a burner?\" when you're looking at a suspicious account, and it is what the VoIP policy on Settings reads.",
    gotchas: "An app-number badge is not proof of bad faith — plenty of people use one as their only number. It is a reason to look, not a verdict. Blocking is still your call.",
  },
  "settings.blocklist": {
    title: "The blocklist",
    what: "Blocked numbers are dropped at the door: no reply, no account, no charge, no digests — the inbound text is still recorded. Block from Insights (ranked) or by hand here; unblock any time.",
    why: "Session 004's operator-safety batch. Log-then-drop keeps the forensics record intact — the audit ethos applies even to people we ignore.",
  },

  /* ---------------- SMS diagnostics (/admin/sms-diag) ---------------- */

  "smsdiag.purpose": {
    title: "Why this page exists",
    what: "Ground truth for \"did it actually send?\" — it asks Telnyx directly with the account's own key, including for messages the portal's reports never show (a send stuck queued or held never finalizes, so it never appears there).",
    why: "Born in the session-007 outage: texting the number did nothing, and the cause was TWO stacked failures — a missing migration 500'd every inbound, and the missing TELNYX_API_KEY silently flipped outbound to a dev echo, so the Messages log showed replies \"sent\" while nothing real existed. This page is the tool that would have caught both in minutes.",
  },
  "smsdiag.testSend": {
    title: "The test send",
    what: "Sends one real SMS through the app's exact payload, then fetches the message's live status by id. Read to[].status (delivered vs sending_failed/delivery_failed) and the errors array — a 4xxxx code there is the carrier's stated reason.",
    why: "Built during session 007 because the Telnyx portal only reports finalized messages — a send stuck mid-10DLC-provisioning simply vanishes from every report, which reads as \"my messages disappeared.\"",
  },
  "smsdiag.rehost": {
    title: "Photo attachment test",
    what: "Paste an inbound MMS media URL (from a 📷 link in Messages) and this runs the exact re-host + validation pipeline a picture ad goes through, reporting the outcome.",
    why: "From the session-007 attachment policy (user decision): only byte-proven jpg/png/gif/webp are accepted — headers and file extensions are never trusted — and a photo that can't be saved posts the ad as TEXT and tells the seller (never a silent drop; that honesty rule dates to the user's own picture ad silently losing its photo).",
  },
  "smsdiag.selftest": {
    title: "Upload self-test",
    what: "Generates a fresh image on the server, pushes it through the REAL photo-storage pipeline (including the corruption read-back guard), then independently re-downloads and verifies it byte-for-byte. One click answers \"are uploads healthy right now.\"",
    why: "Session 014's corruption incident: Vercel's function runtime was mangling Node Buffer uploads (high bytes → EF BF BD, the UTF-8 replacement character), corrupting stored collages. The fix — ArrayBuffer bodies plus a post-upload read-back that deletes any corrupt object — lives in the one upload choke point every image uses; this button proves it end-to-end on the live deployment.",
    gotchas: "A photo stored corrupt BEFORE the fix stays corrupt at its old URL forever — this tests new uploads, not old objects. Check old ones with \"Check a stored photo.\"",
  },
  "smsdiag.checkPhoto": {
    title: "Check a stored photo",
    what: "Paste one of our own storage URLs and the server fetches and verifies everything: HTTP status, served headers vs the actual bytes, format signatures, and a full image decode. Clean verdict = the stored file is good and the problem was that browser or its cache; a problem names the failing layer.",
    why: "Built in session 014 for the \"image contains errors\" report. It's also the tool that CRACKED that case: the checker showed the stored collage's bytes were efbfbd… repeated — a JPEG lossily round-tripped through a UTF-8 string — which pinned the corruption to the upload transport in Vercel's runtime and led straight to the fix.",
  },

  /* ---------------- Cross-cutting concepts ---------------- */

  "concepts.migrations": {
    title: "Migrations, dormant features, and /api/health",
    what: "Database changes are pasted by hand into the Supabase SQL Editor (never pushed by tooling), numbered DESCENDING — the lowest-numbered file under supabase/migrations/ is the newest, and the next one takes (lowest − 1). Every migration is written re-runnable, so pasting one twice is always safe. Until a feature's migration is pasted, the feature sits dormant-but-safe (hides, refuses politely, or warns — never a crash) and /api/health (with CRON_SECRET) probes each migration by name.",
    why: "The discipline is scar tissue: prod auto-deploys main, so code reading a column that isn't pasted yet used to 500 the whole admin (session 003), missed the 4 PM digest (session 007), and ate every inbound text (session 007's outage cause #1). Descending numbering is the user's own convention (adopted session 009); graceful degradation + health probes became standing policy after being bitten twice in one day.",
    gotchas: "Drift is sneakier than absence: migration 9980 was pasted mid-session then AMENDED later, so prod held a partial version for weeks (caught session 014). Health probes now check multiple columns per file — but when in doubt, re-paste the whole file: re-runnable means re-pasting is always safe.",
  },
  "concepts.chokePoint": {
    title: "The outbound choke point",
    what: "Every text and email the app sends goes through one gate that enforces the pauses, the blocklist, UNDER ATTACK throttling, and hourly caps, and strips non-GSM characters so no send silently costs Unicode rates. Sends are classed (reply, picture, digest, operator) — operator alerts to YOU are never blocked.",
    why: "Built in session 004 so a safety control set on Settings is actually universal — before it, ten separate send sites each had to remember the rules. \"Reply-class\" in feature notes means exactly this: that send respects pause/blocklist/caps like any reply.",
  },
  "concepts.ledger": {
    title: "Why money is append-only",
    what: "Balances are never edited — every grant, spend, purchase, and refund is a ledger line (stored in cents since the session-016 dollar pricing), and the balance is the sum. Refunds and purchases carry a reference key, so a retried webhook or a double-click can't grant or refund twice.",
    why: "Append-only money is the same ethos as the message log: you can always see exactly what happened, and a bug can't silently overwrite a balance. The idempotent references have caught real races — Stripe replays, reject-vs-delete races, upgrade-charge retries (sessions 002, 009, 013).",
  },
  "concepts.et": {
    title: "The service clock is Eastern",
    what: "Digest slots, daily quotas (PIC pulls, reveals), and \"per day\" everywhere mean Eastern Time — where the community lives — not UTC and not the server's clock.",
    why: "Founding audience decision. The date math is kept in one pure module with unit tests pinning both 2026 daylight-saving transitions (session 004) — the classic way a 7 AM digest silently becomes 6 AM is exactly the bug those tests exist to stop.",
  },
  "concepts.devVsProd": {
    title: "Why tests can miss prod-only bugs",
    what: "The unit and abuse suites run against a file-based store, not Supabase — so database-only failures (a missing migration, a type mismatch inside an RPC) pass every test and only surface in prod.",
    why: "Learned the hard way twice: the credit-charge outage (a text-vs-enum cast inside the spend RPC, session 011) and the collage corruption (Vercel's runtime mangling uploads, session 014) were both invisible to green test suites. Hence the belt-and-suspenders habit: /api/health probes, graceful degradation, read-back verification, and one real end-to-end exercise in prod after risky changes.",
  },
  "concepts.retrySwallow": {
    title: "The retry-swallow trap (fixed)",
    what: "Inbound texts are deduplicated by provider id BEFORE processing — so if processing then crashed, the carrier's retry found the message \"already handled\" and it was permanently eaten: the sender got silence.",
    why: "This trap explained the worst outages (sessions 007 and 011 — \"texting the number does nothing\"). Since session 011 the inbound path is hardened: a processing crash is logged and the sender gets one friendly deduped heads-up instead of silence. If a sender ever reports \"I texted and nothing happened,\" the Messages log plus the server logs now always have the story.",
  },
} satisfies Record<string, HandbookEntry>;

export type HandbookKey = keyof typeof ENTRIES;

export const HANDBOOK: Record<HandbookKey, HandbookEntry> = ENTRIES;

/** Entries grouped for the read-through view, in HANDBOOK_PAGES order. */
export function handbookByPage(): { label: string; href: string; entries: [HandbookKey, HandbookEntry][] }[] {
  const keys = Object.keys(ENTRIES) as HandbookKey[];
  return HANDBOOK_PAGES.map((page) => ({
    label: page.label,
    href: page.href,
    entries: keys
      .filter((k) => k.startsWith(`${page.prefix}.`))
      .map((k) => [k, HANDBOOK[k]] as [HandbookKey, HandbookEntry]),
  })).filter((page) => page.entries.length > 0);
}
