/**
 * Side-effect import that hands Next's `after()` to the analytics layer.
 *
 *     import "@/analytics/src/register-after";
 *
 * Import this from any SERVER ACTION file that emits analytics. Route handlers
 * call `setAfterImpl(after)` directly and do not need it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `analytics/src/after.ts` takes its implementation by injection rather than
 * importing `next/server` itself, because `lib/engine.ts` — where the most
 * valuable events live — is loaded by the unit and abuse suites under plain
 * node, where that module does not resolve.
 *
 * The first version of that injection was registered only in the four API
 * route files. Server actions never load those modules, so every event emitted
 * from a `lib/*-actions.ts` file quietly fell back to unawaited
 * fire-and-forget: exactly the behaviour the injection exists to prevent, and
 * on a serverless platform that means an undercount of unknown size that still
 * looks entirely plausible. Twelve events were affected, two of them key
 * events. This module is the fix.
 *
 * ── Which files must NOT import it ─────────────────────────────────────────
 *
 * `lib/engine.ts`, `lib/moderation.ts` and `lib/digest-engine.ts` are loaded by
 * the test harness. Importing `next/server` from any of them breaks the suite.
 * They are covered instead by their CALLERS registering — the admin server
 * actions for moderation, the cron route for the digest engine — because
 * registration is process-wide, not per-module.
 */
import { after } from "next/server";
import { setAfterImpl } from "./after";

setAfterImpl(after);
