import type { Metadata } from "next";
import Link from "next/link";
import { readSession } from "@/lib/session";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";
import { etParts } from "@/lib/et";
import {
  EVENT_BODY_MAX,
  EVENT_PLACE_MAX,
  EVENT_TIME_MAX,
  EVENT_TITLE_MAX,
  formatEventDay,
} from "@/lib/town-hall";
import { listUpcomingEvents } from "@/lib/town-hall-store";
import { submitTownHallEvent } from "@/lib/town-hall-actions";
import { MaskedText, maskPhonesPlain } from "@/components/MaskedText";

export const metadata: Metadata = {
  title: `Town hall — ${site.name}`,
  description: `Upcoming events around ${site.region}: auctions, benefit suppers, school sales, and community happenings.`,
};

export default async function TownHallPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await readSession();
  await recordVisit("/town-hall");
  const events = await listUpcomingEvents(etParts(new Date()).day);

  // Migration 9977 not pasted yet — the board is simply not open. Never 500.
  if (events === null) {
    return (
      <div className="container account">
        <h1>Town hall</h1>
        <p>The community events board isn&rsquo;t open just yet — check back soon.</p>
        <p>
          <Link href="/">← Back to the ads</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container account">
      <h1>Town hall</h1>
      <p>
        Upcoming events around {site.region} — auctions, benefit suppers, school sales,
        and the like. Listings are free and reviewed before they appear; an event drops
        off the board by itself once its date has passed.
      </p>

      {params.submitted && (
        <div className="notice" role="status">
          <p>
            <strong>Got it — your event is waiting for review.</strong> Once it&rsquo;s
            approved it shows here and on the front page until the day of the event.
          </p>
        </div>
      )}
      {params.error === "banned" && (
        <p className="form-error" role="alert">
          Your posting privileges are suspended. Contact us at {site.supportPhone} to
          appeal.
        </p>
      )}
      {params.error === "empty" && (
        <p className="form-error" role="alert">
          An event needs at least a title and a few words about it. Emoji are removed
          automatically, so write it in plain words and try again.
        </p>
      )}
      {params.error === "toolong" && (
        <p className="form-error" role="alert">
          That&rsquo;s a bit long for the board — please keep the title under{" "}
          {EVENT_TITLE_MAX} characters and the description under {EVENT_BODY_MAX}.
        </p>
      )}
      {params.error === "date" && (
        <p className="form-error" role="alert">
          We couldn&rsquo;t read that date — please pick the day of the event.
        </p>
      )}
      {params.error === "past" && (
        <p className="form-error" role="alert">
          That date has already passed — the board only lists upcoming events.
        </p>
      )}
      {params.error === "toofar" && (
        <p className="form-error" role="alert">
          That date is more than a year out — please list the event closer to the day.
        </p>
      )}
      {params.error === "link" && (
        <p className="form-error" role="alert">
          Please leave web addresses out of event listings — put the place and a phone
          number instead, and folks will find you.
        </p>
      )}
      {params.error === "notopen" && (
        <p className="form-error" role="alert">
          The board isn&rsquo;t open just yet — please try again soon.
        </p>
      )}

      <section aria-labelledby="events-h">
        <h2 id="events-h" className="section-h">
          Upcoming events
        </h2>
        {events.length === 0 ? (
          <p>Nothing on the board right now — add the first one below.</p>
        ) : (
          <ul className="event-list">
            {/* The page's own copy invites phone numbers into events ("put the
                place and a phone number instead"), so every free-text field is
                masked for visitors — same anti-scraping posture as ad bodies
                (item 23); signed-in members see the numbers plain. */}
            {events.map((event) => (
              <li key={event.id} className="event-item">
                <p className="event-when">
                  {formatEventDay(event.eventDate)}
                  {event.timeText
                    ? ` · ${session ? event.timeText : maskPhonesPlain(event.timeText)}`
                    : ""}
                </p>
                <h3 className="event-title">
                  {session ? event.title : maskPhonesPlain(event.title)}
                </h3>
                {event.placeText && (
                  <p className="event-place">
                    {session ? event.placeText : maskPhonesPlain(event.placeText)}
                  </p>
                )}
                <p className="event-body">
                  <MaskedText text={event.body} revealed={Boolean(session)} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="add" aria-labelledby="add-h">
        <h2 id="add-h" className="section-h">
          Add your event
        </h2>
        {session ? (
          <>
            <p>
              Listing an event is free. It goes through the same review as an ad, then
              runs here and on the front page until the day of the event. No links,
              please — emoji are removed automatically.
            </p>
            <form action={submitTownHallEvent}>
              <div className="field">
                <label htmlFor="event-title">Event title</label>
                <input
                  id="event-title"
                  name="title"
                  type="text"
                  required
                  maxLength={EVENT_TITLE_MAX}
                  placeholder="Benefit haystack supper for the Yoder family"
                />
              </div>
              <div className="field">
                <label htmlFor="event-date">Date of the event</label>
                <input id="event-date" name="date" type="date" required />
              </div>
              <div className="field">
                <label htmlFor="event-time">Time (optional)</label>
                <input
                  id="event-time"
                  name="time"
                  type="text"
                  maxLength={EVENT_TIME_MAX}
                  placeholder="4:00–7:00 pm"
                />
              </div>
              <div className="field">
                <label htmlFor="event-place">Place (optional)</label>
                <input
                  id="event-place"
                  name="place"
                  type="text"
                  maxLength={EVENT_PLACE_MAX}
                  placeholder="Mt. Hope Auction barn, Mt. Hope"
                />
              </div>
              <div className="field">
                <label htmlFor="event-body">What&rsquo;s happening</label>
                <textarea
                  id="event-body"
                  name="body"
                  rows={4}
                  required
                  maxLength={EVENT_BODY_MAX}
                  placeholder="Who it's for, what to expect, and who to call with questions."
                />
              </div>
              <button className="btn" type="submit">
                Send it in for review
              </button>
            </form>
          </>
        ) : (
          <p>
            Members list events free.{" "}
            <Link href="/login?next=%2Ftown-hall">Sign in</Link> to add yours — it takes
            a minute.
          </p>
        )}
      </section>

      <p>
        <Link href="/">← Back to the ads</Link>
      </p>
    </div>
  );
}
