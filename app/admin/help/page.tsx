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
