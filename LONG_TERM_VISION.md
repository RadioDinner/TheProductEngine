# LONG TERM VISION — the long-range feature list

Standing convention (user instruction, session 011): this file tracks
**long-term vision features** — direction the product is heading that is
deliberately NOT on the immediate build queue. `FEATURES.md` stays the
immediate list; when a vision item is greenlit for building, move it there
(new number, "arrived from LONG_TERM_VISION") and leave a pointer here.
Don't build anything on this list unless the user asks.

The vision, in the user's words (session 011): make the exchange
location-specific, starting with Holmes County, and eventually "build this
system for Lancaster, Indiana, Harrisonburg, Big Valley PA, all the plain
communities — and eventually have people be able to submit a request for a
new area."

## V1 · Multi-area rollout — an exchange per plain community

One system, many location-specific exchanges. Holmes County, Ohio is the
first and the template. Target areas named by the user (session 011):

| Area | Notes |
|---|---|
| Holmes County, OH | Live today — the template every other area copies |
| Lancaster, PA | Largest plain settlement in the country |
| Northern Indiana | Elkhart–LaGrange / Nappanee country (user: "Indiana") |
| Harrisonburg, VA | Rockingham County Mennonite country |
| Big Valley, PA | Kishacoquillas Valley (Mifflin County) |
| …all plain communities | Long tail; opened by the request flow (V3) |

What's already in place: the schema has carried `county text not null
default 'holmes'` on the core tables since init, and digest idempotency is
already keyed `(channel, county, scheduled_for)` — the bones anticipated
this. What each new area actually needs when the time comes:

- Its own SMS number + 10DLC campaign (or an added number on the existing
  campaign — decide with the ops learnings from Holmes: campaign review
  took weeks and failed once; treat per-area provisioning as a repeatable
  playbook, started well before launch day).
- Area-scoped subscribers, ads, digests, categories, settings (slots,
  caps, pricing can differ per area), admin views filtered by area.
- Area-specific site surface (per-area homepage or subdomain), while
  accounts/credits likely stay global.
- A local review operator per area, eventually — manual review of every ad
  is the product's backbone and does not scale past a few areas alone.

## V2 · WhatsApp channel per area (Telnyx WhatsApp Business API)

User (session 011): a WhatsApp chat for the county alongside SMS — "a lot
of mennonites use it." Discovered lever: Telnyx (already our SMS provider)
offers the WhatsApp Business API on the same platform.

Facts verified 2026-07-20 (Telnyx product pages): the same Telnyx number
can carry SMS and WhatsApp; ~$0.0035/message + Meta passthrough fees;
managed through the same Mission Control portal / REST API we already use;
outbound marketing pushes (a WhatsApp digest) require Meta-approved
message TEMPLATES; free-form replies are allowed inside a 24-hour customer
service window after the subscriber last messaged.

Design notes for when this is picked up:

- WhatsApp becomes a third edition beside SMS + email: same digest
  composition, delivered as an approved template. The outbox/breaker
  machinery should carry it (a `channel` concept already exists).
- No 160-char segment economics on WhatsApp — pictures could ride digests
  cheaply there (unlike MMS), a real product advantage for picture ads.
- "A whatsapp chat for the county" may also mean a community group/chat,
  not just a broadcast — scope that with the user when greenlit.
- Compliance shifts from TCPA/10DLC to Meta Business verification +
  template review + WhatsApp Commerce/marketing policies; opt-in must be
  provable per Meta rules. Classifieds-style content needs a check against
  WhatsApp's commerce policy before committing.
- Audience fit: Mennonites (smartphone-carrying) on WhatsApp; Old Order
  Amish stay SMS/print — the two channels serve different ends of the
  plain spectrum, which is the point.

## V3 · Request-a-new-area

Public form on the site: "Want The Plain Exchange in your community?" —
collects area, contact, and interest. Enough requests from one area =
the signal to open it (V1 playbook). Cheap to build, valuable early: it
can ship long before multi-area does and quietly build the waiting list
that decides where V1 goes next.

## V4 · Carried future bones (pre-dating this file)

From the product rules ("bones exist, don't build unless asked"), kept
here so the long-term list is one place: per-county subscriptions (now
part of V1), premium ads, subscriber fees, `/CANCEL`. (Website posting,
once on that list, shipped as FEATURES item 9.)
