import type { Metadata } from "next";
import Link from "next/link";
import { getWordRules } from "@/lib/settings";
import {
  adminAddWords,
  adminRemoveWords,
  adminSaveWordFilter,
} from "@/lib/admin-actions";
import { formatWordList, splitWordRules, MAX_WORDS_PER_LIST } from "@/lib/word-filter";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Word filter — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The word filter tab.
 *
 * ⚠️ THE LIST IS HIDDEN BY DEFAULT, AND THAT IS THE FEATURE (session 019, user
 * request: "if I load the webpage on my work computer, I'll get all kinds of
 * flagged because of the bad language").
 *
 * The filter is several hundred obscene words. They live in the database and
 * nothing public ever renders them — but this page used to put every one of
 * them on screen twice, in the textareas and again in a list underneath. An
 * operator opening it from an ordinary workplace hands that whole screen to
 * whatever corporate web filter or DLP agent is watching that browser, and a
 * page of slurs is precisely what those escalate on.
 *
 * So the default view shows COUNTS and nothing else, and the day-to-day edits
 * — add these words, remove those words — are done by typing what changes
 * rather than by editing the whole list in place. `?show=1` brings back the
 * full editor for when you are somewhere you don't mind seeing it.
 *
 * The wipe-capable Save form renders ONLY in that revealed view. It treats the
 * boxes as the entire state, so rendering it beside empty boxes would put a
 * one-click "delete the whole filter" on a page whose whole point is not
 * loading the filter.
 */
export default async function AdminWords({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    show?: string;
    added?: string;
    removed?: string;
    asked?: string;
    list?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const revealed = params.show === "1";

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

      {/* ---------------- what just happened ---------------- */}
      {params.added && (
        <p className="notice" role="status">
          Added <strong>{params.added}</strong> {params.added === "1" ? "word" : "words"} to
          the {params.list === "flag" ? "flag-for-review" : "auto-reject"} list. It now
          holds {params.list === "flag" ? flag.length : reject.length}.
        </p>
      )}
      {params.removed && (
        <p className="notice" role="status">
          Removed <strong>{params.removed}</strong>{" "}
          {params.removed === "1" ? "word" : "words"}.
          {params.asked && Number(params.asked) > Number(params.removed) && (
            <>
              {" "}
              {Number(params.asked) - Number(params.removed)} of the{" "}
              {params.asked} you typed weren&rsquo;t in the filter — check the spelling.
            </>
          )}
        </p>
      )}
      {params.error === "nowords" && (
        <p className="form-error" role="alert">
          Nothing to do — the box was empty.
        </p>
      )}
      {params.saved === "empty" ? (
        <p className="notice" role="status">
          Nothing saved — both boxes were empty. Emptying the filter entirely turns off
          every word rule, so tick <strong>&ldquo;Yes, empty the filter&rdquo;</strong> below
          and save again if that is really what you want.
        </p>
      ) : params.saved ? (
        <p className="notice" role="status">
          Saved. The filter now holds <strong>{params.saved}</strong>{" "}
          {params.saved === "1" ? "word" : "words"}.
        </p>
      ) : null}

      {failed && (
        <p className="notice" role="status">
          The word list couldn&rsquo;t load, so editing is turned off — a save right now
          would write over rules this page can&rsquo;t see. The exact error is in the
          server logs.
        </p>
      )}

      {/* ---------------- the counts ---------------- */}
      <dl className="account-facts">
        <div>
          <dt>Auto-reject</dt>
          <dd>
            {reject.length} {reject.length === 1 ? "word" : "words"}
          </dd>
        </div>
        <div>
          <dt>Flag for review</dt>
          <dd>
            {flag.length} {flag.length === 1 ? "word" : "words"}
          </dd>
        </div>
        <div>
          <dt>Room left</dt>
          <dd>
            {MAX_WORDS_PER_LIST - reject.length} / {MAX_WORDS_PER_LIST - flag.length}
          </dd>
        </div>
      </dl>

      {!revealed && !failed && (
        <>
          <p className="notice" role="status">
            <strong>The words themselves aren&rsquo;t shown.</strong> They live in the
            database, and this page deliberately doesn&rsquo;t put a few hundred obscene
            words on your screen — a workplace web filter watching this browser would take
            a dim view of it. Add and remove below by typing what changes; you never need
            to see the rest of the list to do it.
          </p>

          <h2 className="section-h">Add words</h2>
          <form action={adminAddWords} className="review-form">
            <div className="field">
              <label htmlFor="add-words">Words to add (commas between them)</label>
              <textarea id="add-words" name="words" rows={3} required />
            </div>
            <div className="inline-fields">
              <select name="list" aria-label="Which list" className="admin-select" defaultValue="reject">
                <option value="reject">Auto-reject — bounce the ad outright</option>
                <option value="flag">Flag for review — sort it to the top of the queue</option>
              </select>
              <button className="btn btn-sm" type="submit">
                Add them
              </button>
            </div>
            <p className="fine">
              Adding a word that is already there just moves it to the list you picked.
              Nothing is removed, so this can never shorten the filter by accident.
            </p>
          </form>

          <h2 className="section-h">Remove words</h2>
          <form action={adminRemoveWords} className="review-form">
            <div className="field">
              <label htmlFor="remove-words">Words to remove (commas between them)</label>
              <textarea id="remove-words" name="words" rows={2} required />
            </div>
            <button className="btn btn-sm btn-secondary" type="submit">
              Remove them
            </button>
            <p className="fine">
              Only what you type goes. Anything you spell wrong is reported back as a
              count, so a typo is never mistaken for a removal.
            </p>
          </form>

          <h2 className="section-h">Editing the whole list</h2>
          <p className="fine">
            <Link href="/admin/words?show=1">Show the full list and edit it</Link> — this
            puts every filtered word on screen. Fine at home; think twice on a work
            machine. Nothing here remembers that you clicked it, so the page always opens
            hidden again.
          </p>
        </>
      )}

      {/* ---------------- the full editor, only when asked for ---------------- */}
      {revealed && !failed && (
        <>
          <p className="admin-nav">
            {/* A PLAIN anchor, not <Link>, on purpose: a client-side navigation
             * leaves the revealed page's RSC payload sitting in the document
             * and in the router cache, so the words would still be in the
             * browser after you asked to hide them. A hard navigation throws
             * the document away and builds a clean one. */}
            <a href="/admin/words">← Hide the words again</a>
          </p>
          <p className="fine">
            Type words separated by commas. Whatever is in these boxes when you press Save
            <strong> is</strong> the filter — a word you delete here stops being filtered.
            Matching is whole-word and ignores capitals, so <em>gun</em> catches
            &ldquo;Gun&rdquo; but not &ldquo;shotgun.&rdquo; Short phrases work too
            (<em>free money</em>). Up to {MAX_WORDS_PER_LIST} words per list.
          </p>

          <form action={adminSaveWordFilter} className="review-form">
            <div className="field">
              <label htmlFor="reject">Auto-reject words</label>
              <textarea
                id="reject"
                name="reject"
                rows={8}
                defaultValue={formatWordList(reject)}
                placeholder="gun, firearm, rifle"
              />
              <p className="fine">
                An ad containing any of these is bounced the instant it arrives —{" "}
                <strong>nothing charged, no strike against the seller</strong>, and the ad
                is kept for the audit trail. Use it for the things you will never run.
              </p>
            </div>

            <div className="field">
              <label htmlFor="flag">Flag-for-review words</label>
              <textarea
                id="flag"
                name="flag"
                rows={8}
                defaultValue={formatWordList(flag)}
                placeholder="whiskey, tobacco"
              />
              <p className="fine">
                These don&rsquo;t block anything. An ad containing one sorts to the top of
                the <Link href="/admin/review">Review</Link> queue so you see it first and
                decide yourself. Use it for the things that usually need a second look.
              </p>
            </div>

            <p className="fine">
              A word in both boxes is treated as auto-reject — the stricter rule wins.
            </p>

            <label className="sim-photo-toggle">
              <input type="checkbox" name="confirmEmpty" value="yes" /> Yes, empty the
              filter (only needed when you are clearing both boxes)
            </label>

            <button className="btn" type="submit">
              Save word filter
            </button>
          </form>
        </>
      )}
    </>
  );
}
