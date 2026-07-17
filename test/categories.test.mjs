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
  welcomeMenu,
} from "../lib/categories.ts";
import { parseCommand } from "../lib/commands.ts";

export const name = "categories";

export function run(t) {
  // ---- the approved welcome menu (item 22) — verbatim guard ----
  t.eq(
    "welcome menu verbatim",
    welcomeMenu("The Plain Exchange"),
    "Welcome to The Plain Exchange! Pick what you want ads for - text one word per message:\n" +
      "ALL - every ad\n" +
      "BUGGIES - buggies & bikes\n" +
      "DOGS - dogs & puppies\n" +
      "GARDEN - lawn & garden\n" +
      "HORSES - horses & tack\n" +
      "HOUSEHOLD - household, furniture, realty\n" +
      "HUNTING - hunting, fishing, camping\n" +
      "LIVESTOCK - goats, ponies, small animals\n" +
      "MACHINERY - machinery & equipment\n" +
      "WANTED - wanted & everything else\n" +
      "Text HELP for help. Text STOP to end.",
  );

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

  // ---- filter partition (uncategorized rides everything) ----
  t.eq("ALL member gets categorized ad", adMatchesCategories("horses", null), true);
  t.eq("ALL member gets uncategorized ad", adMatchesCategories(null, null), true);
  t.eq("match", adMatchesCategories("horses", ["garden", "horses"]), true);
  t.eq("no match", adMatchesCategories("dogs", ["garden", "horses"]), false);
  t.eq("uncategorized rides selective", adMatchesCategories(null, ["horses"]), true);
  t.eq("uncategorized rides EMPTY set", adMatchesCategories(null, []), true);
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
