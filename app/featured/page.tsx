import type { Metadata } from "next";
import Link from "next/link";
import { recordVisit } from "@/lib/analytics";
import { readSession } from "@/lib/session";
import { getEngineSettings } from "@/lib/settings";
import { formatPrice, site } from "@/lib/config";
import { etParts } from "@/lib/et";
import {
  FEATURED_CAPACITY,
  FEATURED_RUN_DAYS,
  featuredSchedule,
  formatRunDay,
  queueSentence,
} from "@/lib/featured-schedule";
import { listBookedStartDays, listPendingRequests } from "@/lib/featured-requests";
import { submitFeaturedRequest } from "@/lib/featured-actions";
import { WaysToPay } from "@/components/WaysToPay";

export const metadata: Metadata = {
  title: `Featured listings — ${site.name}`,
  description:
    "Put your business or your ad in front of everyone on the front page for 30 days. Four spots, first come first served.",
};

export const dynamic = "force-dynamic";

export default async function FeaturedRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const params = await searchParams;
  await recordVisit("/featured");
  const session = await readSession();
  const settings = await getEngineSettings();

  // The live queue, not a description of one: booked runs decide when a slot
  // frees, and everyone already waiting is ahead of whoever is reading this.
  const today = etParts(new Date()).day;
  const booked = await listBookedStartDays();
  const waiting = await listPendingRequests();
  const queueAhead = waiting.length;
  const schedule = featuredSchedule({ approvedStarts: booked, today, queueAhead });

  return (
    <div className="container account">
      <h1>Featured ad of the month</h1>
      <p>
        Four featured spots run on the front page at a time — two stacked on each side of
        the ads — and every visitor sees them. A spot is{" "}
        <strong>{formatPrice(settings.featuredMonthlyCents)}</strong> and runs for{" "}
        <strong>{FEATURED_RUN_DAYS} days</strong> from the day it is approved.
      </p>

      {params.submitted && (
        <div className="notice" role="status">
          <p>
            <strong>Got it — you&rsquo;re in the queue.</strong> We&rsquo;ll be in touch to
            confirm the artwork and settle up. Your place is held from the moment you sent
            this, not from when we get to it.
          </p>
        </div>
      )}
      {params.error === "name" && (
        <p className="form-error" role="alert">
          Tell us the business or the name the listing is for.
        </p>
      )}
      {params.error === "contact" && (
        <p className="form-error" role="alert">
          We need a phone number or an email address — otherwise there&rsquo;s no way to
          come back to you.
        </p>
      )}
      {params.error === "link" && (
        <p className="form-error" role="alert">
          That link doesn&rsquo;t look like a web address. It needs to start with{" "}
          <code>https://</code>. Leave it blank if you&rsquo;d rather the spot opened one
          of your own ads.
        </p>
      )}
      {params.error === "unsupported" && (
        <p className="form-error" role="alert">
          Featured requests aren&rsquo;t switched on yet. Please call{" "}
          {site.salesPhone} and we&rsquo;ll sort it out by hand.
        </p>
      )}

      {/* ---------- the live queue ---------- */}
      <section aria-labelledby="queue-h">
        <h2 id="queue-h" className="section-h">
          What&rsquo;s open right now
        </h2>
        <p className="notice" role="status">
          {queueSentence(schedule, queueAhead)}
        </p>
        <dl className="account-facts">
          <div>
            <dt>Spots running</dt>
            <dd>
              {schedule.runningCount} of {FEATURED_CAPACITY}
            </dd>
          </div>
          <div>
            <dt>Requests waiting</dt>
            <dd>{queueAhead}</dd>
          </div>
          <div>
            <dt>Earliest start</dt>
            <dd>
              {schedule.startsImmediately
                ? "As soon as it's approved"
                : formatRunDay(schedule.nextStartDay)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ---------- how the queue works ---------- */}
      <section aria-labelledby="how-h">
        <h2 id="how-h" className="section-h">
          How the queue works
        </h2>
        <p>
          The four spots don&rsquo;t all change over on the first of the month. Each one
          runs its own {FEATURED_RUN_DAYS} days from the day it was approved, so they
          finish on different dates and a spot opens up whenever the{" "}
          <em>earliest-finishing</em> one finishes.
        </p>
        <p>
          Say four listings were approved on the 17th, the 20th, the 24th and the 30th of
          August. They end on the 16th, 19th, 23rd and 29th of September. The next person
          in line starts on <strong>September 16th</strong> — the day the first one ends —
          and the person after them starts on the 19th.
        </p>
        <p>
          <strong>It is first come, first served, by the minute you asked.</strong> If
          three spots are confirmed and two people apply, and both are approvable, the one
          who submitted first takes the fourth spot and the other waits for the first
          opening. Nobody jumps the line by calling twice.
        </p>
        <p className="fine">
          We review every listing before it runs, the same as an ad.{" "}
          <strong>Nothing is charged for a listing that doesn&rsquo;t run</strong> — if we
          can&rsquo;t approve it, you don&rsquo;t pay.
        </p>
      </section>

      {/* ---------- what it links to ---------- */}
      <section aria-labelledby="link-h">
        <h2 id="link-h" className="section-h">
          Where your spot goes when someone clicks it
        </h2>
        <p>Your choice, and you can change it while it runs:</p>
        <ul>
          <li>
            <strong>Your own website or Facebook page</strong> — anywhere you like, we just
            need the address.
          </li>
          <li>
            <strong>One of your ads on here</strong> — the spot opens that ad&rsquo;s page,
            which is usually the better bet if you&rsquo;re featuring something specific
            you&rsquo;re selling.
          </li>
        </ul>
      </section>

      {/* ---------- the form ---------- */}
      <section aria-labelledby="ask-h">
        <h2 id="ask-h" className="section-h">
          Request a spot
        </h2>
        <form action={submitFeaturedRequest}>
          <div className="field">
            <label htmlFor="kind">What are you featuring?</label>
            <select id="kind" name="kind" className="admin-select" defaultValue="business">
              <option value="business">My business — a premium business listing</option>
              <option value="featured_ad">One of my ads — a featured ad</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="businessName">Business or name</label>
            <input id="businessName" name="businessName" type="text" maxLength={80} required />
          </div>
          <div className="field">
            <label htmlFor="contactName">Who should we ask for? (optional)</label>
            <input id="contactName" name="contactName" type="text" maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={session?.phone ?? ""}
              placeholder="330-555-0142"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" maxLength={120} />
          </div>
          <p className="fine">A phone number or an email — either is enough, both is better.</p>
          <div className="field">
            <label htmlFor="linkUrl">Where should it link? (optional)</label>
            <input
              id="linkUrl"
              name="linkUrl"
              type="url"
              maxLength={200}
              placeholder="https://…"
            />
          </div>
          <div className="field">
            <label htmlFor="adId">…or the number of the ad to open (optional)</label>
            <input id="adId" name="adId" type="number" min={1} className="admin-num" />
          </div>
          <div className="field">
            <label htmlFor="note">Anything else? (optional)</label>
            <textarea id="note" name="note" rows={3} maxLength={500} />
          </div>
          <p className="fine">
            Send us the picture afterwards — call, or email it to {site.salesEmail}. We
            size it to fit.
          </p>
          <button className="btn btn-block" type="submit">
            Ask for a featured spot
          </button>
        </form>
      </section>

      <section aria-labelledby="pay-h">
        <h2 id="pay-h" className="section-h">
          Paying for it
        </h2>
        <WaysToPay
          priceCents={settings.featuredMonthlyCents}
          what="a featured spot"
          signedIn={Boolean(session)}
        />
      </section>

      <p>
        <Link href="/">← Back to the ads</Link>
      </p>
    </div>
  );
}
