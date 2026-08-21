import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";
import { ReplyEditor } from "@/components/ReplyEditor";
import { adminResetReply, adminSaveReply } from "@/lib/admin-actions";
import {
  SMS_MAX_CHARS,
  exampleValues,
  renderTemplate,
  templateGroups,
  templateSpec,
} from "@/lib/message-templates";
import { getTemplateOverrides, templateStorageReady } from "@/lib/message-template-store";
import { segmentation } from "@/lib/sms-segments";

export const metadata: Metadata = {
  title: `Auto replies — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * THE AUTO-REPLY TAB (session 023, user request: "I want an admin tab where I
 * can go in and edit the messages and add or remove variables from auto
 * replies, rather than having a code/prompt session. Plus, I can see the
 * messages").
 *
 * Two views on one route. The list is the "see the messages" half — every
 * automatic message the service sends, in the words it will actually use,
 * grouped by when it happens. `?key=` is the editor for one of them.
 *
 * What it deliberately does NOT offer:
 *
 *  - The HELP reply and the opt-in confirmation. Those are answered by the
 *    CARRIER, from the Telnyx messaging profile, and nothing in this codebase
 *    can read or change them. The page says so rather than leaving an operator
 *    to wonder why HELP isn't in the list.
 *  - The batch itself (the ad list and its footer). That text is assembled per
 *    subscriber from their categories and packed to fit a segment budget; it is
 *    a layout, not a sentence, and a free-text box over it would be a way to
 *    break every send at once.
 */
export default async function AdminReplies({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; saved?: string; reset?: string; error?: string }>;
}) {
  const params = await searchParams;
  const overrides = await getTemplateOverrides();
  const ready = await templateStorageReady();

  const bodyFor = (key: string): string => {
    const override = overrides.get(key);
    if (override?.body?.trim()) return override.body;
    return templateSpec(key)?.body ?? "";
  };

  /* ---------------- the editor for one message ---------------- */
  const spec = params.key ? templateSpec(params.key) : undefined;
  if (spec) {
    const current = bodyFor(spec.key);
    const edited = Boolean(overrides.get(spec.key)?.body?.trim());
    return (
      <>
        <p className="admin-nav">
          <Link href="/admin/replies">← All messages</Link>
        </p>
        <h1>{spec.label}</h1>
        <p className="fine">{spec.when}</p>

        {params.saved && (
          <p className="notice" role="status">
            Saved. New texts use this wording straight away.
          </p>
        )}
        {params.reset && (
          <p className="notice" role="status">
            Put back to the original wording.
          </p>
        )}
        {params.error && (
          <p className="form-error" role="alert">
            Not saved — {params.error}
          </p>
        )}
        {!ready && (
          <p className="notice" role="status">
            <strong>Editing is not switched on yet.</strong> Paste migration{" "}
            <code>9949_message_templates.sql</code> into the Supabase SQL editor and this will
            start saving. Until then every message uses the wording below and a save will fail.
          </p>
        )}

        {spec.requires?.length ? (
          <div className="notice" role="status">
            <strong>This message has to keep some words.</strong>
            <ul>
              {spec.requires.map((r) => (
                <li key={r.text}>
                  <code>{r.text}</code> — {r.why}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form action={adminSaveReply} className="review-form">
          {/* The `key` carries the stored wording, and it is load-bearing.
              Saving or resetting navigates to the SAME route with a different
              query, so React would otherwise keep the editor mounted and the
              textarea would go on showing what the operator had typed — press
              "go back to the original wording", read "put back to the original
              wording", and still be looking at your own edit, one Save away
              from writing it back. Changing the key remounts the editor with
              what the server actually holds. Typing never changes it (that is
              local state), so this does not interrupt an edit in progress. */}
          <ReplyEditor
            key={`${spec.key}|${current}`}
            templateKey={spec.key}
            initialBody={current}
            defaultBody={spec.body}
            vars={spec.vars}
            channel={spec.channel}
            maxChars={spec.maxChars ?? (spec.channel === "sms" ? SMS_MAX_CHARS : 4000)}
          />
        </form>

        {edited && (
          <>
            <h2 className="section-h">The original</h2>
            <blockquote className="reply-preview">
              {renderTemplate(spec.body, exampleValues(spec))}
            </blockquote>
            <form action={adminResetReply}>
              <input type="hidden" name="key" value={spec.key} />
              <button className="btn btn-sm btn-secondary" type="submit">
                Go back to the original wording
              </button>
            </form>
          </>
        )}
      </>
    );
  }

  /* ---------------- the list ---------------- */
  const groups = templateGroups();
  const editedCount = [...overrides.keys()].filter((k) => templateSpec(k)).length;

  return (
    <>
      <h1>
        Auto replies <Tip k="replies.editing" />
      </h1>
      <p className="fine">
        Every message the service sends on its own, in the words it will use. Click one to
        change the wording or move its variables around — no code change, and it takes effect on
        the next text.{" "}
        <Link href="/admin/messages">The message log</Link> is where you see what actually went
        out.
      </p>

      {params.error === "unknown" && (
        <p className="form-error" role="alert">
          That message isn&rsquo;t one this page knows about.
        </p>
      )}
      {!ready && (
        <p className="notice" role="status">
          <strong>Editing is not switched on yet.</strong> Paste migration{" "}
          <code>9949_message_templates.sql</code> into the Supabase SQL editor. Until then this
          page shows the wording in use but can&rsquo;t save a change.
        </p>
      )}

      <dl className="account-facts">
        <div>
          <dt>Messages</dt>
          <dd>{groups.reduce((n, g) => n + g.templates.length, 0)}</dd>
        </div>
        <div>
          <dt>You&rsquo;ve reworded</dt>
          <dd>{editedCount}</dd>
        </div>
      </dl>

      {groups.map((group) => (
        <section key={group.group}>
          <h2 className="section-h">{group.group}</h2>
          {group.templates.map((t) => {
            const body = bodyFor(t.key);
            const preview = renderTemplate(body, exampleValues(t));
            const cost = segmentation(preview);
            const edited = Boolean(overrides.get(t.key)?.body?.trim());
            return (
              <div key={t.key} className="reply-card">
                <p className="reply-card-head">
                  <Link href={`/admin/replies?key=${encodeURIComponent(t.key)}`}>{t.label}</Link>
                  {edited && <span className="pill"> reworded</span>}
                  {t.fragment && <span className="pill"> part of another message</span>}
                </p>
                <p className="fine">{t.when}</p>
                <blockquote className="reply-preview">{preview}</blockquote>
                {t.channel === "sms" && (
                  <p className="fine">
                    {cost.segments} text{cost.segments === 1 ? "" : "s"} each
                    {cost.encoding === "ucs2" && " · costly characters — worth a look"}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <h2 className="section-h">Not on this page</h2>
      <p className="fine">
        <strong>HELP, and the confirmation somebody gets when they first join.</strong> Those two
        are answered by the phone carrier, from the messaging profile at Telnyx — nothing here
        can read or change them, and carriers require them to exist. If the profile is ever
        rebuilt, check them there.
      </p>
      <p className="fine">
        <strong>The batch of ads itself.</strong> That text is built for each subscriber from
        their categories and packed to fit, so it is a layout rather than a sentence. The ad
        prices, the sending hours and how often a batch goes are all on{" "}
        <Link href="/admin/settings">Settings</Link>, and{" "}
        <Link href="/admin/digests">Digests</Link> is where you write a one-off note to everyone.
      </p>
    </>
  );
}
