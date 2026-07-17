import Link from "next/link";
import { countLiveAdsByCategory, listAds, type Ad } from "@/lib/ads";
import { readSession } from "@/lib/session";
import { categoriesSupported } from "@/lib/store";
import { CATEGORIES, categoryLabel, isCategoryKey } from "@/lib/categories";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";
import { AdRow } from "@/components/AdRow";

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

      <div className="container">
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
            Phone numbers are shown to signed-in members.{" "}
            <Link href="/login">Sign in</Link>
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
    </>
  );
}
