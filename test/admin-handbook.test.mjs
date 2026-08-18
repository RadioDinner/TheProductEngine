// The admin handbook (session 015) — content integrity plus wiring: every
// entry is complete and grouped under a known page, and every <Tip k="…" />
// placed in the admin pages resolves to a real entry (tsc guarantees this too;
// the test keeps it true for anyone editing without a typecheck).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDBOOK, HANDBOOK_PAGES, handbookByPage } from "../lib/admin-handbook.ts";

export const name = "admin-handbook";

function tsxFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export function run(t) {
  const keys = Object.keys(HANDBOOK);
  const prefixes = new Set(HANDBOOK_PAGES.map((p) => p.prefix));

  t.eq("has a substantial number of entries", keys.length >= 50, true);

  let malformed = 0;
  let orphaned = 0;
  for (const key of keys) {
    const entry = HANDBOOK[key];
    if (!entry.title.trim() || !entry.what.trim() || !entry.why.trim()) malformed++;
    if (entry.title.length > 60) malformed++;
    const prefix = key.split(".")[0];
    if (!key.includes(".") || !prefixes.has(prefix)) orphaned++;
  }
  t.eq("every entry has title/what/why, titles card-sized", malformed, 0);
  t.eq("every key files under a known page prefix", orphaned, 0);
  t.eq("no duplicate prefixes in HANDBOOK_PAGES", prefixes.size, HANDBOOK_PAGES.length);

  const grouped = handbookByPage();
  const groupedCount = grouped.reduce((n, g) => n + g.entries.length, 0);
  t.eq("the read-through view covers every entry", groupedCount, keys.length);

  // Wiring: collect every k="…" passed to <Tip> across the admin pages and
  // the FIELDS tip: "…" values on the settings page.
  const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const placed = new Set();
  let unknown = 0;
  for (const file of tsxFilesUnder(join(repoRoot, "app", "admin"))) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/<Tip k=\{?"([^"]+)"\}?/g)) {
      placed.add(m[1]);
      if (!(m[1] in HANDBOOK)) unknown++;
    }
    for (const m of source.matchAll(/tip: "([^"]+)"/g)) {
      placed.add(m[1]);
      if (!(m[1] in HANDBOOK)) unknown++;
    }
  }
  t.eq("every placed tip key exists in the handbook", unknown, 0);
  t.eq("tips are actually placed across the admin pages", placed.size >= 40, true);

  // Every page group except the help-page-only "concepts" has at least one
  // tip physically placed on a page.
  const placedPrefixes = new Set([...placed].map((k) => k.split(".")[0]));
  const unplacedPages = HANDBOOK_PAGES.map((p) => p.prefix).filter(
    (prefix) => prefix !== "concepts" && !placedPrefixes.has(prefix),
  );
  t.eq("every admin page carries tips", unplacedPages, []);
}
