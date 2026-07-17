import Image from "next/image";
import Link from "next/link";
import { type Ad, derivePrice, deriveRest, deriveTitle } from "@/lib/ads";
import { MaskedText, maskPhonesPlain } from "@/components/MaskedText";

export function AdRow({ ad }: { ad: Ad }) {
  // Seller numbers NEVER render in list rows — for anyone, signed-in included
  // (item 23 anti-scraping posture: one signed-in burner account must not be
  // able to scrape every number off a listing page). The per-ad "Show number"
  // reveal lives on the ad page. Title included: it's the ad's lead clause,
  // which can carry the number into the heading / aria-label.
  const title = maskPhonesPlain(deriveTitle(ad.body));
  const price = derivePrice(ad.body);
  const sold = ad.status === "sold";
  // When the excerpt opens with the exact price already shown in the price
  // column ("$850. Pioneer Maid…"), drop it; keep it when it carries context
  // ("$8 each", "$70 a cord").
  let rest = deriveRest(ad.body);
  if (price && rest.startsWith(price) && /^[.,]/.test(rest.slice(price.length))) {
    rest = rest
      .slice(price.length)
      .replace(/^[.,]\s*/, "");
  }

  return (
    <li>
      <article
        className={`ad-row${ad.photo ? " has-photo" : ""}${sold ? " is-sold" : ""}`}
        aria-label={`Ad ${ad.id}: ${title}`}
      >
        {ad.photo && (
          <Link
            className="ad-thumb-link"
            href={`/ad/${ad.id}`}
            tabIndex={-1}
            aria-hidden="true"
          >
            <Image
              className="ad-thumb"
              src={ad.photo.src}
              alt=""
              width={88}
              height={88}
              sizes="(max-width: 30rem) 64px, 88px"
            />
          </Link>
        )}
        <div className="ad-text">
          <h3 className="ad-title">
            <Link href={`/ad/${ad.id}`}>{title}</Link>
          </h3>
          {rest && (
            <p className="ad-body">
              <MaskedText text={rest} />
            </p>
          )}
          <p className="ad-meta">Ad #{ad.id}</p>
        </div>
        {(sold || price) && (
          <p className="ad-price">
            {sold ? <span className="ad-sold">Sold</span> : price}
          </p>
        )}
      </article>
    </li>
  );
}
