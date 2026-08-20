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
  MAX_AD_PHOTOS,
  MAX_TEXTED_PHOTOS,
} from "../lib/categories.ts";
import { parseCommand } from "../lib/commands.ts";

export const name = "categories";

export function run(t) {
  // ---- the WELCOME PACKAGE (session 016, messages 1-2 revised session 018) ----
  // The user wrote these five messages and said "HONOR EVERYTHING I PROMISED
  // IN IT". So: each is pinned verbatim, AND every command it names is fed
  // through the real parser below. A promise in this text that the engine
  // does not answer is a failing test, not a support ticket.
  //
  // Session 018 (batched ads) rewrote what messages 1 and 2 PROMISE, on the
  // user's instruction: ads arrive as a batch rather than one text at a time,
  // one picture per ad goes out with it carrying the ad number, and PIC pulls
  // up to two more. The pins moved with the promise; everything else stands.
  const WELCOME_ARGS = {
    siteName: "The Plain Exchange",
    siteUrl: "ThePlainExchange.com",
    cardPhone: "(330) 960-7170",
    starterCreditLabel: "$40",
    windowLabel: "7am to 9pm Mon - Sat",
    priceLine: "Text ad $20; 1 pic $30, 2 pics $40, 3 pics $50.",
  };
  const welcome = welcomeMessages(WELCOME_ARGS);
  t.eq("five messages", welcome.length, 5);
  t.eq(
    "1 verbatim",
    welcome[0],
    "Welcome to The Plain Exchange!\n\nAds come in batches - several in one text, each with its own ad number - 7am to 9pm Mon - Sat.\n\nText ad $20; 1 pic $30, 2 pics $40, 3 pics $50.\n\nYou have $40 of free ad credit!",
  );
  t.eq(
    "2 verbatim",
    welcome[1],
    "To post, text AD NEW and your ad, like:\n\nAD NEW Hay for sale, $5/bale. Call 330-555-0142\n\nWhen posting an AD you can send up to 8 pictures. The first one goes out with the batch, marked with your ad number.\n\nSee more pictures by replying PIC and the ad number, like PIC 1022 - that sends up to 2 more. The rest are on ThePlainExchange.com!",
  );
  t.eq(
    "3 verbatim",
    welcome[2],
    "To check your balance, reply BAL\n\nTo mark your ad item as sold, reply SOLD followed by your ad number.\n\nTo view your ads, reply MY ADS.",
  );
  t.eq(
    "4 verbatim",
    welcome[3],
    "Every ad is also on ThePlainExchange.com.\n\nAlong with all the remaining pictures and other special features too.\n\nYou can sign up for the ads by email too, free.\n\nTo pay by card, call (330) 960-7170 and enter it on your phone keypad",
  );
  t.eq(
    "5 verbatim",
    welcome[4],
    "Last thing, pick what you want ads for. Reply with a number (or the word):\n" +
      "1 - ALL, every ad\n" +
      "2 - buggies & bikes (BUGGIES)\n" +
      "3 - dogs & puppies (DOGS)\n" +
      "4 - lawn & garden (GARDEN)\n" +
      "5 - horses & tack (HORSES)\n" +
      "6 - household, furniture, realty (HOUSEHOLD)\n" +
      "7 - hunting, fishing, camping (HUNTING)\n" +
      "8 - goats, ponies, small animals (LIVESTOCK)\n" +
      "9 - machinery & equipment (MACHINERY)\n" +
      "10 - wanted & everything else (WANTED)\n" +
      "Text HELP for help. Text STOP to end.",
  );

  // ---- every command the package names must ANSWER ----
  t.eq("BAL is honoured", parseCommand("BAL").kind, "credits");
  t.eq("BALANCE too", parseCommand("balance").kind, "credits");
  // CREDITS retired with the credit system it was named for.
  t.eq("CREDITS is gone", parseCommand("CREDITS").kind, "unknown");
  t.eq("MY ADS with junk after -> unknown", parseCommand("MY ADS please").kind, "unknown");
  t.eq("MYADS one word still works", parseCommand("MYADS").kind, "myads");
  t.eq("SOLD + number", parseCommand("SOLD 1022"), { kind: "sold", id: 1022 });
  t.eq("MY ADS", parseCommand("MY ADS").kind, "myads");
  t.eq("PIC + number", parseCommand("PIC 1022"), { kind: "pic", id: 1022 });
  t.eq("AD NEW", parseCommand("AD NEW Hay for sale, $5/bale.").kind, "ad");
  t.eq("HELP", parseCommand("HELP").kind, "help");
  t.eq("STOP", parseCommand("STOP").kind, "stop");
  // The picture promise is the code's real capacity, not a number in prose.
  t.eq("the package's picture numbers are the code's", [MAX_AD_PHOTOS, MAX_TEXTED_PHOTOS], [8, 3]);
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
