// Category system (FEATURES items 22/24/25): toggle decision, confirmation-
// throttle math, category-word parsing, and the digest filter partition.
import {
  ALL_CATEGORIES_SMS,
  CATEGORY_KEYS,
  CONFIRM_WINDOW_MS,
  EMPTY_CATEGORIES_SMS,
  THROTTLE_NOTICE_SMS,
  adMatchesCategories,
  categoryToggleSms,
  decideCategoryConfirm,
  isCategoryKey,
  listSms,
  partitionKey,
  toggleCategory,
  welcomeMessages,
  menuChoice,
  menuLines,
} from "../lib/categories.ts";
import { parseCommand } from "../lib/commands.ts";

export const name = "categories";

export function run(t) {
  // ---- the welcome SEQUENCE (session 016) ----
  const WELCOME_ARGS = {
    siteName: "The Plain Exchange",
    siteUrl: "ThePlainExchange.com",
    smsNumber: "(330) 960-7170",
    supportPhone: "(234) 301-0048",
    starterCreditLabel: "$40",
    windowLabel: "7am-9pm Mon-Sat",
    priceLine: "Text ad $20; 1 pic $30, 2 pics $40, 3 pics $50.",
  };
  const welcome = welcomeMessages(WELCOME_ARGS);
  t.eq("four messages", welcome.length, 4);
  // Each message has exactly one job, and the sequence must cover everything
  // a new subscriber was promised.
  t.eq("1: names the service", welcome[0].startsWith("Welcome to The Plain Exchange!"), true);
  // The user's own layout: one fact per line, blank lines between. A newline
  // is a single septet, so the breathing room is free.
  t.eq(
    "1: laid out with blank lines",
    welcome[0],
    "Welcome to The Plain Exchange!\n\nAds post from 7am-9pm Mon-Sat.\n\nText ad $20; 1 pic $30, 2 pics $40, 3 pics $50.\n\nYou have $40 of free ad credit!",
  );
  t.eq("1: says when ads arrive", welcome[0].includes("7am-9pm Mon-Sat"), true);
  t.eq("1: states the prices", welcome[0].includes("1 pic $30"), true);
  t.eq("1: states the free credit", welcome[0].includes("$40 of free ad credit!"), true);
  // The user's exact wording, blank lines and all.
  t.eq(
    "2: verbatim",
    welcome[1],
    "To post, text AD NEW and your ad, like:\n\nAD NEW Hay for sale, $5/bale. Call 330-555-0142\n\nYou can reply PIC and the ad number like (PIC 1022) to receive the pictures for the ad",
  );
  // HELP stays the escape hatch for every other command, and it lives in the
  // final message — so the welcome never leaves someone without a way in.
  t.eq("HELP is offered somewhere", welcome.some((m) => m.includes("HELP")), true);
  t.eq("3: names the website", welcome[2].includes("ThePlainExchange.com"), true);
  t.eq("3: promises every picture", /all of its pictures/i.test(welcome[2]), true);
  t.eq("3: mentions messaging sellers", /message sellers/i.test(welcome[2]), true);
  t.eq("3: mentions email", /by email/i.test(welcome[2]), true);
  t.eq("3: gives the card line", welcome[2].includes("(234) 301-0048"), true);
  t.eq("3: says the card is stored securely", /stored securely/i.test(welcome[2]), true);
  // The ASK goes last, so the question is the final thing on the screen.
  t.eq("4: is the menu", welcome[3].includes("1 - ALL, every ad"), true);
  t.eq("4: asks for a reply", /reply with a number/i.test(welcome[3]), true);
  t.eq("4: carries STOP and HELP", welcome[3].includes("STOP") && welcome[3].includes("HELP"), true);
  // Once the launch offer is spent the welcome must stop advertising it.
  t.eq(
    "no offer -> no free-credit line",
    welcomeMessages({ ...WELCOME_ARGS, starterCreditLabel: null }).some((m) =>
      m.includes("free ad credit"),
    ),
    false,
  );

  // ---- numbered picks: the headline way in on a flip phone ----
  t.eq("1 is ALL", menuChoice("1"), "all");
  t.eq("2 is the first category", menuChoice("2"), "buggies");
  t.eq("10 is the last category", menuChoice("10"), "wanted");
  t.eq("0 is nothing", menuChoice("0"), null);
  t.eq("11 is past the end", menuChoice("11"), null);
  // The words never stop working — people who learned them, and the menu's
  // own parentheses, both depend on it.
  t.eq("the word still works", menuChoice("HORSES"), "horses");
  t.eq("all by word", menuChoice("all"), "all");
  t.eq("nonsense is nothing", menuChoice("banana"), null);
  // The numbering must follow the menu it prints, or a reply picks the wrong
  // category — the one bug in here that silently mis-subscribes people.
  const lines = menuLines();
  t.eq("a line per choice", lines.length, CATEGORY_KEYS.length + 1);
  for (let i = 2; i <= CATEGORY_KEYS.length + 1; i += 1) {
    t.eq(`menu line ${i} matches choice ${i}`, lines[i - 1].startsWith(`${i} - `), true);
    t.eq(`choice ${i} is a real category`, CATEGORY_KEYS.includes(menuChoice(String(i))), true);
  }
  // A bare number must reach the toggle through the real parser too.
  t.eq("parser accepts a number", parseCommand("3"), { kind: "category", category: "dogs" });
  t.eq("number with words -> unknown", parseCommand("3 horses").kind, "unknown");

  // ---- parsing (case-insensitive, exact word) ----
  t.eq("HORSES parses", parseCommand("HORSES"), { kind: "category", category: "horses" });
  t.eq("lowercase dogs", parseCommand("dogs"), { kind: "category", category: "dogs" });
  t.eq("trailing period", parseCommand("Horses."), { kind: "category", category: "horses" });
  t.eq("ALL parses", parseCommand("ALL"), { kind: "category", category: "all" });
  t.eq("LIST parses", parseCommand("LIST"), { kind: "list" });
  t.eq("list with junk -> unknown", parseCommand("list my stuff").kind, "unknown");
  t.eq("category word + rest -> unknown", parseCommand("horses for sale").kind, "unknown");
  t.eq("near-miss word -> unknown", parseCommand("horse").kind, "unknown");
  // Drift guard: the parser's local word set must recognize every
  // lib/categories key (the two lists are deliberately not imports).
  t.eq(
    "parser knows every category key",
    CATEGORY_KEYS.map((k) => parseCommand(k.toUpperCase())),
    CATEGORY_KEYS.map((k) => ({ kind: "category", category: k })),
  );
  t.eq("isCategoryKey horses", isCategoryKey("horses"), true);
  t.eq("isCategoryKey all is NOT a key", isCategoryKey("all"), false);

  // ---- toggle decision (item 24 semantics) ----
  t.eq("first pick from ALL -> selective", toggleCategory(null, "horses"), {
    next: ["horses"],
    on: true,
    emptied: false,
  });
  t.eq("add a second (sorted)", toggleCategory(["horses"], "dogs"), {
    next: ["dogs", "horses"],
    on: true,
    emptied: false,
  });
  t.eq("toggle one off", toggleCategory(["dogs", "horses"], "dogs"), {
    next: ["horses"],
    on: false,
    emptied: false,
  });
  t.eq("removing the last empties (warned, allowed)", toggleCategory(["horses"], "horses"), {
    next: [],
    on: false,
    emptied: true,
  });
  t.eq("pick from empty state", toggleCategory([], "garden"), {
    next: ["garden"],
    on: true,
    emptied: false,
  });

  // ---- filter partition (uncategorized rides ALL/selective; empty = dark) ----
  t.eq("ALL member gets categorized ad", adMatchesCategories("horses", null), true);
  t.eq("ALL member gets uncategorized ad", adMatchesCategories(null, null), true);
  t.eq("match", adMatchesCategories("horses", ["garden", "horses"]), true);
  t.eq("no match", adMatchesCategories("dogs", ["garden", "horses"]), false);
  t.eq("uncategorized rides selective", adMatchesCategories(null, ["horses"]), true);
  // The EMPTY set matches NOTHING: the member was told "You're not getting any
  // ads now" and that copy must be literally true (uncategorized included).
  t.eq("EMPTY set matches nothing — uncategorized", adMatchesCategories(null, []), false);
  t.eq("EMPTY set matches nothing — undefined category", adMatchesCategories(undefined, []), false);
  t.eq("categorized skips empty set", adMatchesCategories("horses", []), false);
  t.eq("partition key ALL", partitionKey(null), "*");
  t.eq("partition key none", partitionKey([]), "");
  t.eq("partition key canonical order", partitionKey(["horses", "dogs"]), "dogs,horses");
  t.eq("partition key equal sets group", partitionKey(["dogs", "horses"]), "dogs,horses");

  // ---- throttle math (5 confirmations, one notice, then silence) ----
  const limit = 5;
  let state = { windowStartMs: null, count: 0 };
  const actions = [];
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) {
    const decided = decideCategoryConfirm(state, t0 + i * 1000, limit);
    actions.push(decided.action);
    state = decided.state;
  }
  t.eq("8 rapid: 5 confirm, 1 notice, 2 silent", actions, [
    "confirm",
    "confirm",
    "confirm",
    "confirm",
    "confirm",
    "notice",
    "silent",
    "silent",
  ]);
  t.eq("window count tracked", state.count, 8);
  const afterHour = decideCategoryConfirm(state, t0 + CONFIRM_WINDOW_MS, limit);
  t.eq("window expiry resets to confirm", afterHour.action, "confirm");
  t.eq("expired window restarts count", afterHour.state, {
    windowStartMs: t0 + CONFIRM_WINDOW_MS,
    count: 1,
  });
  t.eq(
    "limit 0 = unthrottled",
    decideCategoryConfirm({ windowStartMs: t0, count: 99 }, t0 + 1, 0).action,
    "confirm",
  );
  t.eq(
    "exactly limit still confirms",
    decideCategoryConfirm({ windowStartMs: t0, count: 4 }, t0 + 1, 5).action,
    "confirm",
  );
  t.eq(
    "limit+1 is the one notice",
    decideCategoryConfirm({ windowStartMs: t0, count: 5 }, t0 + 1, 5).action,
    "notice",
  );

  // ---- the approved confirmation copy (item 24, verbatim) ----
  t.eq(
    "ON copy",
    categoryToggleSms("horses", true),
    "You will now receive ads in the Horses category. To stop receiving them, reply Horses.",
  );
  t.eq(
    "OFF copy",
    categoryToggleSms("horses", false),
    "You will no longer receive Horses ads. To get them again, reply Horses.",
  );
  t.eq(
    "empty warning copy",
    EMPTY_CATEGORIES_SMS,
    "You're not getting any ads now - reply ALL or a category name.",
  );
  t.eq(
    "throttle notice copy",
    THROTTLE_NOTICE_SMS,
    "Changes still apply. Text LIST anytime to see your categories.",
  );
  t.eq("ALL copy mentions every category", ALL_CATEGORIES_SMS.includes("every category"), true);
  t.eq(
    "LIST with picks",
    listSms(["dogs", "horses"]),
    "Your categories: Dogs, Horses. Reply a category name to add or remove it, or ALL for everything.",
  );
  t.eq("LIST on ALL mentions ALL", listSms(null).includes("every category (ALL)"), true);
  t.eq("LIST on empty = the warning", listSms([]), EMPTY_CATEGORIES_SMS);
}
