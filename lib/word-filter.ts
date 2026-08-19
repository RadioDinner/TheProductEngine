/**
 * The word filter's list arithmetic (session 016 rework, user decision).
 *
 * The filter used to be a one-word-at-a-time widget buried at the bottom of
 * Settings: type a word, press Add, then hunt down its row to toggle or
 * remove it. Moderating a real list that way is miserable — you cannot see
 * the whole list, cannot paste one in, and cannot move six words from flag to
 * reject without twelve clicks.
 *
 * It is now its own admin tab with two boxes of comma-separated words: one
 * auto-reject list, one auto-flag list. Editing means editing text, and Save
 * makes the stored rules match exactly what is in the boxes.
 *
 * Everything here is pure so the unit suite can pin it — the risky part of a
 * "the boxes ARE the state" editor is that a bad parse silently deletes
 * somebody's moderation list.
 */
import type { WordRule } from "@/lib/settings";

/** Longest single entry. Entries are words or short phrases ("free money"),
 * never sentences — the matcher wraps each one in \b…\b. */
export const MAX_WORD_LENGTH = 40;
/** Ceiling on each list. The matcher runs one regex per rule against every ad
 * body, so an unbounded paste is a real cost, not just clutter. */
export const MAX_WORDS_PER_LIST = 500;

/**
 * Read one comma-separated box into clean, deduped, sorted entries.
 *
 * Newlines and semicolons split too: the box has to survive a paste from a
 * spreadsheet column or from the old one-per-line list without the admin
 * having to reformat it by hand.
 *
 * Each entry is lowercased (the matcher is case-insensitive anyway, so
 * storing "Gun" and "gun" as two rules would just be two regexes doing one
 * job) and has its inner whitespace collapsed. Characters that would be
 * meaningless or dangerous inside a \b…\b match are dropped rather than
 * escaped-and-kept, so what the admin sees after a save is exactly what will
 * be matched.
 */
export function parseWordList(raw: string): string[] {
  const seen = new Set<string>();
  const normalized = String(raw ?? "")
    .toLowerCase()
    // Anything that isn't a letter, digit, space, hyphen or apostrophe becomes
    // a SEPARATOR rather than a space. That distinction is the whole trick:
    // "free money" stays one phrase (a space is not punctuation) while
    // "gun/rifle" becomes two entries instead of the phrase "gun rifle",
    // which would have matched neither word on its own.
    .replace(/[^a-z0-9\s'-]/g, ",");
  for (const piece of normalized.split(/[,\n\r]+/)) {
    const clean = piece
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_WORD_LENGTH)
      .trim();
    // A leading/trailing hyphen or apostrophe can't sit next to a \b, so an
    // entry made only of those would match nothing — drop it instead of
    // storing a rule that silently never fires.
    if (!/[a-z0-9]/.test(clean)) continue;
    seen.add(clean);
    if (seen.size >= MAX_WORDS_PER_LIST) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Render a stored list back into the box. Comma-space, because that is what
 * the admin typed and what reads as a list. */
export function formatWordList(words: string[]): string {
  return words.join(", ");
}

/**
 * The two boxes → the exact rule set they describe.
 *
 * A word typed into BOTH boxes resolves to auto-reject: the two modes are a
 * severity ladder, and when the admin has said a word is unacceptable, the
 * milder instruction is the one to drop.
 */
export function buildWordRules(rejectRaw: string, flagRaw: string): WordRule[] {
  const reject = parseWordList(rejectRaw);
  const rejectSet = new Set(reject);
  const flag = parseWordList(flagRaw).filter((w) => !rejectSet.has(w));
  return [
    ...reject.map((word) => ({ word, autoReject: true })),
    ...flag.map((word) => ({ word, autoReject: false })),
  ].sort((a, b) => a.word.localeCompare(b.word));
}

/** Split a stored rule set back into the two boxes. */
export function splitWordRules(rules: WordRule[]): { reject: string[]; flag: string[] } {
  return {
    reject: rules.filter((r) => r.autoReject).map((r) => r.word).sort((a, b) => a.localeCompare(b)),
    flag: rules.filter((r) => !r.autoReject).map((r) => r.word).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * What has to change to turn `current` into `desired`.
 *
 * The store applies a diff rather than delete-all-then-insert-all: a save
 * that dies halfway through a wipe would leave the filter EMPTY, which is the
 * one failure mode of a moderation list that actually costs something (every
 * banned word suddenly allowed). A diff's worst case is a partially applied
 * edit, which is recoverable by pressing Save again.
 */
export function diffWordRules(
  current: WordRule[],
  desired: WordRule[],
): { upserts: WordRule[]; removes: string[] } {
  const now = new Map(current.map((r) => [r.word, r.autoReject]));
  const want = new Map(desired.map((r) => [r.word, r.autoReject]));
  const upserts: WordRule[] = [];
  for (const [word, autoReject] of want) {
    if (now.get(word) !== autoReject) upserts.push({ word, autoReject });
  }
  const removes = [...now.keys()].filter((word) => !want.has(word));
  return { upserts, removes };
}
