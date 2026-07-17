import type { Metadata } from "next";
import Link from "next/link";
import {
  adminAddFeaturedSpot,
  adminDeleteFeaturedSpot,
  adminSetFeaturedActive,
} from "@/lib/admin-actions";
import { FEATURED_CAPTION_MAX, SPOTS_PER_SLOT, slotRotation } from "@/lib/featured";
import { listFeaturedSpots, type FeaturedSpot } from "@/lib/featured-store";
import { supabaseConfigured } from "@/lib/db";
import { site } from "@/lib/config";

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

  return (
    <>
      <h1>Featured spots</h1>
      <p className="fine">
        The homepage&rsquo;s left sidebar: TWO Featured slots stacked, each rotating every
        8 seconds through up to {SPOTS_PER_SLOT} image ads — 6 sellable spots total.
        You post them here by hand (there&rsquo;s no self-serve selling flow yet; pricing
        isn&rsquo;t set). A spot&rsquo;s external link is the one sanctioned exception to
        the no-links rule and is marked <span className="cmd">rel=&quot;sponsored&quot;</span>{" "}
        for search engines. The sidebar hides itself whenever nothing is active.
      </p>

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
          That image couldn&rsquo;t be used — jpg, png, gif, or webp up to 8 MB.
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
          until then — nothing breaks.)
        </p>
      ) : (
        <>
          {[1, 2].map((slot) => {
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
                  Slot {slot} {slot === 1 ? "(top)" : "(bottom)"}
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
                <label htmlFor="spot-image">Image (required — jpg/png/gif/webp, 8 MB)</label>
                <input id="spot-image" name="image" type="file" accept="image/*" required />
              </div>
              <div className="field">
                <label htmlFor="spot-caption">Caption (optional, {FEATURED_CAPTION_MAX} chars)</label>
                <input
                  id="spot-caption"
                  name="caption"
                  type="text"
                  maxLength={FEATURED_CAPTION_MAX}
                  placeholder="Troyer's Harness Shop — spring sale"
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
                  <option value="1">1 (top)</option>
                  <option value="2">2 (bottom)</option>
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
                {SPOTS_PER_SLOT} active spots rotate.
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
