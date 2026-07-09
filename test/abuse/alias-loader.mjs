// Resolve the project's `@/` path alias AND extensionless TS imports so the
// abuse harness can import the REAL engine under `node --experimental-strip-types`.
// ROOT is derived from this file's location (test/abuse/ -> repo root), so it is
// portable across checkouts.
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve as pathResolve, dirname, extname } from "node:path";
import { existsSync } from "node:fs";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTS = [".ts", ".tsx", ".js", ".mjs", ".json"];

function addExt(abs) {
  if (extname(abs) && existsSync(abs)) return abs;
  for (const e of EXTS) if (existsSync(abs + e)) return abs + e;
  for (const e of EXTS) {
    const idx = pathResolve(abs, "index" + e);
    if (existsSync(idx)) return idx;
  }
  return abs;
}

export async function resolve(specifier, context, nextResolve) {
  let abs = null;
  if (specifier.startsWith("@/")) {
    abs = pathResolve(ROOT, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    context.parentURL.startsWith("file:")
  ) {
    abs = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (abs) {
    return nextResolve(pathToFileURL(addExt(abs)).href, context);
  }
  return nextResolve(specifier, context);
}
