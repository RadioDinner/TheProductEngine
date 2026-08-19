// The word filter's two comma-separated boxes (session 016 rework).
//
// The boxes ARE the stored state, so a parsing mistake here doesn't produce a
// wrong screen — it silently deletes somebody's moderation list, or stores a
// rule that can never fire. Both failure modes are pinned below.
import {
  MAX_WORDS_PER_LIST,
  MAX_WORD_LENGTH,
  buildWordRules,
  diffWordRules,
  formatWordList,
  parseWordList,
  splitWordRules,
} from "../lib/word-filter.ts";

export const name = "word-filter";

const words = (rules) => rules.map((r) => `${r.word}${r.autoReject ? "!" : ""}`).join(" ");

export function run(t) {
  // ---- parseWordList ----
  t.eq("plain comma list", parseWordList("gun, rifle, ammo").join("|"), "ammo|gun|rifle");
  t.eq("empty box is an empty list", parseWordList("").length, 0);
  t.eq("whitespace-only box is an empty list", parseWordList("   \n  ").length, 0);
  t.eq("stray commas are dropped", parseWordList("gun,,rifle, ,").join("|"), "gun|rifle");
  t.eq("case is folded", parseWordList("Gun, GUN, gun").join("|"), "gun");
  t.eq("duplicates collapse", parseWordList("gun, rifle, gun").join("|"), "gun|rifle");
  t.eq("surrounding space trimmed", parseWordList("  gun  ,  rifle  ").join("|"), "gun|rifle");
  // Pasting from a spreadsheet column or from the old one-word-per-line list
  // has to work without the admin reformatting anything.
  t.eq("newlines split too", parseWordList("gun\nrifle\r\nammo").join("|"), "ammo|gun|rifle");
  t.eq("semicolons split too", parseWordList("gun; rifle").join("|"), "gun|rifle");
  t.eq("mixed separators", parseWordList("gun,\nrifle; ammo").join("|"), "ammo|gun|rifle");
  // Phrases are legitimate — the matcher wraps the whole entry in \b…\b.
  t.eq("short phrases survive", parseWordList("free money, get rich").join("|"), "free money|get rich");
  t.eq("inner whitespace collapses", parseWordList("free    money").join("|"), "free money");
  // Punctuation that lives inside real words stays; everything else becomes a
  // separator, so what the admin sees after saving is what actually matches.
  t.eq("hyphens kept", parseWordList("e-cig").join("|"), "e-cig");
  t.eq("apostrophes kept", parseWordList("ain't").join("|"), "ain't");
  t.eq("regex metacharacters are scrubbed", parseWordList("gun.*").join("|"), "gun");
  t.eq("punctuation splits rather than corrupts", parseWordList("gun/rifle").join("|"), "gun|rifle");
  // An entry with no letter or digit could never sit next to a word boundary,
  // so storing it would mean a rule that silently never fires.
  t.eq("punctuation-only entries dropped", parseWordList("---, ''' , !!!").length, 0);
  t.eq("digits are a real entry", parseWordList("2024").join("|"), "2024");
  // Ceilings.
  const long = "a".repeat(MAX_WORD_LENGTH + 20);
  t.eq("over-long entry is truncated", parseWordList(long)[0].length, MAX_WORD_LENGTH);
  const flood = Array.from({ length: MAX_WORDS_PER_LIST + 50 }, (_, i) => `w${i}`).join(",");
  t.eq("list length is capped", parseWordList(flood).length <= MAX_WORDS_PER_LIST, true);
  // Round trip: what the box renders must re-parse to the same list.
  const round = parseWordList("Rifle, gun, free money");
  t.eq("format then re-parse is stable", parseWordList(formatWordList(round)).join("|"), round.join("|"));
  t.eq("formatting is comma-space", formatWordList(["gun", "rifle"]), "gun, rifle");

  // ---- buildWordRules ----
  t.eq("two boxes become one rule set", words(buildWordRules("gun", "whiskey")), "gun! whiskey");
  t.eq("empty boxes make no rules", buildWordRules("", "").length, 0);
  t.eq("reject-only box", words(buildWordRules("gun, rifle", "")), "gun! rifle!");
  t.eq("flag-only box", words(buildWordRules("", "whiskey, tobacco")), "tobacco whiskey");
  // A word in both boxes: the stricter instruction is the one to keep, and it
  // must appear exactly ONCE (two rules for one word means two regexes).
  const both = buildWordRules("gun", "gun, whiskey");
  t.eq("a word in both boxes resolves to auto-reject", words(both), "gun! whiskey");
  t.eq("…and is not duplicated", both.filter((r) => r.word === "gun").length, 1);
  t.eq("rules come out sorted", words(buildWordRules("zebra, apple", "mango")), "apple! mango zebra!");

  // ---- splitWordRules (the reverse: state → boxes) ----
  const rules = [
    { word: "whiskey", autoReject: false },
    { word: "gun", autoReject: true },
    { word: "ammo", autoReject: true },
  ];
  const split = splitWordRules(rules);
  t.eq("reject box", split.reject.join("|"), "ammo|gun");
  t.eq("flag box", split.flag.join("|"), "whiskey");
  t.eq("empty rules give empty boxes", splitWordRules([]).reject.length, 0);
  // Editing must be lossless: state → boxes → state changes nothing.
  const back = buildWordRules(formatWordList(split.reject), formatWordList(split.flag));
  t.eq("state survives a round trip through the boxes", words(back), "ammo! gun! whiskey");

  // ---- diffWordRules ----
  const now = [
    { word: "gun", autoReject: true },
    { word: "whiskey", autoReject: false },
  ];
  const same = diffWordRules(now, [...now]);
  t.eq("no change writes nothing", same.upserts.length + same.removes.length, 0);
  const added = diffWordRules(now, [...now, { word: "ammo", autoReject: true }]);
  t.eq("a new word is one upsert", words(added.upserts), "ammo!");
  t.eq("…and removes nothing", added.removes.length, 0);
  const dropped = diffWordRules(now, [{ word: "gun", autoReject: true }]);
  t.eq("a deleted word is one remove", dropped.removes.join("|"), "whiskey");
  t.eq("…and upserts nothing", dropped.upserts.length, 0);
  // Moving a word between lists must be an UPSERT, never remove-then-add —
  // otherwise the removals and additions could collide when applied.
  const moved = diffWordRules(now, [
    { word: "gun", autoReject: true },
    { word: "whiskey", autoReject: true },
  ]);
  t.eq("promoting flag→reject is an upsert", words(moved.upserts), "whiskey!");
  t.eq("…and never a remove", moved.removes.length, 0);
  const cleared = diffWordRules(now, []);
  t.eq("clearing removes everything", cleared.removes.sort().join("|"), "gun|whiskey");
  const fromEmpty = diffWordRules([], now);
  t.eq("filling an empty filter upserts everything", fromEmpty.upserts.length, 2);
}
