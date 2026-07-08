import Image from "next/image";
import Link from "next/link";
import { type Ad, derivePrice, deriveRest, deriveTitle } from "@/lib/ads";
import { MaskedText, maskPhonesPlain } from "@/components/MaskedText";

export function AdRow({ ad, revealed }: { ad: Ad; revealed?: boolean }) {
  // The title is the ad's lead clause, which can contain a phone number — mask
  // it for signed-out visitors just like the body, so PII doesn't leak in the
  // heading / aria-label.
  const rawTitle = deriveTitle(ad.body);
  const title = revealed ? rawTitle : maskPhonesPlain(rawTitle);
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
              <MaskedText text={rest} revealed={revealed} />
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
