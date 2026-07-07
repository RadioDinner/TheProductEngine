/**
 * Environment posture helpers. The security rule: dangerous dev conveniences
 * must be OFF unless explicitly, deliberately enabled — never merely because a
 * provider key happens to be missing.
 */
export const isProduction = process.env.NODE_ENV === "production";

/**
 * Dev tools = on-screen sign-in codes, the /dev/sms and /dev/email simulators,
 * and the simulated-payment button. Enabled automatically in local dev; in a
 * production build they require an explicit ENABLE_DEV_TOOLS=1 opt-in, so a
 * forgotten provider key can never expose them.
 */
export const devToolsEnabled = !isProduction || process.env.ENABLE_DEV_TOOLS === "1";

/** Throw when a required production secret is missing (fail closed, not open). */
export function requireProdSecret(name: string, value: string | undefined): string {
  if (value) return value;
  if (isProduction) {
    throw new Error(`${name} is required in production but is not set.`);
  }
  return "";
}
