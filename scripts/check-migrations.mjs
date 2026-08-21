/**
 * Migration number collision check — `npm run check:migrations`.
 *
 * WHY THIS EXISTS (session 021). Migration numbers in this repo are a single
 * shared counter, descending from 9999 (see new_session_instructions.md §4).
 * Two Claude sessions working in parallel will each read the folder, see the
 * same lowest number, and both claim `lowest - 1`. That is not a merge
 * conflict — git happily merges two files with different names — so nothing
 * fails, and the repo ends up with two DIFFERENT migrations wearing the same
 * number.
 *
 * That matters more here than in most repos because migrations are pasted into
 * the Supabase SQL editor BY HAND. A human reading "9950 is applied" in
 * HANDOFF has no way to know there were two of them, and the second one
 * silently never runs. The feature it belongs to then degrades quietly, which
 * is exactly the class of failure that takes a week to notice.
 *
 * So this checks three things:
 *   1. Two local files sharing a number.
 *   2. A local file whose number is ALREADY TAKEN on origin/main by a
 *      different filename — the parallel-session case, and the whole point.
 *   3. Sanity: a filename that does not match the NNNN_slug.sql convention.
 *
 * It also prints the next free number, taken from local AND remote together,
 * so a session claiming one does not have to work it out by eye.
 *
 * Offline is NOT a failure. If the fetch cannot reach the remote it says so
 * loudly and falls back to a local-only check — a check that refuses to run
 * without a network is a check people start skipping.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
/** The convention's ceiling: 9999_init.sql is the oldest, numbers count down. */
const FIRST = 9999;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Migration filenames on origin/main, or null when the remote is unreachable. */
function remoteFiles() {
  try {
    // Best-effort refresh. A stale origin/main would silently weaken the very
    // check this script exists for, so the fetch is not optional — but its
    // FAILURE is survivable, and that distinction is the whole design.
    execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "ignore", timeout: 20_000 });
  } catch {
    try {
      // Maybe there is an older origin/main to compare against anyway.
      git(["rev-parse", "--verify", "origin/main"]);
      console.warn("⚠  Could not reach the remote — comparing against a possibly STALE origin/main.");
    } catch {
      return null;
    }
  }
  try {
    return git(["ls-tree", "--name-only", "origin/main", `${DIR}/`])
      .split("\n")
      .filter((path) => path.endsWith(".sql"))
      .map((path) => path.slice(DIR.length + 1));
  } catch {
    return null;
  }
}

const local = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
const remote = remoteFiles();
const problems = [];

// --- 3. filenames that break the convention -------------------------------
const malformed = local.filter((f) => !PATTERN.test(f));
for (const f of malformed) {
  problems.push(`${f} — not NNNN_lower_snake.sql, so its number cannot be read`);
}

const parsed = local.filter((f) => PATTERN.test(f)).map((f) => ({ file: f, n: Number(f.match(PATTERN)[1]) }));

// --- 1. two LOCAL files sharing a number ----------------------------------
const byNumber = new Map();
for (const { file, n } of parsed) {
  byNumber.set(n, [...(byNumber.get(n) ?? []), file]);
}
for (const [n, files] of byNumber) {
  if (files.length > 1) problems.push(`${n} is used by ${files.length} local files: ${files.join(", ")}`);
}

// --- 2. a number origin/main already gave to a DIFFERENT file -------------
// The parallel-session case. Note it compares FILENAMES, not just numbers: the
// same file on both sides is simply a migration that is already pushed, which
// is normal and must not be reported.
if (remote) {
  const remoteByNumber = new Map();
  for (const f of remote) {
    const m = f.match(PATTERN);
    if (m) remoteByNumber.set(Number(m[1]), f);
  }
  for (const { file, n } of parsed) {
    const taken = remoteByNumber.get(n);
    if (taken && taken !== file) {
      problems.push(
        `${n} is CLAIMED ON origin/main by ${taken}, but this branch has ${file}.\n` +
          `      Another session took that number. Renumber yours — git will NOT flag this,\n` +
          `      because two files with different names merge cleanly and both end up in the repo.`,
      );
    }
  }
}

// --- the next free number, from both sides together -----------------------
const numbers = [
  ...parsed.map((p) => p.n),
  ...(remote ?? []).map((f) => Number(f.match(PATTERN)?.[1])).filter(Number.isFinite),
];
const lowest = numbers.length ? Math.min(...numbers) : FIRST;
const next = lowest - 1;

console.log(`${DIR}: ${parsed.length} local file(s)${remote ? `, ${remote.length} on origin/main` : ""}`);
console.log(`Lowest (newest) number in use: ${lowest}`);
console.log(`NEXT MIGRATION TAKES: ${next}`);
if (!remote) {
  console.warn("\n⚠  No origin/main available — this was a LOCAL-ONLY check.");
  console.warn("   It cannot see a number another session has already claimed.");
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`   • ${p}`);
  console.error("");
  process.exit(1);
}
console.log("\n✓ No duplicate migration numbers.");
