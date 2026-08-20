import { TrackEvent } from "@/analytics/src/TrackEvent";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { postAd } from "@/lib/post-actions";
import { readSession } from "@/lib/session";
import { categoriesSupported, getAccount, getAutoTopUp, getCreditBalance } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";
import { CATEGORIES } from "@/lib/categories";
import { formatPrice, site } from "@/lib/config";
import { chargeNoteLine, postingPreview } from "@/lib/post-ad";
import { AdBodyField } from "@/components/AdBodyField";
import { ImageUpload } from "@/components/ImageUpload";

export const metadata: Metadata = {
  title: `Post an ad — ${site.name}`,
  robots: { index: false },
};

export default async function PostAdPage({
  searchParams,
}: {
  searchParams: Promise<{
    posted?: string;
    charge?: string;
    cost?: string;
    left?: string;
    topup?: string;
    welcome?: string;
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
  const autoTopUp = Boolean(account?.stripeCustomerId) && (await getAutoTopUp(session.phone));
  const preview = postingPreview(
    {
      starterGranted: Boolean(account?.starterGrantedAt),
      balanceCents: balance,
      autoTopUp,
    },
    settings.costTextCents,
    settings.costPhotoCents,
    settings.starterCreditCents,
  );

  // Confirmation state (redirect-with-query-params, repo convention). The ad
  // is PENDING — it is deliberately not promised as "live on the website".
  const postedId = Number(params.posted);
  const posted = Number.isInteger(postedId) && postedId > 0;
  const chargeNote = !posted
    ? null
    : chargeNoteLine({
        costCents: Number(params.cost) || 0,
        leftCents: Number(params.left) || 0,
        toppedUpCents: Number(params.topup) || 0,
        ...(Number(params.welcome) > 0 && {
          welcomeLabel: formatPrice(Number(params.welcome)),
        }),
      });
  const extrasSaved = Number(params.extras) || 0;
  const extrasSkipped = Number(params.extraskip) || 0;

  return (
    <div className="container account">
      {/* How many people open the form and never finish. The gap between
          this and post_submit is the posting form's own conversion rate. */}
      <TrackEvent name="post_start" />
      <h1>Post an ad</h1>
      <p>
        Posting here costs <strong>exactly the same</strong> as texting AD NEW to{" "}
        {site.smsNumber} — it comes off your ad-credit balance — and every ad goes to the
        same review before it runs. Firearms are not allowed; see the{" "}
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
              couldn&rsquo;t be used — jpg, png, gif, or webp, and at most 8
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
          That ad costs {formatPrice(Number(params.cost) || settings.costTextCents)} and you
          have {formatPrice(Number(params.balance) || 0)} of ad credit. Nothing was posted
          or charged — <Link href="/account#credits">add money</Link> and try again, or call{" "}
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
                <dd>{formatPrice(settings.costTextCents)}</dd>
              </div>
              <div>
                <dt>Picture ad (up to 3 pictures)</dt>
                <dd>{formatPrice(settings.costPhotoCents)}</dd>
              </div>
              <div>
                <dt>Website listing</dt>
                <dd>
                  {settings.webAddonCents > 0
                    ? `+${formatPrice(settings.webAddonCents)}`
                    : "included"}
                </dd>
              </div>
              <div>
                <dt>Your ad-credit balance</dt>
                <dd>{formatPrice(balance)}</dd>
              </div>
            </dl>
            {preview.starterGrantApplies ? (
              <p>
                <strong>This is your first ad, so it&rsquo;s covered:</strong> your first
                post comes with {formatPrice(settings.starterCreditCents)} of welcome
                credit. This ad&rsquo;s price comes out of that, and the rest stays on your
                account for next time.
              </p>
            ) : preview.canAffordPicture ? (
              <p>
                <strong>This ad comes off your balance:</strong>{" "}
                {formatPrice(settings.costTextCents)} as a text ad, or{" "}
                {formatPrice(settings.costPhotoCents)} with a listing picture. You have{" "}
                {formatPrice(balance)}.
              </p>
            ) : preview.canAffordText ? (
              <p>
                <strong>This ad comes off your balance:</strong> your{" "}
                {formatPrice(balance)} covers a text ad (
                {formatPrice(settings.costTextCents)}) but not a picture ad (
                {formatPrice(settings.costPhotoCents)}) —{" "}
                <Link href="/account#credits">add money</Link> if you want the picture.
              </p>
            ) : (
              <p className="form-error">
                Your balance of {formatPrice(balance)} doesn&rsquo;t cover a text ad (
                {formatPrice(settings.costTextCents)}).{" "}
                <Link href="/account#credits">Add money</Link> first — nothing is charged
                until an ad actually posts.
              </p>
            )}
            {autoTopUp && !preview.starterGrantApplies && !preview.canAffordPicture && (
              <p className="fine">
                Automatic top-up is on: if your balance comes up short, the difference is
                charged to your saved card and the confirmation says so. Turn it off under{" "}
                <Link href="/account#credits">your account</Link>.
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
                <ImageUpload id="listing-photo" name="photo" />
              </div>
              <p className="fine">
                This ONE picture is the paid picture: it makes this a picture ad (
                {formatPrice(settings.costPhotoCents)} instead of{" "}
                {formatPrice(settings.costTextCents)}) and rides the digest and PIC replies
                with your ad. Jpg, png, gif, or webp — a big photo is shrunk right in your browser, so it uploads fast even on a slow connection.
              </p>
              {settings.webAddonCents > 0 && (
                <>
                  <div className="field">
                    <label className="sim-photo-toggle">
                      <input type="checkbox" name="weblisting" defaultChecked /> List my ad
                      on the website too — +{formatPrice(settings.webAddonCents)}
                    </label>
                  </div>
                  <p className="fine">
                    Every ad rides the text digest. The website listing keeps it browsable
                    on ThePlainExchange.com for {settings.expiryDays} days, pictures and
                    all. Uncheck to skip it.
                  </p>
                </>
              )}
              <div className="field">
                <label htmlFor="extra-photos">Extra pictures (optional — website only, free)</label>
                <ImageUpload id="extra-photos" name="extras" multiple />
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
