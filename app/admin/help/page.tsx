import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getEngineSettings } from "@/lib/settings";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Help & how it's built — ${site.name} admin`,
  robots: { index: false },
};

/**
 * Operator's reference: why the system is wired the way it is. Static prose
 * (kept in the admin portal so it's password-gated), with the live tunable
 * numbers pulled from settings so they never drift from reality.
 */
export default async function AdminHelp() {
  await requireAdmin();
  const s = await getEngineSettings();

  return (
    <>
      <h1>Help &amp; how it&rsquo;s built</h1>
      <p className="fine">
        Why the pieces are set up the way they are — so future-you (or whoever helps you)
        doesn&rsquo;t have to reverse-engineer past decisions. This page is only visible to
        admins.
      </p>

      <h2 className="section-h">The big idea: swappable &ldquo;seams&rdquo;</h2>
      <p>
        Every outside service sits behind a switch. When the service&rsquo;s key is present,
        the real provider is used; when it&rsquo;s absent, a safe local stand-in runs
        instead. This let the whole app be built and tested before any account existed, and
        it means a missing key degrades gracefully instead of crashing.
      </p>
      <table className="cmd-table">
        <thead>
          <tr>
            <th scope="col">Concern</th>
            <th scope="col">Turns real when this is set</th>
            <th scope="col">Stand-in without it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Database</td>
            <td><span className="cmd">SUPABASE_URL</span> + <span className="cmd">SUPABASE_SERVICE_ROLE_KEY</span></td>
            <td>Local JSON files (demo ads) — never use in production</td>
          </tr>
          <tr>
            <td>Text messages</td>
            <td><span className="cmd">TELNYX_API_KEY</span></td>
            <td>On-screen code echo + <span className="cmd">/dev/sms</span> simulator</td>
          </tr>
          <tr>
            <td>Email</td>
            <td><span className="cmd">RESEND_API_KEY</span></td>
            <td>On-screen link + <span className="cmd">/dev/email</span> viewer</td>
          </tr>
          <tr>
            <td>Payments</td>
            <td><span className="cmd">STRIPE_SECRET_KEY</span></td>
            <td>&ldquo;Simulate payment&rdquo; checkout button</td>
          </tr>
        </tbody>
      </table>
      <p className="fine">
        The single most important consequence: <strong>{site.smsNumber}</strong> only sends
        real texts once <span className="cmd">TELNYX_API_KEY</span> is set. With it set but
        the SMS campaign not yet approved, texts fail to send — which is why the key is added
        last, after the campaign is live.
      </p>

      <h2 className="section-h">Why texts have hourly limits</h2>
      <p>
        Every text the service sends costs money, so a bad actor texting the number
        thousands of times could run up the bill. Three caps stop that. They&rsquo;re all
        editable on the <span className="cmd">Settings</span> page — current values:
      </p>
      <ul>
        <li>
          <strong>{s.smsRepliesPerHour} replies per number per hour.</strong> Past this, the
          service stops answering that one number for the rest of the hour (it still records
          what came in). A normal person posting and checking an ad uses only a handful, so
          this is set well above real use.
        </li>
        <li>
          <strong>{s.smsPicsPerHour} pictures per number per hour.</strong> Pictures are the
          most expensive kind of text to send, so they get their own tighter limit. This is a
          burst limit — the day/bank limit below is the main control.
        </li>
        <li>
          <strong>
            {s.picDailyAllowance > 0
              ? `${s.picDailyAllowance} picture pulls per number per day, banking up to ${s.picBankCap}.`
              : "Daily picture limit is OFF."}
          </strong>{" "}
          {s.picDailyAllowance > 0 ? (
            <>
              Each number gets {s.picDailyAllowance} PIC photos a day. Unused pulls roll over
              and stack up like a sinking fund — up to {s.picBankCap} saved — so someone who
              rarely asks builds a cushion, while someone hammering PIC is stopped at their
              allowance for the day. It resets/tops up each morning (Eastern). This is the real
              cap on picture-text cost; the hourly limit above just smooths bursts. Set the daily
              number to 0 to turn this off and rely on the hourly limit alone.
            </>
          ) : (
            <>
              Pictures are bounded only by the hourly limit above. Set “Picture pulls per number
              per day” above 0 on Settings to give each number a daily photo allowance that banks
              unused pulls up to a ceiling.
            </>
          )}
        </li>
        <li>
          <strong>{s.smsGlobalPerHour} replies across the whole service per hour.</strong> A
          circuit breaker for the worst case — many numbers attacking at once. It bounds the
          most the service can spend on replies in any hour.
        </li>
        <li>
          <strong>{s.digestDailySegmentBudget} digest segments per rolling 24 hours.</strong>{" "}
          Digests are billed per SMS <em>segment</em> (a chunk of roughly 153 characters), and
          a broadcast is segments × subscribers — the biggest bill in the system. When the
          budget is met, digest sending pauses, the queue waits, and you get an email; it
          resumes on its own as the 24-hour window frees room, or immediately if you raise
          the number. Setting it to 0 pauses digest sending entirely.
        </li>
      </ul>
      <p className="fine">
        Two deliberate exceptions: <strong>digest broadcasts never count</strong> toward
        the three reply limits (they have their own segment budget above), and{" "}
        <strong>STOP is always answered</strong> (phone carriers require the unsubscribe
        confirmation).
      </p>

      <h2 className="section-h">Emergency controls (Settings → System controls)</h2>
      <p>
        Three switches on the Settings page for when something goes wrong. They take effect
        immediately — the engine reads them live.
      </p>
      <ul>
        <li>
          <strong>Partial pause</strong> stops the expensive bulk sends — the digests and the
          new-subscriber catch-up — but still answers commands, sends picture (PIC) texts,
          sign-in codes, and STOP confirmations. Use it when the digest bill is the problem but
          you want the service usable.
        </li>
        <li>
          <strong>Full pause</strong> stops <em>every</em> outbound text and email to
          subscribers and users: digests, replies, pictures, sign-in codes, confirmations. You
          still receive and log incoming texts, alert emails still reach you, and you sign into
          this admin area with your password (not a texted code). It&rsquo;s the absolute
          spend-stop. Queued digests aren&rsquo;t lost — they wait and resume, under the segment
          budget, when you set it back to Normal.
        </li>
        <li>
          <strong>Under-attack mode</strong> is for a spam flood or a bad actor: it stops
          replying to unknown/gibberish texts, skips new-subscriber catch-up, automatically
          tightens the per-number and service-wide reply caps, and throttles all outbound to the
          per-minute ceiling on Settings. Pair it with the blocklist below.
        </li>
      </ul>
      <p>
        <strong>Blocklist.</strong> A blocked number is dropped the instant it texts — no reply,
        no account, no charge — and never receives a digest (the incoming text is still recorded
        for your records). Block the worst offenders with one click from{" "}
        <span className="cmd">Insights</span> (they&rsquo;re ranked by volume there), or add a
        number by hand on Settings.
      </p>

      <h2 className="section-h">What ads may contain</h2>
      <p>
        Two rules are enforced the moment an ad is texted in, before you ever see it. Emoji and
        other picture-symbols are <strong>stripped out</strong> — they flip a whole SMS digest
        to a pricier encoding and read badly on flip phones (the exact text the sender typed is
        still kept in the message log). And any ad containing a <strong>web link</strong> is
        <strong> flagged</strong> in the review queue so you notice it: for now the service is a
        walled garden and links are edited out or the ad rejected. (A future
        &ldquo;verified advertiser&rdquo; tier could be allowed to post links.)
      </p>

      <h2 className="section-h">Deleting an ad (Ads tab)</h2>
      <p>
        <strong>Delete this ad…</strong> on the Ads tab removes an ad completely, whatever its
        status: it leaves the website and the digest queue immediately, a queued bump is dropped,
        and its photo is removed from storage. It is a <em>soft</em> delete under the hood — the
        ad number stays in past digests and in the message log, because history is never
        rewritten (filter the Ads tab by &ldquo;deleted&rdquo; to see removed ads). Deleting
        <strong> does not refund</strong> and <strong>does not text the seller</strong> — the
        confirm step shows what the seller paid so you can grant credits on their page first if
        a refund is deserved. For a bad ad still in review, prefer <strong>Reject</strong>: that
        is the flow that refunds (benign) or records a strike (violation) and tells the seller.
      </p>

      <h2 className="section-h">Emailed-in extra pictures (Ads tab)</h2>
      <p>
        Sellers (or a helper with email) can send <strong>more pictures for an ad</strong> to the
        photos@ inbound address with the ad number in the subject line (&ldquo;Ad 1042&rdquo;).
        Each image is verified by its bytes and copied into our storage exactly like an MMS
        photo, then waits as a submission on the <strong>Ads tab</strong> — nothing goes live
        until you approve it there, because an email From line is easy to fake. Approved
        pictures appear in the ad&apos;s <em>website</em> gallery only: the SMS digest, the email
        digest, and PIC keep carrying the one MMS picture the seller paid for, so extra
        pictures never add sending cost or bypass picture-ad pricing. An ad holds at most 8
        pictures in total.
      </p>

      <h2 className="section-h">Buyer/seller ratings (confirmed parties only)</h2>
      <p>
        After a seller texts <strong>SOLD 1042</strong>, the system asks for the buyer&apos;s
        phone number. Naming the buyer records a <em>confirmed sale</em>; only then can each
        side rate the other, by replying <strong>RATE 1–5</strong> (the buyer gets one text
        inviting them). One rating per person per ad, and a rating that doesn&apos;t match the
        recorded sale is refused — so nobody can rate a stranger, and star averages on the
        website (&ldquo;Seller rated ★ 4.8 by 5 confirmed buyers&rdquo;) mean something. SKIP
        (or ignoring the question) opts out; the ask expires on its own.
      </p>

      <h2 className="section-h">Member profiles, private addresses, and chat</h2>
      <p>
        Signed-in members can set a <strong>profile picture</strong> (public) and a{" "}
        <strong>pickup address</strong> that is strictly private — it is never shown anywhere
        and only leaves the account when the member presses &ldquo;Share my pickup
        address&rdquo; inside a conversation. <strong>Chat</strong> lives on the website
        (&ldquo;Message the seller&rdquo; on any ad): messages travel between 6-digit member
        numbers so nobody&apos;s phone number is exposed, and the other party gets at most one
        &ldquo;you have a message waiting&rdquo; text per day (reply-class — it respects
        pause, blocklist, and the hourly caps). Flip-phone members simply keep using the phone
        number printed in the ad, as always — chat is an extra lane, not a replacement.
      </p>

      <h2 className="section-h">Chat moderation: reports and the message log</h2>
      <p>
        Conversations are part of the platform record: every chat message —
        pictures included — is copied into the <strong>Messages</strong> audit log, so you can
        read a conversation when a dispute or a safety question comes up. (An earlier build
        deliberately kept chat out of the log; that stance was reversed when reporting
        shipped — an operator asked to act on a reported message has to be able to read the
        conversation.) Members can press <strong>Report this message</strong> on anything they
        receive; reports queue at the bottom of the <strong>Review</strong> tab with the
        message, both parties, and a resolve/dismiss choice. Two more chat rules enforce the
        walled garden: <strong>links can&apos;t be sent in chat</strong> at all (the send is
        refused with a note), and chat pictures live on the <em>website only</em> — they are
        never sent by text, so chat can&apos;t create MMS cost.
      </p>

      <h2 className="section-h">Show number: why seller numbers are metered on the website</h2>
      <p>
        Seller phone numbers <strong>never appear in the website&rsquo;s page code</strong> —
        not in the listings, not on the ad page, not inside the ad text. One burner-phone
        account could otherwise sign in once and scrape every seller&rsquo;s number off the
        site. Instead, a signed-in member presses <strong>Show number</strong> on an ad and
        that one ad&rsquo;s numbers appear (and stay visible for them — looking again is
        free). Look-ups are metered like picture pulls:{" "}
        <strong>{s.revealsPerDay || "unlimited"}</strong> a day, unused ones banking up to{" "}
        <strong>{s.revealBankCap}</strong> (set &ldquo;per day&rdquo; to 0 to turn metering
        off). A real buyer never notices the meter; a scraper hits it in minutes. Every
        reveal is recorded (who, which ad, when), and{" "}
        <Link href="/admin/insights">Insights</Link> flags anyone revealing more than{" "}
        <strong>{s.revealAbusePerDay}</strong> distinct numbers in 24 hours, with the usual
        one-click block. Out-of-look-ups members see a friendly &ldquo;they refill
        tomorrow&rdquo; note pointing at chat — messaging the seller is never metered. Ad
        owners always see their own numbers; digests and texting are untouched (numbers are
        the product there, and SMS is bulk-limited by nature). All three numbers are on{" "}
        <Link href="/admin/settings">Settings</Link>.
      </p>

      <h2 className="section-h">Town hall events (the free board)</h2>
      <p>
        Members list upcoming community events free at <span className="cmd">/town-hall</span>{" "}
        (there&apos;s an &ldquo;Add your event&rdquo; form on the board). Every submission
        waits in the <strong>Review</strong> tab — same posture as an ad — with an
        approve/decline choice; declining is simple because nothing was charged. Approved
        events show on the board and in the homepage <strong>Town hall</strong> sidebar,
        nearest date first, and <strong>drop off by themselves</strong> the day after the
        event — no cleanup needed. Event text follows the walled garden: emoji are stripped
        and links are refused outright at submission. The paid text/email event blast is a
        later phase — nothing about events sends messages today.
      </p>

      <h2 className="section-h">Featured spots (the rotating left sidebar)</h2>
      <p>
        The homepage&apos;s left column carries two <strong>Featured</strong> slots, each
        rotating every 8 seconds through up to three image ads you post by hand on the{" "}
        <strong>Featured</strong> tab — six sellable spots total, though selling them has
        no flow yet (pricing isn&apos;t set; today you place them for whoever you&apos;ve
        arranged it with). A spot may link out to an external website — the one sanctioned
        exception to the no-links rule, safe because only you can post there — and the
        link is marked as a paid placement (<span className="cmd">rel=&quot;sponsored&quot;</span>)
        so search engines treat it honestly. Images go through the same 8&nbsp;MB
        byte-checked upload as everything else. When nothing is active the sidebar
        disappears entirely, and for visitors who prefer reduced motion the rotation
        stops — they page through with the dots instead.
      </p>

      <h2 className="section-h">The green check (verified members)</h2>
      <p>
        The <strong>✓ Verified</strong> mark is yours to give and take, one account at a time,
        from the user&apos;s page (&ldquo;Mark verified&rdquo;) — there is deliberately no
        self-serve path, so the check means a human vouched for a real, known buyer or seller.
        It shows in green on the ad page (&ldquo;✓ Verified seller&rdquo;), on the member&apos;s
        account page, and next to their member number in chat. Perks for verified members
        (posting privileges, discounts, whatever earns trust its reward) come later — the mark
        itself is the foundation.
      </p>

      <h2 className="section-h">Adding a member yourself (invite by text)</h2>
      <p>
        On the Users tab, <strong>Add a member</strong> creates an account for a phone number
        you type in and texts them a one-time invite: who we are, &ldquo;to sign up, reply
        START,&rdquo; the message-frequency and rates disclosure, and HELP/STOP instructions —
        the same compliance language as everything else we send. You can grant{" "}
        <strong>starting credits</strong> in the same step (they land in the ledger
        immediately, noted as an admin invite grant). The invite never repeats — one per
        number per day, and already-subscribed numbers are refused — because it&apos;s
        outreach to someone who hasn&apos;t texted us first: one polite knock, not a campaign.
        Nothing else is ever sent unless they reply START.
      </p>

      <h2 className="section-h">Why credits are a ledger</h2>
      <p>
        Credit balances aren&rsquo;t a single number that gets edited. Every grant, purchase,
        spend, and refund is a separate line, and the balance is the sum of all lines. Money
        histories should be append-only: you can always see exactly what happened and when,
        and a bug can&rsquo;t silently overwrite someone&rsquo;s balance. Purchases record the
        Stripe payment id, which is also how a repeated payment notification is prevented from
        adding credits twice.
      </p>

      <h2 className="section-h">Taking payment over the phone (Phone order)</h2>
      <p>
        On a member&rsquo;s page (Users tab) the <strong>Phone order</strong> section handles a
        caller paying by card. If a card is already on file it says so, and{" "}
        <strong>Bill their saved card</strong> charges it on their verbal OK — same price and
        saved-card discount as texting BUYCREDIT, and a double-click can&rsquo;t charge twice.
        No card yet? Pick the pack, then either <strong>Open checkout here</strong> —
        Stripe&rsquo;s secure payment page opens in your browser and you key the card in as the
        caller reads it out — or <strong>Text them the link</strong> so they finish it
        themselves (the link lasts 24 hours). The card number goes straight into Stripe and is
        never seen or stored by this site, so don&rsquo;t write it down either. When the payment
        goes through, the credits are granted to that member automatically and the card is
        saved to their account — from then on they can top up by texting{" "}
        <span className="cmd">BUYCREDIT</span> (a YES confirms and charges the saved card, with
        the saved-card discount). For cash or a check, skip Stripe entirely and use{" "}
        <strong>Adjust credits</strong> with a note like &ldquo;check #204&rdquo;.
      </p>

      <h2 className="section-h">Why the website can&rsquo;t read the database directly</h2>
      <p>
        The database has row-level security turned on for every table with no access policies,
        which means the public/anonymous key can read and write nothing. Only the server,
        holding the secret service key, touches data. So even if the public key leaked, no one
        could pull the members list or messages. This is also why the correct key matters: the
        app needs the <strong>secret</strong> key (starts with <span className="cmd">sb_secret_</span>),
        not the publishable one.
      </p>

      <h2 className="section-h">Why digests need an outside timer</h2>
      <p>
        Digests are sent by a job that&rsquo;s supposed to run every few minutes to check
        whether a send-time (7&nbsp;AM, noon, 4&nbsp;PM, 8&nbsp;PM ET) has arrived. The web
        host&rsquo;s free plan only runs scheduled jobs once a day, which isn&rsquo;t often
        enough — so an outside service pings{" "}
        <span className="cmd">/api/cron/digests</span> every 5 minutes instead. That URL is
        protected by a secret (<span className="cmd">CRON_SECRET</span>): the pinger sends it
        in an <span className="cmd">Authorization</span> header, and requests without it are
        rejected. Opening the URL in a browser returns &ldquo;unauthorized&rdquo; on purpose —
        that&rsquo;s the protection working, not a bug.
      </p>

      <h2 className="section-h">Why a slot only sends once</h2>
      <p>
        The moment a send-time is picked up, it&rsquo;s recorded as handled before any texts go
        out. If the pinger fires again a few minutes later, that slot is skipped. Without this,
        every 5-minute ping during the 7&nbsp;AM hour would re-send the morning digest to
        everyone. Empty slots (no new ads) are still recorded as handled, so they don&rsquo;t
        keep getting retried.
      </p>

      <h2 className="section-h">Why some settings are secrets you set once</h2>
      <p>
        <span className="cmd">SESSION_SECRET</span> signs the login cookies and the
        confirm/unsubscribe links inside emails. Changing it after launch signs everyone out
        and breaks the links in emails already sent — so it&rsquo;s set once and left alone.
        <span className="cmd">ADMIN_PHONES</span> is the list of phone numbers that get this
        admin area; a signed-in number that isn&rsquo;t on the list sees a plain
        &ldquo;not found&rdquo; page, so the portal doesn&rsquo;t advertise itself.
      </p>

      <h2 className="section-h">Why email is a two-step opt-in</h2>
      <p>
        Signing up for the email edition sends a confirmation link first; the address only
        starts getting digests after the link is clicked. This proves the address belongs to
        the person and keeps typo&rsquo;d or malicious sign-ups off the list — the standard
        that keeps the sending domain&rsquo;s reputation clean. Every digest email also carries
        a one-click unsubscribe and the business mailing address, as the law requires.
      </p>

      <h2 className="section-h">Business advertising packages (the Business tab)</h2>
      <p>
        Businesses buy a package on the public <span className="cmd">/advertising</span>{" "}
        page (the &ldquo;Advertising for Businesses&rdquo; footer link): 1&nbsp;week $39.99,
        2&nbsp;weeks $59.99, 1&nbsp;month $89.99. They pay by card up front (Stripe), and the
        ad then lands on the <strong>Business</strong> tab waiting for review — paying never
        skips the human gate, same as every member ad. Business ads MAY carry one website
        link (members can&rsquo;t); the review is where you judge it.
      </p>
      <p>
        Approving starts the run <strong>that day</strong> (the clock starts at approval,
        not payment — the page tells them so). From then on the ad rides the{" "}
        <strong>first digest of each day</strong> as a labeled line — &ldquo;Sponsor:
        Miller&rsquo;s Harness Shop - &hellip;&rdquo; — placed on top of the member ads and{" "}
        <strong>never</strong> consuming one of the {s.digestCap} member slots. The email
        edition mirrors it with the link clickable. Sponsor text is run through the same
        character-set cleaner as everything else, so it can&rsquo;t inflate the SMS cost,
        and its messages count against the daily segment budget like any other digest text.
      </p>
      <p>
        <strong>Missed days extend the run — they are never silently eaten.</strong> A
        package is done when its ad has ridden the number of days bought, not on a calendar
        date. If a day&rsquo;s digest never goes out (a pause, the segment-budget breaker,
        or simply no member ads that day), that day doesn&rsquo;t count; the Business tab
        shows the package as &ldquo;N missed days — run extends&rdquo; so you can see it
        happening.
      </p>
      <p>
        <strong>Declining = refunding by hand.</strong> A declined package never ran, so
        per the refund policy the money goes back — but nothing is refunded automatically
        (deliberate: no code path can move money out). The Business tab keeps a
        &ldquo;refund due&rdquo; note with the amount and the Stripe payment ref; do the
        refund in the Stripe dashboard (Payments → search the ref → Refund) and press
        &ldquo;mark done&rdquo;. If someone pays while the business_packages migration
        (9978) is missing, the package can&rsquo;t be stored — the server log carries the
        full details under &ldquo;PAID PACKAGE COULD NOT BE STORED&rdquo; and /api/health
        reports the missing migration.
      </p>

      <h2 className="section-h">Categories (the digest picker)</h2>
      <p>
        The SUBSCRIBE/START welcome is a menu: ALL plus nine categories (buggies, dogs,
        garden, horses, household, hunting, livestock, machinery, wanted). Subscribers text
        one category word per message to toggle it on or off, reply{" "}
        <span className="cmd">ALL</span> to go back to everything, and{" "}
        <span className="cmd">LIST</span> to hear their current picks. The same choices live
        as checkboxes on each member&rsquo;s <span className="cmd">/account</span> page —
        one store behind both, so a web change shows up in LIST and the other way around
        (web saves confirm on the page only; they never send a text). Every subscriber
        starts as ALL, including everyone subscribed before categories existed.
      </p>
      <p>
        <strong>You assign the category — at review.</strong> The Review queue has a
        category dropdown on every pending ad (web posters may suggest one; it just
        pre-fills your dropdown), and the Ads tab can change it later.{" "}
        <strong>&ldquo;Uncategorized&rdquo; is safe:</strong> an uncategorized ad rides
        every ALL and selective subscriber&rsquo;s digest and shows under All on the
        website — an ad can never become unsendable because a dropdown was skipped. Each
        subscriber gets ONE combined digest per send-time with just their
        categories&rsquo; ads (plus every uncategorized ad); business sponsor lines ride
        every edition regardless of categories. A member who toggles everything off is
        warned (&ldquo;You&rsquo;re not getting any ads now&rdquo;) and the choice is
        honored literally: they get nothing — no uncategorized ads and no sponsor lines —
        until they reply ALL or a category name.
      </p>
      <p>
        <strong>The confirmation throttle</strong> keeps &ldquo;HORSES HORSES HORSES&rdquo;
        from running up the SMS bill: after {s.categoryConfirmsPerHour} confirmed category
        toggles/LIST checks in an hour, the member gets one &ldquo;Changes still apply. Text
        LIST anytime to see your categories.&rdquo; and further confirmations go silent for
        the hour — <em>the toggles still apply</em>, they just cost nothing outbound. One
        exception: the &ldquo;You&rsquo;re not getting any ads now&rdquo; warning for
        removing the last category is never silenced (it still counts toward the window).
        The hourly reply cap above stays on top as the hard backstop, and gibberish still
        gets the ordinary unknown-word handling. Tunable on Settings (0 = unthrottled). The
        homepage category row is just a browse filter (works signed-out) — it has nothing
        to do with anyone&rsquo;s subscription.
      </p>

      <h2 className="section-h">Current tunable numbers</h2>
      <p>All editable on the Settings page; changes take effect immediately.</p>
      <table className="cmd-table">
        <tbody>
          <tr><td>Text ad cost</td><td>{s.costText} credit(s)</td></tr>
          <tr><td>Picture ad cost</td><td>{s.costPhoto} credits</td></tr>
          <tr><td>Bump cost</td><td>{s.bumpCost} credit(s)</td></tr>
          <tr><td>Max ads per digest</td><td>{s.digestCap}</td></tr>
          <tr><td>Max ad length</td><td>{s.maxChars} characters</td></tr>
          <tr><td>Ad run time</td><td>{s.expiryDays} days</td></tr>
          <tr><td>Number look-ups (Show number) per day / bank</td><td>{s.revealsPerDay} / {s.revealBankCap}</td></tr>
          <tr><td>Excessive-reveal flag (per 24h)</td><td>{s.revealAbusePerDay}</td></tr>
          <tr><td>Category confirmations per number per hour</td><td>{s.categoryConfirmsPerHour}</td></tr>
          <tr><td>Digest send-times, SMS + email (ET)</td><td>{s.slots.join(", ")}</td></tr>
        </tbody>
      </table>
    </>
  );
}
