/**
 * The front door for editable copy (session 021).
 *
 *     const book = await messageBook();
 *     book.render("ad.approved", { adId: 1042, batchWait: "within the hour" });
 *
 * `messageBook()` reads the operator's overrides once and hands back a
 * renderer; every send site asks it for copy by key instead of holding a
 * string literal. A key with no override renders the default from
 * lib/message-templates.ts, so nothing depends on the table existing.
 *
 * WHY IT IS CACHED, AND WHAT THAT COSTS. One inbound text renders three or
 * four templates (a confirmation plus its clauses) and a batch renders one per
 * ad, so reading the table per message would put a round trip in front of every
 * sentence. The cache is per process and lives for CACHE_MS, which on
 * serverless means: after you save an edit, instances that are already warm
 * keep the old wording for up to that long. Half a minute is short enough that
 * an operator pressing Save and then texting themselves sees the new text on
 * the second try, and long enough that a busy minute is one read rather than
 * two hundred. `forgetMessageBook()` clears it in-process — the admin action
 * calls it, which is why the operator's OWN next page load is always current.
 */
import {
  TEMPLATES,
  renderTemplate,
  templateSpec,
  type TemplateSpec,
} from "@/lib/message-templates";
import { getTemplateOverrides } from "@/lib/message-template-store";

const CACHE_MS = 30_000;

let cache: { at: number; bodies: Map<string, string> } | null = null;

export interface MessageBook {
  /** The wording in force for a key — the override, else the default. */
  body(key: string): string;
  /** That wording with its variables filled in and tidied. */
  render(key: string, values?: Record<string, unknown>): string;
  /** True when the operator has rewritten this one. */
  isEdited(key: string): boolean;
}

function bookFrom(bodies: Map<string, string>): MessageBook {
  const bodyFor = (key: string): string => {
    const override = bodies.get(key);
    if (typeof override === "string" && override.trim()) return override;
    return templateSpec(key)?.body ?? "";
  };
  return {
    body: bodyFor,
    render: (key, values = {}) => renderTemplate(bodyFor(key), values),
    isEdited: (key) => {
      const override = bodies.get(key);
      return typeof override === "string" && override.trim().length > 0;
    },
  };
}

/**
 * The renderer, from cache when it is fresh. Never throws: the store already
 * swallows its own failures, and a book of defaults is a working service.
 */
export async function messageBook(): Promise<MessageBook> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return bookFrom(cache.bodies);
  const bodies = new Map<string, string>();
  try {
    for (const [key, row] of await getTemplateOverrides()) bodies.set(key, row.body);
  } catch (e) {
    console.error("[messages] loading overrides failed; using defaults:", e);
  }
  cache = { at: now, bodies };
  return bookFrom(bodies);
}

/** Drop the cache — called after a save so the operator's next look is live. */
export function forgetMessageBook(): void {
  cache = null;
}

/**
 * The book with no overrides at all. For call sites that need copy in a context
 * where a database read is not appropriate (a pure unit test, a fallback path
 * after the store has already failed).
 */
export function defaultMessageBook(): MessageBook {
  return bookFrom(new Map());
}

/** The catalogue, for the admin page. */
export function allTemplates(): TemplateSpec[] {
  return TEMPLATES;
}
