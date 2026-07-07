import Link from "next/link";
import { listAds, type Ad } from "@/lib/ads";
import { readSession } from "@/lib/session";
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

function pageHref(q: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await readSession();
  await recordVisit("/");
  const q = params.q?.trim() || undefined;
  const { ads, total, page, totalPages } = await listAds({
    q,
    page: Number(params.page) || 1,
    perPage: site.adsPerPage,
  });
  const groups = groupByDay(ads);

  return (
    <>
      <div className="subscribe-strip">
        <p className="container">
          Get the ads by text — text <strong>SUBSCRIBE</strong> to{" "}
          <strong className="tel">{site.smsNumber}</strong>. Free, up to four digests a day.
        </p>
      </div>

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
        {!session && (
          <p className="search-note">
            Phone numbers are shown to signed-in members.{" "}
            <Link href="/login">Sign in</Link>
          </p>
        )}

        {q && total > 0 && (
          <p className="result-line">
            {total} {total === 1 ? "ad matches" : "ads match"} “{q}”.{" "}
            <Link href="/">Clear search</Link>
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

        {total === 0 && !q && (
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
                <AdRow key={ad.id} ad={ad} revealed={!!session} />
              ))}
            </ul>
          </section>
        ))}

        {totalPages > 1 && (
          <nav className="pagination" aria-label="Pages">
            {page > 1 ? (
              <Link href={pageHref(q, page - 1)}>← Newer ads</Link>
            ) : (
              <span className="spacer" aria-hidden="true">
                ← Newer ads
              </span>
            )}
            {page < totalPages ? (
              <Link href={pageHref(q, page + 1)}>Older ads →</Link>
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
