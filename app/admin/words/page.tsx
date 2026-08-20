import type { Metadata } from "next";
import Link from "next/link";
import { getWordRules } from "@/lib/settings";
import { adminSaveWordFilter } from "@/lib/admin-actions";
import { formatWordList, splitWordRules, MAX_WORDS_PER_LIST } from "@/lib/word-filter";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Word filter — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function AdminWords({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const saved = (await searchParams).saved;

  let rules: Awaited<ReturnType<typeof getWordRules>> = [];
  let failed = false;
  try {
    rules = await getWordRules();
  } catch (e) {
    failed = true;
    console.error("[admin/words] failed to load rules:", e);
  }
  const { reject, flag } = splitWordRules(rules);

  return (
    <>
      <h1>
        Word filter <Tip k="settings.wordFilter" />
      </h1>

      {saved === "empty" ? (
        <p className="notice" role="status">
          Nothing saved — both boxes were empty. Emptying the filter entirely turns off
          every word rule, so tick <strong>&ldquo;Yes, empty the filter&rdquo;</strong> below
          and save again if that is really what you want.
        </p>
      ) : saved ? (
        <p className="notice" role="status">
          Saved. The filter now holds <strong>{saved}</strong>{" "}
          {saved === "1" ? "word" : "words"}.
        </p>
      ) : null}

      {failed && (
        <p className="notice" role="status">
          The word list couldn&rsquo;t load, so saving is turned off — a save right now would
          write over rules this page can&rsquo;t see. The exact error is in the server logs.
        </p>
      )}

      <p className="fine">
        Type words separated by commas. Whatever is in these boxes when you press Save
        <strong> is</strong> the filter — a word you delete here stops being filtered.
        Matching is whole-word and ignores capitals, so <em>gun</em> catches
        &ldquo;Gun&rdquo; but not &ldquo;shotgun.&rdquo; Short phrases work too
        (<em>free money</em>). Up to {MAX_WORDS_PER_LIST} words per list.
      </p>

      {!failed && (
        <form action={adminSaveWordFilter} className="review-form">
          <div className="field">
            <label htmlFor="reject">Auto-reject words</label>
            <textarea
              id="reject"
              name="reject"
              rows={5}
              defaultValue={formatWordList(reject)}
              placeholder="gun, firearm, rifle"
            />
            <p className="fine">
              An ad containing any of these is bounced the instant it arrives —{" "}
              <strong>nothing charged, no strike against the seller</strong>, and the ad is
              kept for the audit trail. Use it for the things you will never run.
            </p>
          </div>

          <div className="field">
            <label htmlFor="flag">Flag-for-review words</label>
            <textarea
              id="flag"
              name="flag"
              rows={5}
              defaultValue={formatWordList(flag)}
              placeholder="whiskey, tobacco"
            />
            <p className="fine">
              These don&rsquo;t block anything. An ad containing one sorts to the top of the{" "}
              <Link href="/admin/review">Review</Link> queue so you see it first and decide
              yourself. Use it for the things that usually need a second look.
            </p>
          </div>

          <p className="fine">
            A word in both boxes is treated as auto-reject — the stricter rule wins.
          </p>

          <label className="sim-photo-toggle">
            <input type="checkbox" name="confirmEmpty" value="yes" /> Yes, empty the filter
            (only needed when you are clearing both boxes)
          </label>

          <button className="btn" type="submit">
            Save word filter
          </button>
        </form>
      )}

      <h2 className="section-h">What is filtered now</h2>
      {rules.length ? (
        <ul className="myads">
          {rules
            .slice()
            .sort((a, b) => a.word.localeCompare(b.word))
            .map((w) => (
              <li key={w.word} className="myad-row">
                <div className="sim-actions">
                  <span className="pack-name">{w.word}</span>
                  <span className={w.autoReject ? "ad-sold" : "status-muted"}>
                    {w.autoReject ? "auto-reject" : "flag only"}
                  </span>
                </div>
              </li>
            ))}
        </ul>
      ) : (
        <p className="status-muted">
          No words filtered. Every ad goes straight to the review queue unsorted.
        </p>
      )}
    </>
  );
}
