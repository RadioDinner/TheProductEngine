# Session 017 — 2026-08-20 — Google Analytics, and the `analytics/` folder

## Git posture this session (it changed twice — read this first)

The user is running **several sessions in parallel** in this repo today and is
sequencing merges by hand. The instructions, in order received:

1. Commit a folder named `analytics` **to `main`**, then create the branch.
2. After that, **change nothing outside the `analytics` folder** — so parallel
   branches cannot conflict on merge.
3. Mid-session override: commit what exists **to `main` now**, then **stop
   committing to `main` automatically**; the user will say when.

All three were followed. Nothing outside `analytics/` was modified — with one
deliberate exception, the session-log folder itself, which is named
`017_2026-08-20_google-analytics` rather than `017_2026-08-20` precisely so a
parallel session claiming 017 does not collide with it on merge.

**Standing at session end: do not push to `main` without being asked.** The
designated branch `claude/google-analytics-setup-tjm2p5` holds everything.

### Commits

| Where | Hash | What |
| --- | --- | --- |
| `main` | `d2b9167` | Add the `analytics/` folder — one home for how we measure the site. |
| `main` | `2c32247` | Stage the GA4 library: config, event catalogue, ids, server sender. |
| branch | `8b31f01` | The browser tag, the server helpers, the SQL, and 75 checks. |
| branch | (this) | The six documents and the folder index. |

A note on the repo state: the container's clone was **shallow**, which made
`main` and the working branch look like unrelated histories (`git merge-base`
failed, `git log` showed 80 commits on one side and 50 on the other). They are
not unrelated — `git fetch --unshallow` resolved it, and the branch turned out
to be `origin/main` minus one commit. Worth knowing: the same symptom will
appear in any future session in this environment, and the diagnosis is one
command.

## What shipped

`analytics/` — a complete, staged, **inert** Google Analytics 4 implementation
plus the reasoning around it. Nothing in the app imports any of it, so the site's
behaviour is byte-for-byte unchanged.

- Six documents: the audit of what we measure today, the measurement plan, the
  GA4 console setup, the wiring steps, the privacy conflict, and the operating
  routine.
- Seven code modules under `src/`: config, the event catalogue, salted identity,
  the browser emitter, the Measurement Protocol sender, one named helper per
  business moment, and the tag component for `app/layout.tsx`.
- `sql/first-party-upgrade.sql` — referrer, campaign and unique-visitor counting
  in our own tables, cookieless. Staged **unnumbered** on purpose (see below).
- `test/analytics.test.mjs` — 75 checks.

Verified: `tsc --noEmit` clean, `next build` clean, repo suite **846/846**
unchanged, analytics suite 75/75.

## Directional decisions

1. **A classified ad is a "listing" in every GA event name.** GA4 reserves
   `ad_click`, `ad_impression`, `ad_exposure` and `ad_query`, and discards
   events using them with a `204` that looks like success. This product's most
   important events would have vanished silently. Enforced by a test.

2. **Server-side first, browser tag second.** Most members never load a web
   page. The Measurement Protocol path covers everyone and needs no consent
   decision; the browser tag is the addition, not the foundation. This inverts
   the usual order and is right for this audience.

3. **Members are a salted SHA-256 of their phone, never the phone.** Off-web
   events get a `client_id` *derived from that hash* rather than a random one —
   a random id per text would turn one seller into hundreds of one-event users
   and destroy every engagement metric in the property.

4. **GA is the behavioural layer; Supabase remains the record.** Money,
   delivery, quotas and anything older than GA's 14-month retention stay
   first-party. When the two disagree, Supabase is right.

5. **The privacy policy conflict is real and must be resolved before the tag
   ships.** `/privacy` states in writing: "No advertising cookies, **no
   analytics trackers**, no third-party cookies, and no web beacons or tracking
   pixels." The browser tag makes that false on deploy. Three options, a
   recommendation, and drafted replacement copy are in
   `analytics/05-privacy-and-consent.md`. Note that "no third-party cookies"
   and "we do not track you around the internet" both stay **true** under the
   recommended setup, provided Google Signals stays off.

## Open — for the user

1. **Create the GA4 property** (`analytics/03-ga4-console-setup.md`). Nothing
   can be verified until it exists. The two settings that cannot be fixed
   retroactively: the reporting **time zone must be Eastern** (everything else
   in this app buckets days in ET), and **data retention must be raised to 14
   months** — it defaults to 2, and the deleted data does not come back.
2. **Decide the privacy option** (A server-side only, B browser tag with the
   policy rewritten, C cookieless tag). Recommendation is A now, B once the
   policy is live.
3. **Then wire, in the order in `04-wiring.md`.** Thirteen steps, each
   independently useful and independently revertible.

## Open — for whoever merges

- **`HANDOFF.md` was deliberately NOT updated.** It is edited by every session
  and would have been a guaranteed conflict against the parallel branches. Fold
  this session's entry in at merge time.
- **The §6 version bump was deliberately NOT applied.** It lives in the footer,
  outside `analytics/`. Note also that no version string exists anywhere in the
  current tree — `grep` finds none in `app/`, `lib/` or `components/` — so
  whoever bumps it may be adding it for the first time.
- **`analytics/sql/first-party-upgrade.sql` is unnumbered on purpose.**
  Migrations here count DOWN and the lowest was `9967` when this was written,
  but parallel sessions were actively claiming numbers. Rename to
  `<lowest − 1>_analytics_upgrade.sql` **at the moment you move it**, not from
  the number in any document.
- **Do not add `analytics/` to `.vercelignore`.** Once `app/layout.tsx` imports
  from it, it is part of the build. (`pay-by-phone/` is excluded there because
  it is a separate deployable; this is not.)

## Worth knowing later

- The Measurement Protocol **returns `204` for payloads it throws away** — wrong
  event name, missing `client_id`, a 26th parameter, all `204`. Build every new
  event against the debug endpoint (`GA_VALIDATE_ONLY=1`) first. This is the
  single most expensive gotcha in GA4 server-side work.
- `ANALYTICS_SALT` is a real secret. There are only ten billion US phone
  numbers, so anyone holding it can reverse every hash by brute force.
- Rotating that salt resets user continuity in GA — new hashes, new users,
  broken cohorts. Rotate deliberately.
- Step 4 of the wiring (carrying the `_ga` client id into Stripe checkout
  metadata) is small, easy to skip, and skipping it makes **every payment on the
  service arrive as "(direct)" forever**. It is the cheapest high-value line in
  the whole plan.
