import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { postAd } from "@/lib/post-actions";
import { readSession } from "@/lib/session";
import { categoriesSupported, getAccount, getCreditBalance, STARTER_FREE_ADS } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { CATEGORIES } from "@/lib/categories";
import { site } from "@/lib/config";
import { chargeNoteLine, postingPreview } from "@/lib/post-ad";
import { AdBodyField } from "@/components/AdBodyField";

export const metadata: Metadata = {
  title: `Post an ad — ${site.name}`,
  robots: { index: false },
};

const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

export default async function PostAdPage({
  searchParams,
}: {
  searchParams: Promise<{
    posted?: string;
    charge?: string;
    cost?: string;
    left?: string;
    nopic?: string;
    extras?: string;
    extraskip?: string;
    extrasoff?: string;
    error?: string;
    length?: string;
    max?: string;
    balance?: string;
  }>;
}) {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fpost");

  const params = await searchParams;
  const account = await getAccount(session.phone);
  const balance = await getCreditBalance(session.phone);
  const settings = await getEngineSettings();
  // Optional seller category picker (item 22) — hidden until migration 9976.
  const withCategories = await categoriesSupported();
  const banned = Boolean(account?.postingBannedAt);
  const preview = postingPreview(
    {
      freeAds: account?.freeAds ?? 0,
      starterGranted: Boolean(account?.starterGrantedAt),
      balance,
    },
    settings.costText,
    settings.costPhoto,
    STARTER_FREE_ADS,
  );

  // Confirmation state (redirect-with-query-params, repo convention). The ad
  // is PENDING — it is deliberately not promised as "live on the website".
  const postedId = Number(params.posted);
  const posted = Number.isInteger(postedId) && postedId > 0;
  const chargeNote = !posted
    ? null
    : params.charge === "free"
      ? chargeNoteLine({ kind: "free", left: Number(params.left) || 0 })
      : chargeNoteLine({
          kind: "credits",
          cost: Number(params.cost) || 0,
          left: Number(params.left) || 0,
        });
  const extrasSaved = Number(params.extras) || 0;
  const extrasSkipped = Number(params.extraskip) || 0;

  return (
    <div className="container account">
      <h1>Post an ad</h1>
      <p>
        Posting here costs <strong>exactly the same</strong> as texting AD NEW to{" "}
        {site.smsNumber}: a free ad pass covers it if you have one, otherwise credits — and
        every ad goes to the same review before it runs. Firearms are not allowed; see the{" "}
        <Link href="/terms-and-conditions">posting rules</Link>.
      </p>

      {posted && (
        <div className="notice" role="status">
          <p>
            <strong>Got it! Your ad is #{postedId} and is waiting for review.</strong>{" "}
            You&rsquo;ll get a text when it&rsquo;s approved to run in an upcoming digest.
            ({chargeNote})
          </p>
          {params.nopic && (
            <p>
              Note: we couldn&rsquo;t save your listing picture, so ad #{postedId} will run
              as a <strong>text-only ad at the text price</strong> — you were not charged
              the picture price. Call {site.supportPhone} if you&rsquo;d like help adding
              the picture.
            </p>
          )}
          {extrasSaved > 0 && (
            <p>
              {extrasSaved === 1 ? "1 extra picture" : `${extrasSaved} extra pictures`} went
              in for review — once approved they appear in your ad&rsquo;s website gallery
              only (they never ride the text digest).
            </p>
          )}
          {extrasSkipped > 0 && (
            <p>
              {extrasSkipped === 1 ? "1 extra picture" : `${extrasSkipped} extra pictures`}{" "}
              couldn&rsquo;t be used — jpg, png, gif, or webp up to 8 MB, and at most 8
              pictures per ad in total.
            </p>
          )}
          {params.extrasoff && (
            <p>Extra pictures aren&rsquo;t available just yet — your ad itself is in.</p>
          )}
          <p>
            While it waits, it&rsquo;s listed under{" "}
            <Link href="/account#my-ads">My ads</Link> as &ldquo;Waiting for review&rdquo;.
          </p>
        </div>
      )}

      {params.error === "empty" && (
        <p className="form-error" role="alert">
          Your ad came through empty. Emoji are removed automatically, so write it in plain
          words and try again.
        </p>
      )}
      {params.error === "toolong" && (
        <p className="form-error" role="alert">
          Your ad is too long ({Number(params.length) || 0}/{Number(params.max) || settings.maxChars}{" "}
          characters). Please shorten it and post again. Nothing was charged.
        </p>
      )}
      {params.error === "autoreject" && (
        <p className="form-error" role="alert">
          Your ad can&rsquo;t be accepted — it appears to offer something we can&rsquo;t
          run. Nothing was charged. See <Link href="/how-it-works">how it works</Link> or
          call {site.supportPhone}.
        </p>
      )}
      {params.error === "server" && (
        <p className="form-error" role="alert">
          Something went wrong on our end and your ad didn&rsquo;t go through — nothing was
          charged. Please try again in a few minutes, or call {site.supportPhone} for help.
        </p>
      )}
      {params.error === "funds" && (
        <p className="form-error" role="alert">
          That ad needs {credits(Number(params.cost) || settings.costText)} and you have{" "}
          {Number(params.balance) || 0}. Nothing was posted or charged —{" "}
          <Link href="/account#credits">buy credits</Link> and try again, or call{" "}
          {site.supportPhone}.
        </p>
      )}

      {banned ? (
        <p className="form-error" role="alert">
          Your posting privileges are suspended. Contact us at {site.supportPhone} to
          appeal.
        </p>
      ) : (
        <>
          <section aria-labelledby="price-h">
            <h2 id="price-h" className="section-h">
              The price, before you post
            </h2>
            <dl className="account-facts">
              <div>
                <dt>Text ad</dt>
                <dd>{credits(settings.costText)}</dd>
              </div>
              <div>
                <dt>Picture ad</dt>
                <dd>{credits(settings.costPhoto)}</dd>
              </div>
              <div>
                <dt>Your free ad passes</dt>
                <dd>{account?.freeAds ?? 0}</dd>
              </div>
              <div>
                <dt>Your credit balance</dt>
                <dd>{balance}</dd>
              </div>
            </dl>
            {preview.starterGrantApplies ? (
              <p>
                <strong>This is your first ad, so it&rsquo;s on the house:</strong> your
                first post comes with {STARTER_FREE_ADS} free ad passes (picture or plain).
                This ad will use one — nothing is charged — and{" "}
                {preview.freeAdsAtPost - 1} will be left for next time.
              </p>
            ) : preview.usesFreePass ? (
              <p>
                <strong>This ad will use 1 free ad pass</strong> (picture or plain) — no
                credits are charged. You&rsquo;ll have {preview.freeAdsAtPost - 1} pass
                {preview.freeAdsAtPost - 1 === 1 ? "" : "es"} left.
              </p>
            ) : preview.canAffordPicture ? (
              <p>
                <strong>This ad will be charged in credits:</strong>{" "}
                {credits(settings.costText)} as a text ad, or {credits(settings.costPhoto)}{" "}
                with a listing picture. You have {balance}.
              </p>
            ) : preview.canAffordText ? (
              <p>
                <strong>This ad will be charged in credits:</strong> your balance of{" "}
                {balance} covers a text ad ({credits(settings.costText)}) but not a picture
                ad ({credits(settings.costPhoto)}) —{" "}
                <Link href="/account#credits">buy credits</Link> if you want the picture.
              </p>
            ) : (
              <p className="form-error">
                You&rsquo;re out of free ad passes and your balance of {balance} doesn&rsquo;t
                cover a text ad ({credits(settings.costText)}).{" "}
                <Link href="/account#credits">Buy credits</Link> first — nothing is charged
                until an ad actually posts.
              </p>
            )}
          </section>

          <section aria-labelledby="post-form-h">
            <h2 id="post-form-h" className="section-h">
              Your ad
            </h2>
            <form action={postAd}>
              <AdBodyField maxChars={settings.maxChars} />
              <p className="fine">
                Your ad&rsquo;s exact text rides the SMS digest, so keep it brief — the same{" "}
                {settings.maxChars}-character limit as texting it in. Emoji are removed;
                links get held for review.
              </p>
              {withCategories && (
                <div className="field">
                  <label htmlFor="post-category">Category (optional)</label>
                  <select id="post-category" name="category" defaultValue="" className="admin-select">
                    <option value="">Let the operator pick at review</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label} — {c.menu}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {withCategories && (
                <p className="fine">
                  Your pick is a suggestion — the operator can adjust it at review so
                  subscribers who chose that category get the right ads.
                </p>
              )}
              <div className="field">
                <label htmlFor="listing-photo">Listing picture (optional — picture price)</label>
                <input id="listing-photo" name="photo" type="file" accept="image/*" />
              </div>
              <p className="fine">
                This ONE picture is the paid picture: it makes this a picture ad (
                {credits(settings.costPhoto)} instead of {credits(settings.costText)}) and
                rides the digest and PIC replies with your ad. Jpg, png, gif, or webp up to
                8 MB.
              </p>
              <div className="field">
                <label htmlFor="extra-photos">Extra pictures (optional — website only, free)</label>
                <input id="extra-photos" name="extras" type="file" accept="image/*" multiple />
              </div>
              <p className="fine">
                Extra pictures show in your ad&rsquo;s <strong>website gallery only</strong>{" "}
                — they never ride the text digest and don&rsquo;t change the price. Each one
                is reviewed before it appears. At most 8 pictures per ad in total.
              </p>
              <button className="btn btn-block" type="submit">
                Post my ad
              </button>
            </form>
            <p className="fine">
              Every ad waits for review first, then runs in an upcoming digest — same as
              texting it in. You&rsquo;ll get a text when it&rsquo;s approved.
            </p>
          </section>
        </>
      )}

      <p>
        <Link href="/account">← Back to your account</Link>
      </p>
    </div>
  );
}
