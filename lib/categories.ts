/**
 * The category system (FEATURES items 22/24/25) — pure logic, import-free so
 * the toggle decision, throttle math, filter partition, and the approved copy
 * are unit-testable in isolation (test/categories.test.mjs).
 *
 * Semantics (user decisions, session 009):
 * - A subscriber's prefs are `string[] | null`: null = ALL (the default and
 *   the grandfather state — no backfill needed), [] = none (allowed but the
 *   member is warned, never silently dark), else lowercase category keys in
 *   canonical sorted order.
 * - An ad's category is `string | null`: null = uncategorized, and an
 *   uncategorized ad rides every ALL/selective digest (pre-migration ads and
 *   skipped dropdowns are never silently unsendable) — but an EMPTY prefs set
 *   gets nothing at all, so the "not getting any ads now" warning stays true.
 * - Texting a category word TOGGLES it; the first specific pick switches the
 *   member from ALL to selective; replying ALL returns to everything.
 */

export interface CategoryDef {
  /** Lowercase storage key — also the SMS command word (uppercased in menus). */
  key: string;
  /** Display name, as used in the approved confirmation copy ("Horses"). */
  label: string;
  /** The approved menu description ("horses & tack"). */
  menu: string;
}

/** The nine categories, alphabetical — the approved menu order (item 22). */
export const CATEGORIES: CategoryDef[] = [
  { key: "buggies", label: "Buggies", menu: "buggies & bikes" },
  { key: "dogs", label: "Dogs", menu: "dogs & puppies" },
  { key: "garden", label: "Garden", menu: "lawn & garden" },
  { key: "horses", label: "Horses", menu: "horses & tack" },
  { key: "household", label: "Household", menu: "household, furniture, realty" },
  { key: "hunting", label: "Hunting", menu: "hunting, fishing, camping" },
  { key: "livestock", label: "Livestock", menu: "goats, ponies, small animals" },
  { key: "machinery", label: "Machinery", menu: "machinery & equipment" },
  { key: "wanted", label: "Wanted", menu: "wanted & everything else" },
];

/** Mirrors lib/photo-collage.ts — kept here as plain numbers so this module
 * stays dependency-free for the unit suite. The suite cross-checks them
 * against the real constants, so the welcome's promise cannot drift. */
export const MAX_AD_PHOTOS = 8;
export const MAX_TEXTED_PHOTOS = 3;

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function isCategoryKey(word: string): boolean {
  return CATEGORY_KEYS.includes(word);
}

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/**
 * The SUBSCRIBE/START welcome menu — the user-approved copy (session 009),
 * verbatim, with the note's "/" separators rendered as line breaks (one menu
 * word per line, like the competitor example it reformats). GSM-7 throughout;
 * the engine still passes it through gsmSanitize like every digest line.
 */
/**
 * The welcome, as a SEQUENCE of texts (user decision, session 016). One
 * message cannot carry everything a new subscriber needs without becoming a
 * wall on a flip-phone screen — and a long SMS is billed per 153-character
 * segment anyway, so splitting costs nothing extra and reads far better.
 * Four short texts, each with one job:
 *
 *   1. what this is, when ads arrive, what they cost, the free credit
 *   2. the commands, with a real example
 *   3. the website (pictures, messaging, email) and the card line
 *   4. the numbered category menu — the one that asks for a reply
 *
 * The menu goes LAST so the question is the final thing on screen. Every
 * number comes from Settings; nothing here hardcodes a price or an hour.
 */
export function welcomeMessages(args: {
  siteName: string;
  siteUrl: string;
  /** The number members call to key in a card — the SMS number, forwarded. */
  cardPhone: string;
  starterCreditLabel: string | null;
  /** "7am to 9pm Mon - Sat", built from Settings by the caller. */
  windowLabel: string;
  priceLine: string;
}): string[] {
  // Blank lines between the facts (the user's own layout): a newline is one
  // septet, so the breathing room costs nothing and a flip-phone screen shows
  // short lines instead of a paragraph to squint at.
  const welcome = [
    `Welcome to ${args.siteName}!`,
    "",
    // What a subscriber actually receives, in the shape they receive it
    // (session 018): a batch of ads in ONE text, each numbered, with the
    // pictures following. Saying this up front is what makes the first batch
    // read as the service working rather than four texts going wrong.
    `Ads come in batches - several in one text, each with its own ad number - ${args.windowLabel}.`,
    "",
    args.priceLine,
    ...(args.starterCreditLabel
      ? ["", `You have ${args.starterCreditLabel} of free ad credit!`]
      : []),
  ].join("\n");

  const posting = [
    "To post, text AD NEW and your ad, like:",
    "",
    "AD NEW Hay for sale, $5/bale. Call 330-555-0142",
    "",
    `When posting an AD you can send up to ${MAX_AD_PHOTOS} pictures. The first one goes out with the batch, marked with your ad number.`,
    "",
    `See more pictures by replying PIC and the ad number, like PIC 1022 - that sends up to ${MAX_TEXTED_PHOTOS - 1} more. The rest are on ${args.siteUrl}!`,
  ].join("\n");

  // Every command named here is honoured by the parser — see the unit suite,
  // which walks this text and asserts each one answers.
  const commands = [
    "To check your balance, reply BAL",
    "",
    "To mark your ad item as sold, reply SOLD followed by your ad number.",
    "",
    "To view your ads, reply MY ADS.",
  ].join("\n");

  const website = [
    `Every ad is also on ${args.siteUrl}.`,
    "",
    "Along with all the remaining pictures and other special features too.",
    "",
    "You can sign up for the ads by email too, free.",
    "",
    `To pay by card, call ${args.cardPhone} and enter it on your phone keypad`,
  ].join("\n");

  const menu = [
    "Last thing, pick what you want ads for. Reply with a number (or the word):",
    ...menuLines(),
    "Text HELP for help. Text STOP to end.",
  ].join("\n");

  return [welcome, posting, commands, website, menu];
}

/** The numbered menu lines: 1 is ALL, then the categories in order. */
export function menuLines(): string[] {
  return [
    "1 - ALL, every ad",
    ...CATEGORIES.map((c, i) => `${i + 2} - ${c.menu} (${c.key.toUpperCase()})`),
  ];
}

/**
 * What a member's reply picks: a category key, "all", or null if it is
 * neither. Numbers are the headline way in (1 = ALL, 2.. = the categories in
 * menu order) and the WORDS keep working — anyone who learned them, or who
 * reads the menu's parenthesis, must not be told they typed nonsense.
 */
export function menuChoice(raw: string): string | "all" | null {
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  if (/^\d+$/.test(word)) {
    const n = Number(word);
    if (n === 1) return "all";
    const category = CATEGORIES[n - 2];
    return category ? category.key : null;
  }
  if (word === "all") return "all";
  return isCategoryKey(word) ? word : null;
}

// ---------- toggle decision ----------

export interface ToggleResult {
  /** The new prefs (null = ALL, [] = none, else sorted keys). */
  next: string[] | null;
  /** True when the toggle turned the category ON for this member. */
  on: boolean;
  /** True when this toggle removed the member's LAST category. */
  emptied: boolean;
}

/** Flip one category in a member's prefs. From ALL (null), the first specific
 * pick switches to selective mode with just that category. */
export function toggleCategory(current: string[] | null, key: string): ToggleResult {
  if (current === null) return { next: [key], on: true, emptied: false };
  if (current.includes(key)) {
    const next = current.filter((k) => k !== key);
    return { next, on: false, emptied: next.length === 0 };
  }
  return { next: [...current, key].sort(), on: true, emptied: false };
}

// ---------- digest filter partition ----------

/** Does an ad belong in this member's digest? null prefs = ALL; an EMPTY
 * prefs array matches NOTHING — the member removed every category and was
 * warned "You're not getting any ads now", and that copy must be true (an
 * uncategorized ad riding an empty set would contradict it); uncategorized
 * ads ride every null/non-empty set (pre-migration ads and skipped dropdowns
 * are never silently unsendable). */
export function adMatchesCategories(
  adCategory: string | null | undefined,
  categories: string[] | null,
): boolean {
  if (categories === null) return true;
  if (categories.length === 0) return false;
  if (!adCategory) return true;
  return categories.includes(adCategory);
}

/** Canonical grouping key for a category set — subscribers with the same
 * effective set share one composed digest. "*" = ALL; "" = none. */
export function partitionKey(categories: string[] | null): string {
  return categories === null ? "*" : [...categories].sort().join(",");
}

// ---------- confirmation throttle (item 24 spam guard) ----------

/** The throttle window: confirmations are counted per rolling-ish hour,
 * anchored at the first confirmation (watermark + counter — never a log scan). */
export const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

export interface ConfirmThrottleState {
  /** Window anchor (ms since epoch); null = no window open. */
  windowStartMs: number | null;
  /** Confirmations counted inside the open window. */
  count: number;
}

export type ConfirmAction = "confirm" | "notice" | "silent";

/**
 * Decide one category/LIST confirmation against the per-number throttle.
 * Confirmations 1..limit send normally; number limit+1 sends the ONE
 * "changes still apply" notice; everything after that is silent until the
 * window expires. limit <= 0 (or nonsense) = unthrottled. The state change
 * always applies — only the outbound SMS is suppressed.
 */
export function decideCategoryConfirm(
  state: ConfirmThrottleState,
  nowMs: number,
  limit: number,
): { action: ConfirmAction; state: ConfirmThrottleState } {
  if (!Number.isFinite(limit) || limit <= 0) return { action: "confirm", state };
  if (state.windowStartMs === null || nowMs - state.windowStartMs >= CONFIRM_WINDOW_MS) {
    return { action: "confirm", state: { windowStartMs: nowMs, count: 1 } };
  }
  const count = state.count + 1;
  const next = { windowStartMs: state.windowStartMs, count };
  if (count <= limit) return { action: "confirm", state: next };
  if (count === limit + 1) return { action: "notice", state: next };
  return { action: "silent", state: next };
}

// ---------- approved SMS copy ----------

/** Toggle confirmations — the user's copy pattern, verbatim (item 24). */
export function categoryToggleSms(key: string, on: boolean): string {
  const label = categoryLabel(key);
  return on
    ? `You will now receive ads in the ${label} category. To stop receiving them, reply ${label}.`
    : `You will no longer receive ${label} ads. To get them again, reply ${label}.`;
}

/** Replying ALL — back to everything (same copy pattern as the toggles). */
export const ALL_CATEGORIES_SMS =
  "You will now receive ads in every category. To pick just some, reply a category name.";

/** The member removed their last category — allowed, but never silent. */
export const EMPTY_CATEGORIES_SMS =
  "You're not getting any ads now - reply ALL or a category name.";

/** The one throttle notice, then silence for the hour (toggles still apply). */
export const THROTTLE_NOTICE_SMS =
  "Changes still apply. Text LIST anytime to see your categories.";

/** LIST — a member's current categories. */
export function listSms(categories: string[] | null): string {
  if (categories === null) {
    return "You get ads in every category (ALL). Reply a category name to pick just some.";
  }
  if (categories.length === 0) return EMPTY_CATEGORIES_SMS;
  return `Your categories: ${categories.map(categoryLabel).join(", ")}. Reply a category name to add or remove it, or ALL for everything.`;
}
