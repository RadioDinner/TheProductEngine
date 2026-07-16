import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveRest, deriveTitle, getAd } from "@/lib/ads";
import { getRatingSummary } from "@/lib/store";
import { startChat } from "@/lib/account-actions";
import { MaskedText, maskPhonesPlain } from "@/components/MaskedText";
import { readSession } from "@/lib/session";
import { recordVisit } from "@/lib/analytics";
import { site } from "@/lib/config";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function postedLine(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = parseId((await params).id);
  const ad = id ? await getAd(id) : null;
  if (!ad || ad.status === "expired") {
    return { title: `Listing not available — ${site.name}` };
  }
  // Metadata is public/crawlable — always mask a phone number in the title too
  // (the description already masks).
  const title = `${maskPhonesPlain(deriveTitle(ad.body))} — ${site.name}`;
  const description = maskPhonesPlain(ad.body);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(ad.photo && {
        images: [
          {
            url: ad.photo.src,
            width: ad.photo.width,
            height: ad.photo.height,
            alt: ad.photo.alt,
          },
        ],
      }),
    },
  };
}

export default async function AdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chat?: string }>;
}) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const ad = await getAd(id);
  if (!ad) notFound();
  const chatParam = (await searchParams).chat;
  await recordVisit("/ad");

  if (ad.status === "expired") {
    return (
      <div className="container">
        <p className="backlink">
          <Link href="/">← All ads</Link>
        </p>
        <div className="empty-state">
          <h1>This listing has ended.</h1>
          <p>
            Ads run for 30 days, and ad #{ad.id} has finished its run. Looking for something
            like it? <Link href="/">See the latest ads</Link> — or text{" "}
            <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> and new ads come to
            you.
          </p>
        </div>
      </div>
    );
  }

  const session = await readSession();
  const sold = ad.status === "sold";
  // Confirmed-buyer ratings of this seller (FEATURES item 2).
  const sellerRating = (await getRatingSummary(ad.ownerPhone)).asSeller;
  // Mask a phone number in the heading for signed-out visitors (the body below
  // is already masked via MaskedText).
  const rawTitle = deriveTitle(ad.body);
  const title = session ? rawTitle : maskPhonesPlain(rawTitle);
  const rest = deriveRest(ad.body);

  return (
    <div className="container ad-page">
      <p className="backlink">
        <Link href="/">← All ads</Link>
      </p>
      <article>
        <h1 className="ad-page-title">{title}</h1>
        <p className="ad-status-line">
          {sold ? (
            <span className="ad-sold">Sold</span>
          ) : (
            <span className="status-available">Available</span>
          )}{" "}
          · Posted {postedLine(ad.approvedAt)} · Ad #{ad.id}
          {sellerRating.count > 0 && (
            <>
              {" "}
              · Seller rated ★ {sellerRating.average} by {sellerRating.count} confirmed{" "}
              {sellerRating.count === 1 ? "buyer" : "buyers"}
            </>
          )}
        </p>
        {ad.photo && (
          <figure className="ad-photo">
            <Image
              src={ad.photo.src}
              alt={ad.photo.alt}
              width={ad.photo.width}
              height={ad.photo.height}
              sizes="(max-width: 46rem) 100vw, 688px"
              priority
            />
          </figure>
        )}
        {(ad.photos?.length ?? 0) > 1 && (
          <div className="ad-photo-gallery" aria-label="More pictures">
            {ad.photos!.slice(1).map((photo, i) => (
              <a key={photo.src} href={photo.src} target="_blank" rel="noreferrer">
                {/* Extras are plain storage/data URLs (emailed in, admin-approved);
                    a plain img keeps them outside next/image's host allowlist. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.src}
                  alt={photo.alt || `More of ad #${ad.id} (${i + 2})`}
                  loading="lazy"
                  style={{ maxWidth: "100%", height: "auto" }}
                />
              </a>
            ))}
          </div>
        )}
        <p className="ad-fulltext">
          <MaskedText text={rest || ad.body} revealed={!!session} />
        </p>
      </article>
      {session && !sold && session.phone !== ad.ownerPhone && (
        <aside className="contact-gate" aria-label="Message the seller">
          <h2>Message the seller</h2>
          <p>
            Ask a question or make an offer right here — your phone number stays private
            (messages travel between member numbers).
          </p>
          {chatParam === "unavailable" && (
            <p className="form-error" role="alert">
              Messaging isn&apos;t available just yet — use the contact info in the ad above.
            </p>
          )}
          <form action={startChat}>
            <input type="hidden" name="adId" value={ad.id} />
            <button className="btn btn-sm" type="submit">
              Message the seller on {site.name}
            </button>
          </form>
        </aside>
      )}
      {sold ? (
        <aside className="contact-gate" aria-label="Item sold">
          <h2>This item has sold</h2>
          <p>
            The seller marked ad #{ad.id} sold. <Link href="/">See the latest ads</Link> — or
            text <strong>SUBSCRIBE</strong> to <strong>{site.smsNumber}</strong> and the next
            one like it comes to you.
          </p>
        </aside>
      ) : (
        !session && (
          <aside className="contact-gate" aria-label="Reaching the seller">
            <h2>Reaching the seller</h2>
            <p>
              The seller’s contact is in the ad above. Phone numbers are shown to signed-in
              members —{" "}
              <Link href={`/login?next=${encodeURIComponent(`/ad/${ad.id}`)}`}>
                sign in with your phone number
              </Link>{" "}
              to see it. It takes about a minute.
            </p>
          </aside>
        )
      )}
    </div>
  );
}
