import type { Metadata } from "next";
import Link from "next/link";
import {
  adminAddFeaturedSpot,
  adminDecideFeaturedRequest,
  adminDeleteFeaturedSpot,
  adminSetFeaturedActive,
} from "@/lib/admin-actions";
import { FEATURED_CAPTION_MAX, SPOTS_PER_SLOT, slotRotation } from "@/lib/featured";
import { listFeaturedSpots, type FeaturedSpot } from "@/lib/featured-store";
import { supabaseConfigured } from "@/lib/db";
import { formatPrice, site } from "@/lib/config";
import { formatPhone } from "@/lib/phone";
import { etParts } from "@/lib/et";
import { getEngineSettings } from "@/lib/settings";
import {
  FEATURED_CAPACITY,
  FEATURED_RUN_DAYS,
  featuredSchedule,
  formatRunDay,
} from "@/lib/featured-schedule";
import { listAllRequests, listBookedStartDays } from "@/lib/featured-requests";
import { SlotTimeline, type TimelineRun } from "@/components/SlotTimeline";
import { addDays } from "@/lib/featured-schedule";
import { Tip } from "@/components/Tip";
import { ImageUpload } from "@/components/ImageUpload";

export const metadata: Metadata = {
  title: `Featured spots — ${site.name} admin`,
};

export default async function AdminFeatured({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; deleted?: string; error?: string }>;
}) {
  const params = await searchParams;
  const spots = await listFeaturedSpots();
  const settings = await getEngineSettings();
  const all = await listAllRequests();
  const requests = all === null ? null : all.filter((r) => r.status === "pending").reverse();
  const booked = await listBookedStartDays();
  const today = etParts(new Date()).day;
  const schedule = featuredSchedule({ approvedStarts: booked, today });

  // The timeline: every approved run, named. Booked start days and the approved
  // request list are the same rows, so the labels line up by start day.
  const approved = (all ?? []).filter((r) => r.status === "approved" && r.scheduledStartDay);
  const timelineRuns: TimelineRun[] = booked.map((startDay) => ({
    startDay,
    label:
      approved.find((r) => r.scheduledStartDay === startDay)?.businessName ?? "Booked",
  }));
  // A window wide enough to see the whole board sold out and a little history:
  // two weeks back, and far enough forward to cover the longest booked run.
  const windowStart = addDays(today, -14);
  const furthest = booked.reduce((max, d) => (d > max ? d : max), today);
  const windowEnd = addDays(furthest, FEATURED_RUN_DAYS + 7);

  return (
    <>
      <h1>
        Featured spots <Tip k="featured.concept" />
      </h1>
      <p className="fine">
        FOUR Featured slots — two stacked on each side of the homepage ads (slots 1&ndash;2
        left, 3&ndash;4 right) — each rotating every 8 seconds through up to{" "}
        {SPOTS_PER_SLOT} image ads. A spot is{" "}
        <strong>{formatPrice(settings.featuredMonthlyCents)}</strong> for a{" "}
        {FEATURED_RUN_DAYS}-day run. A spot&rsquo;s external link is the one sanctioned
        exception to the no-links rule and is marked{" "}
        <span className="cmd">rel=&quot;sponsored&quot;</span> for search engines{" "}
        <Tip k="featured.links" />. The left column always shows the &ldquo;Reserve your
        spot here&rdquo; link so the request page is reachable even with nothing running.
      </p>

      {/* ---------- the four slots, across dates ---------- */}
      <h2 className="section-h">
        The four slots <Tip k="featured.timeline" />
      </h2>
      <p className="fine">
        Each row is one slot; each bar is a booked run across the days it holds. The red
        line is today. A slot opens the day its bar ends — that is the date the request
        page quotes, and it is the same arithmetic drawing this.
      </p>
      <SlotTimeline
        runs={timelineRuns}
        today={today}
        windowStart={windowStart}
        windowEnd={windowEnd}
      />

      {/* ---------- the request queue ---------- */}
      <h2 className="section-h">
        Requests waiting ({requests?.length ?? 0}) <Tip k="featured.queue" />
      </h2>
      <p className="fine">
        From <Link href="/featured">the request page</Link>, oldest first — and that order
        IS the promise made there: whoever asked first takes the next slot that frees.{" "}
        {schedule.startsImmediately ? (
          <>
            <strong>{schedule.openNow} of {FEATURED_CAPACITY} spots are open now</strong>,
            so the next approval starts showing today.
          </>
        ) : (
          <>
            <strong>All {FEATURED_CAPACITY} spots are running.</strong> The next approval
            would start <strong>{formatRunDay(schedule.nextStartDay)}</strong>.
          </>
        )}
      </p>
      {requests === null && (
        <p className="notice" role="status">
          Requests aren&rsquo;t available yet — paste migration <strong>9956</strong> in
          the Supabase SQL editor. Until then the request page still takes calls and
          emails; it just can&rsquo;t queue anyone.
        </p>
      )}
      {requests !== null && requests.length === 0 && (
        <p className="status-muted">No requests waiting.</p>
      )}
      {requests !== null && requests.length > 0 && (
        <ul className="sim-pending">
          {requests.map((req, i) => {
            // What THIS request would get if approved right now: everyone
            // ahead of it in the queue takes a slot first.
            const forThis = featuredSchedule({
              approvedStarts: booked,
              today,
              queueAhead: i,
            });
            return (
              <li key={req.id} className="myad-row">
                <p className="myad-title">
                  #{i + 1} · {req.businessName}
                  <span className="status-muted">
                    {" "}
                    · {req.kind === "featured_ad" ? "featured ad" : "premium business"} ·
                    asked {new Date(req.submittedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "America/New_York",
                    })}
                  </span>
                </p>
                <p className="myad-dates">
                  {req.contactName ? `${req.contactName} · ` : ""}
                  {req.phone ? formatPhone(req.phone) : ""}
                  {req.phone && req.email ? " · " : ""}
                  {req.email ?? ""}
                </p>
                <p className="myad-dates">
                  Links to:{" "}
                  {req.linkUrl ? (
                    <a href={req.linkUrl} target="_blank" rel="noreferrer nofollow">
                      {req.linkUrl}
                    </a>
                  ) : req.adId ? (
                    <Link href={`/ads/${req.adId}`}>ad #{req.adId}</Link>
                  ) : (
                    "not chosen yet — ask them"
                  )}
                </p>
                {req.imageSrc ? (
                  <a href={req.imageSrc} target="_blank" rel="noreferrer" title="Open full size">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={req.imageSrc}
                      alt={`Artwork sent by ${req.businessName}`}
                      style={{ maxWidth: 200, maxHeight: 150, border: "1px solid #ccc" }}
                    />
                  </a>
                ) : (
                  <p className="myad-dates">
                    <strong>No artwork yet</strong> — ask them for it before it runs.
                  </p>
                )}
                {req.note && <p className="sim-body">{req.note}</p>}
                <p className="fine">
                  Approving now books{" "}
                  <strong>
                    {forThis.startsImmediately
                      ? "today"
                      : formatRunDay(forThis.nextStartDay)}
                  </strong>{" "}
                  through {formatRunDay(forThis.nextEndDay)}.
                </p>
                <form action={adminDecideFeaturedRequest} className="sim-actions">
                  <input type="hidden" name="id" value={req.id} />
                  <input type="hidden" name="queueAhead" value={i} />
                  <button className="btn btn-sm" name="decision" value="approved" type="submit">
                    Approve — book {forThis.startsImmediately ? "today" : formatRunDay(forThis.nextStartDay)}
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    name="decision"
                    value="declined"
                    type="submit"
                  >
                    Decline
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="section-h">The spots themselves</h2>

      {params.saved && (
        <p className="notice" role="status">
          Spot added.
        </p>
      )}
      {params.deleted && (
        <p className="notice" role="status">
          Spot deleted.
        </p>
      )}
      {params.error === "photo" && (
        <p className="form-error" role="alert">
          That image couldn&rsquo;t be used — jpg, png, gif, or webp. Big pictures are shrunk in your browser before they upload, so size is rarely the problem.
        </p>
      )}
      {params.error === "link" && (
        <p className="form-error" role="alert">
          The link must be a full web address starting with https:// (or http://).
        </p>
      )}
      {params.error === "migration" && (
        <p className="form-error" role="alert">
          The featured_spots table isn&rsquo;t there yet — run
          supabase/migrations/9977_town_hall_featured.sql in the SQL editor first.
        </p>
      )}

      {spots === null ? (
        <p className="form-error" role="alert">
          Featured spots are dormant: run{" "}
          <span className="cmd">supabase/migrations/9977_town_hall_featured.sql</span> in
          the Supabase SQL editor, then reload. (The homepage simply hides the sidebar
          until then — nothing breaks.) <Tip k="concepts.migrations" />
        </p>
      ) : (
        <>
          {[1, 2, 3, 4].map((slot) => {
            const slotSpots = spots.filter((s) => s.slot === slot);
            const rotating = new Set(
              slotRotation(
                slotSpots.filter((s) => s.active),
                slot,
              ).map((s) => s.id),
            );
            const activeCount = slotSpots.filter((s) => s.active).length;
            return (
              <section key={slot} aria-labelledby={`slot-${slot}-h`}>
                <h2 id={`slot-${slot}-h`} className="section-h">
                  Slot {slot} ({slot <= 2 ? "left" : "right"} column,{" "}
                  {slot % 2 === 1 ? "top" : "bottom"})
                </h2>
                {activeCount > SPOTS_PER_SLOT && (
                  <p className="form-error">
                    {activeCount} spots are active in this slot but only the first{" "}
                    {SPOTS_PER_SLOT} (by order) rotate — turn some off.
                  </p>
                )}
                {slotSpots.length === 0 ? (
                  <p className="fine">Nothing in this slot yet.</p>
                ) : (
                  <ul className="sim-pending">
                    {slotSpots.map((spot: FeaturedSpot) => (
                      <li key={spot.id} className="myad-row">
                        {/* eslint-disable-next-line @next/next/no-img-element -- bucket URLs or dev data: URIs, arbitrary sizes */}
                        <img
                          className="featured-admin-thumb"
                          src={spot.src}
                          alt={spot.caption ?? `Featured spot ${spot.id}`}
                        />
                        <p className="myad-title">
                          Order {spot.position}
                          {spot.active ? (
                            rotating.has(spot.id) ? (
                              <span className="status-available"> · rotating</span>
                            ) : (
                              <span className="ad-sold"> · active but beyond the top {SPOTS_PER_SLOT}</span>
                            )
                          ) : (
                            <span className="status-muted"> · off</span>
                          )}
                        </p>
                        {spot.caption && <p className="myad-dates">{spot.caption}</p>}
                        {spot.linkUrl && (
                          <p className="myad-dates">
                            Links to{" "}
                            <a href={spot.linkUrl} target="_blank" rel="sponsored noopener nofollow">
                              {spot.linkUrl}
                            </a>
                          </p>
                        )}
                        <div className="sim-actions">
                          <form action={adminSetFeaturedActive}>
                            <input type="hidden" name="id" value={spot.id} />
                            <input type="hidden" name="on" value={spot.active ? "no" : "yes"} />
                            <button className="btn btn-sm btn-secondary" type="submit">
                              {spot.active ? "Turn off" : "Turn on"}
                            </button>
                          </form>
                          <form action={adminDeleteFeaturedSpot}>
                            <input type="hidden" name="id" value={spot.id} />
                            <button className="btn btn-sm btn-secondary" type="submit">
                              Delete
                            </button>
                          </form>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <section aria-labelledby="add-spot-h">
            <h2 id="add-spot-h" className="section-h">
              Add a spot
            </h2>
            {!supabaseConfigured && (
              <p className="fine">
                Dev mode: with no storage bucket, the image is inlined as a data: URI so
                the homepage rotation still works in walks. Production re-hosts into the
                bucket like every other picture.
              </p>
            )}
            <form action={adminAddFeaturedSpot}>
              <div className="field">
                <label htmlFor="spot-image">Image (required — jpg/png/gif/webp)</label>
                <ImageUpload id="spot-image" name="image" required />
              </div>
              <div className="field">
                <label htmlFor="spot-caption">Caption (optional, {FEATURED_CAPTION_MAX} chars)</label>
                <input
                  id="spot-caption"
                  name="caption"
                  type="text"
                  maxLength={FEATURED_CAPTION_MAX}
                  placeholder="Miller's Harness Shop — spring sale"
                />
              </div>
              <div className="field">
                <label htmlFor="spot-link">External link (optional — https://…)</label>
                <input
                  id="spot-link"
                  name="link"
                  type="url"
                  placeholder="https://example.com"
                />
              </div>
              <div className="inline-fields">
                <label htmlFor="spot-slot">Slot</label>
                <select id="spot-slot" name="slot" className="admin-select" defaultValue="1">
                  <option value="1">1 — left, top</option>
                  <option value="2">2 — left, bottom</option>
                  <option value="3">3 — right, top</option>
                  <option value="4">4 — right, bottom</option>
                </select>
                <label htmlFor="spot-position">Order</label>
                <select id="spot-position" name="position" className="admin-select" defaultValue="1">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
                <label htmlFor="spot-active">
                  <input id="spot-active" name="active" type="checkbox" defaultChecked /> Active
                </label>
              </div>
              <p className="fine">
                Order decides the rotation sequence inside the slot; only the first{" "}
                {SPOTS_PER_SLOT} active spots rotate. <Tip k="featured.rotation" />
              </p>
              <button className="btn" type="submit">
                Add the spot
              </button>
            </form>
          </section>

          <p className="fine">
            Preview it on the <Link href="/">homepage</Link> — the sidebar sits left of
            the ads on a wide window, above them on a phone.
          </p>
        </>
      )}
    </>
  );
}
