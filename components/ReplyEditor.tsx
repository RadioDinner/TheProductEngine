"use client";

import { useMemo, useRef, useState } from "react";
import type { TemplateVar } from "@/lib/message-templates";
import { renderTemplate } from "@/lib/message-templates";
import { segmentation } from "@/lib/sms-segments";

/**
 * The message editor on /admin/replies (session 023, user request: "edit the
 * messages and add or remove variables from auto replies").
 *
 * It is a client component for three reasons, all of them about the operator
 * being able to see what they are doing:
 *
 *  1. **Variables are inserted at the cursor.** "Add a variable" has to mean
 *     clicking the one you want where you want it, not remembering to type
 *     {supportPhone} with the right spelling — a misspelt token renders as
 *     nothing, which is exactly the failure the server refuses to save.
 *  2. **The preview updates as you type**, with a realistic value in every
 *     variable, so the sentence you are reading is the sentence a member gets.
 *  3. **The cost updates as you type.** These are text messages: 160 GSM
 *     characters is one segment and 161 is two, to every recipient. Finding
 *     that out after saving is finding out too late.
 *
 * The save itself is an ordinary form post to a server action — the button is
 * a plain submit, so the page works with JavaScript off, just without the
 * three conveniences above.
 */
export function ReplyEditor({
  templateKey,
  initialBody,
  defaultBody,
  vars,
  channel,
  maxChars,
}: {
  templateKey: string;
  initialBody: string;
  defaultBody: string;
  vars: TemplateVar[];
  channel: string;
  maxChars: number;
}) {
  const [body, setBody] = useState(initialBody);
  const area = useRef<HTMLTextAreaElement>(null);

  const examples = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of vars) out[v.name] = v.example;
    return out;
  }, [vars]);

  const preview = useMemo(() => renderTemplate(body, examples), [body, examples]);
  const cost = useMemo(() => segmentation(preview), [preview]);

  // Tokens the operator has typed that this message doesn't have. Shown as a
  // warning here and refused outright on save — better to see it while the
  // cursor is still in the box.
  const unknown = useMemo(() => {
    const known = vars.map((v) => v.name);
    const found = new Set<string>();
    for (const m of body.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
      if (!known.includes(m[1])) found.add(m[1]);
    }
    return [...found];
  }, [body, vars]);

  const used = useMemo(() => {
    const found = new Set<string>();
    for (const m of body.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) found.add(m[1]);
    return found;
  }, [body]);

  function insert(name: string) {
    const el = area.current;
    const token = `{${name}}`;
    if (!el) {
      setBody((b) => `${b}${token}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    // Put the cursor after what was just inserted, so a second click lands
    // where the operator expects rather than back at the top.
    requestAnimationFrame(() => {
      el.focus();
      const at = start + token.length;
      el.setSelectionRange(at, at);
    });
  }

  return (
    <>
      <input type="hidden" name="key" value={templateKey} />
      <div className="field">
        <label htmlFor="reply-body">The message</label>
        <textarea
          id="reply-body"
          name="body"
          ref={area}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="fine">
          {body.length} of {maxChars} characters
          {channel === "sms" && (
            <>
              {" · "}
              <strong>
                {cost.segments} text{cost.segments === 1 ? "" : "s"}
              </strong>{" "}
              to every person who gets it
              {cost.encoding === "ucs2" && (
                <>
                  {" "}
                  — <strong>and it has a character that doubles the cost.</strong> Straight
                  quotes and plain dashes keep it cheap.
                </>
              )}
            </>
          )}
        </p>
      </div>

      {unknown.length > 0 && (
        <p className="form-error" role="alert">
          {unknown.map((u) => `{${u}}`).join(", ")}{" "}
          {unknown.length === 1 ? "isn't a variable" : "aren't variables"} this message has, so
          {unknown.length === 1 ? " it" : " they"} would come out blank. Pick one from the list
          below, or delete it — saving will refuse it either way.
        </p>
      )}

      <h2 className="section-h">Variables you can use</h2>
      {vars.length === 0 ? (
        <p className="fine">This message has no variables — it is the same words every time.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Insert</th>
              <th>What it holds</th>
              <th>Example</th>
              <th>In use</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.name}>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => insert(v.name)}
                  >
                    {`{${v.name}}`}
                  </button>
                </td>
                <td>{v.describes}</td>
                <td className="fine">{v.example}</td>
                <td>{used.has(v.name) ? "yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="fine">
        Leave a variable out and it simply doesn&rsquo;t appear — the sentence closes up around
        it, with no stray gap or double space.
      </p>

      <h2 className="section-h">What it will look like</h2>
      <blockquote className="reply-preview">{preview || "(nothing)"}</blockquote>

      <div className="inline-fields">
        <button className="btn" type="submit">
          Save this message
        </button>
        {body !== defaultBody && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setBody(defaultBody)}
          >
            Put the original wording back in the box
          </button>
        )}
      </div>
    </>
  );
}
