import Link from "next/link";
import { countLiveAdsByCategory, listAds, type Ad } from "@/lib/ads";
import { readSession } from "@/lib/session";
import { categoriesSupported } from "@/lib/store";
import { CATEGORIES, categoryLabel, isCategoryKey } from "@/lib/categories";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";
import { etParts } from "@/lib/et";
import { formatEventDay } from "@/lib/town-hall";
import { listUpcomingEvents } from "@/lib/town-hall-store";
import { slotRotation } from "@/lib/featured";
import { listActiveFeaturedSpots } from "@/lib/featured-store";
import { AdRow } from "@/components/AdRow";
import { FeaturedRotator, type RotatorSpot } from "@/components/FeaturedRotator";
import { maskPhonesPlain } from "@/components/MaskedText";

/** Upcoming events shown in the homepage sidebar (the full board is /town-hall). */
const SIDEBAR_EVENTS = 5;

function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function groupByDay(ads: Ad[]): { label: string; ads: Ad[] }[] {
  const groups: { label: string; ads: Ad[] }[] = [];
  for (const ad of ads) {
    const label = dayLabel(ad.approvedAt);
    const current = groups[groups.length - 1];
    if (current?.label === label) {
      current.ads.push(ad);
    } else {
      groups.push({ label, ads: [ad] });
    }
  }
  return groups;
}

function pageHref(q: string | undefined, category: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string }>;
}) {
  const params = await searchParams;
  const session = await readSession();
  await recordVisit("/");
  const q = params.q?.trim() || undefined;
  // Category browse filter (item 25): server-rendered, works signed-out.
  // Hidden (and the param ignored) until migration 9976 — never a 500.
  const withCategories = await categoriesSupported();
  const category =
    withCategories && params.category && isCategoryKey(params.category)
      ? params.category
      : undefined;
  const { ads, total, page, totalPages } = await listAds({
    q,
    category,
    page: Number(params.page) || 1,
    perPage: site.adsPerPage,
  });
  const categoryCounts = withCategories ? await countLiveAdsByCategory() : null;
  const groups = groupByDay(ads);
  // Town hall sidebar (item 18) — null until migration 9977 (sidebar hides).
  const events = await listUpcomingEvents(etParts(new Date()).day, SIDEBAR_EVENTS);
  // Featured sidebar (item 19) — [] until migration 9977 or while the
  // operator has nothing active (either way the sidebar hides entirely).
  const featured = await listActiveFeaturedSpots();
  const toRotator = (spots: typeof featured): RotatorSpot[] =>
    spots.map((s) => ({ id: s.id, src: s.src, caption: s.caption, linkUrl: s.linkUrl }));
  const slot1 = toRotator(slotRotation(featured, 1));
  const slot2 = toRotator(slotRotation(featured, 2));

  return (
    <>
      {/* Visitor opt-in surface (10DLC CTA) — a signed-in member already
          subscribed, so the pitch would just be noise for them (item 11).
          The every-page HELP/STOP paragraph stays in the layout footer. */}
      {!session && (
        <div className="subscribe-strip">
          <p className="container">
            Get the ads by text — text <strong>SUBSCRIBE</strong> to{" "}
            <strong className="tel">{site.smsNumber}</strong>. Free, up to 4 digests a day; msg
            &amp; data rates may apply. Reply <strong>HELP</strong> for help,{" "}
            <strong>STOP</strong> to cancel. <Link href="/sms">Text terms</Link> ·{" "}
            <Link href="/privacy">Privacy</Link>.
          </p>
        </div>
      )}

      {/* Broadsheet layout (items 18/19): featured-left / ads-center /
          town-hall-right on wide screens; on narrow screens the DOM order IS
          the stack — Featured above the ads, Town hall below. Either sidebar
          hides entirely when it has nothing to show (no empty scaffolding). */}
      <div className="home-layout">
      {/* Featured sidebar (item 19) — operator-posted image spots; hides
          entirely when nothing is active. On narrow screens only slot 1
          shows (compact), above the ads. */}
      {(slot1.length > 0 || slot2.length > 0) && (
        <aside className="home-side home-featured" aria-labelledby="featured-h">
          <h2 id="featured-h" className="side-h">
            Featured
          </h2>
          {slot1.length > 0 && <FeaturedRotator slot={1} spots={slot1} />}
          {slot2.length > 0 &&
            (slot1.length > 0 ? (
              // Narrow screens keep just ONE compact slot above the ads —
              // .featured-secondary hides below the grid breakpoint.
              <div className="featured-secondary">
                <FeaturedRotator slot={2} spots={slot2} />
              </div>
            ) : (
              <FeaturedRotator slot={2} spots={slot2} />
            ))}
        </aside>
      )}
      <div className="home-center container">
        <h1 className="visually-hidden">Latest classified ads</h1>

        <form className="search" action="/" method="get" role="search">
          <label className="visually-hidden" htmlFor="q">
            Search the ads
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Search the ads — hay, stove, horse…"
          />
          {/* A GET form replaces the whole query string on submit — carry the
              active category so searching within a category doesn't silently
              drop the filter (category is undefined pre-9976, so nothing
              renders before the migration). */}
          {category && <input type="hidden" name="category" value={category} />}
          <button type="submit">Search</button>
        </form>
        {session ? (
          // Signed-in members see masked numbers in list rows too (item 23):
          // explain the one-click unmask so the dots don't read as a bug.
          <p className="search-note">
            Open an ad and press &ldquo;Show number&rdquo; to see the seller&rsquo;s number.
          </p>
        ) : (
          <p className="search-note">
            <Link href="/login">Sign in</Link>, then press &ldquo;Show number&rdquo; on an ad
            to see the seller&rsquo;s number.
          </p>
        )}

        {withCategories && (
          <nav className="category-row" aria-label="Browse by category">
            {category ? (
              <Link href={pageHref(q, undefined, 1)}>All</Link>
            ) : (
              <span className="category-active" aria-current="page">
                All
              </span>
            )}
            {CATEGORIES.map((c) => {
              const empty = (categoryCounts?.get(c.key) ?? 0) === 0;
              return category === c.key ? (
                <span key={c.key} className="category-active" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link
                  key={c.key}
                  className={empty ? "category-empty" : undefined}
                  href={pageHref(q, c.key, 1)}
                >
                  {c.label}
                </Link>
              );
            })}
          </nav>
        )}

        {q && total > 0 && (
          <p className="result-line">
            {total} {total === 1 ? "ad matches" : "ads match"} “{q}”.{" "}
            <Link href={pageHref(undefined, category, 1)}>Clear search</Link>
          </p>
        )}

        {total === 0 && q && (
          <div className="empty-state">
            <h2>No ads match “{q}”.</h2>
            <p>
              Try a different word, or <Link href="/">see all the ads</Link>.
            </p>
          </div>
        )}

        {total === 0 && !q && category && (
          <div className="empty-state">
            <h2>No {categoryLabel(category)} ads right now.</h2>
            <p>
              New ads land here as they run — <Link href="/">see all the ads</Link>, or text{" "}
              <strong>{category.toUpperCase()}</strong> to <strong>{site.smsNumber}</strong>{" "}
              and they’ll come to you.
            </p>
          </div>
        )}

        {total === 0 && !q && !category && (
          <div className="empty-state">
            <h2>The first ads run soon.</h2>
            <p>
              Text <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> and they’ll
              come to you.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="day-heading">{group.label}</h2>
            <ul className="ad-list">
              {group.ads.map((ad) => (
                <AdRow key={ad.id} ad={ad} />
              ))}
            </ul>
          </section>
        ))}

        {totalPages > 1 && (
          <nav className="pagination" aria-label="Pages">
            {page > 1 ? (
              <Link href={pageHref(q, category, page - 1)}>← Newer ads</Link>
            ) : (
              <span className="spacer" aria-hidden="true">
                ← Newer ads
              </span>
            )}
            {page < totalPages ? (
              <Link href={pageHref(q, category, page + 1)}>Older ads →</Link>
            ) : (
              <span className="spacer" aria-hidden="true">
                Older ads →
              </span>
            )}
          </nav>
        )}
      </div>

      {/* Town hall sidebar (item 18) — hides until migration 9977 is pasted. */}
      {events !== null && (
        <aside className="home-side home-townhall" aria-labelledby="townhall-h">
          <h2 id="townhall-h" className="side-h">
            <Link href="/town-hall">Town hall</Link>
          </h2>
          {events.length === 0 ? (
            <p className="side-note">Nothing on the calendar yet.</p>
          ) : (
            <ul className="side-events">
              {/* Visitors get masked numbers here too — same posture as the
                  full /town-hall board (numbers land in these free-text
                  fields by the board's own instruction). */}
              {events.map((event) => (
                <li key={event.id}>
                  <p className="side-event-when">
                    {formatEventDay(event.eventDate)}
                    {event.timeText
                      ? ` · ${session ? event.timeText : maskPhonesPlain(event.timeText)}`
                      : ""}
                  </p>
                  <p className="side-event-title">
                    <Link href="/town-hall">
                      {session ? event.title : maskPhonesPlain(event.title)}
                    </Link>
                  </p>
                  {event.placeText && (
                    <p className="side-event-place">
                      {session ? event.placeText : maskPhonesPlain(event.placeText)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="side-note">
            <Link href="/town-hall">See the board</Link> ·{" "}
            <Link href="/town-hall#add">Add your event</Link>
          </p>
        </aside>
      )}
      </div>
    </>
  );
}
