import type { Metadata } from "next";
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
          <tr><td>Digest send-times, SMS + email (ET)</td><td>{s.slots.join(", ")}</td></tr>
        </tbody>
      </table>
    </>
  );
}
