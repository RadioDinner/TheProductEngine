# FEATURES — the running feature list

Standing convention (user instruction, session 008): when the user adds a
feature to the feature list, append it here — keep the user's numbering, note
the session it arrived in, and track build status. This file is the list
itself; build details live in the session logs and HANDOFF.md.

| # | Feature | Added | Status |
|---|---------|-------|--------|
| 0 | **USER_ID** — a way of identifying people beyond phone/email: unique, random, 6-digit, never duplicated; ids freed by an account merge are not reused for a whole year | session 008 | **built** (migration 0014) |
| 1 | **Email-in extra ad pictures** — sellers email more pictures for an ad; the website listing shows them all; the email digest and SMS still carry only the one picture | session 008 | **built** (migration 0015) |
| 2 | **Profiles: confirmed buyer/seller ratings** — only confirmed parties can rate. `SOLD 1040` replies asking for the buyer's phone number; then invites `RATE 1–5`; the named buyer gets the same invitation to rate the seller | session 008 | **built** (migration 0016) |
| 3 | **Profile picture + pickup address** — settable by the member; the address is private to them, optionally shareable with a buyer they're in conversation with | session 008 | **built** (migration 0017) |
| 4 | **Chat** — on-platform messages between buyers and sellers, keyed on user ids, so nobody's phone number is exposed | session 008 | **built** (migration 0017) |
| 5 | **Digest numbers** — every digest carries a number, incrementing by 1 from 1; counter reset at build time | session 008 | **built** (migration 0018) |

## Item notes (decisions made while building — flag anything to change)

- **0 · USER_ID**: 6 random digits, leading zeros allowed (stored as text,
  `000000`–`999999`). Existing accounts are backfilled by migration 0014; new
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
  1 for the first digest composed after migration 0018 — past digests are not
  renumbered.
