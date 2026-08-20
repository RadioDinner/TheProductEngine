/**
 * Runtime-editable settings (spec: every tunable number lives in admin
 * config, never hardcoded). Dual-mode: .data/settings.json in development,
 * the `config` + `word_filter` tables in Supabase. Defaults come from
 * lib/config.ts and apply wherever no override has been saved.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db, supabaseConfigured } from "@/lib/db";
import { engineDefaults } from "@/lib/config";
import { diffWordRules } from "@/lib/word-filter";

export interface EngineSettings {
  /** Text-ad price in CENTS (dollar pricing, session 016 — docs/pricing.md). */
  costTextCents: number;
  /** One-picture price in CENTS (the first entry of photoPricesCents). */
  costPhotoCents: number;
  /** Picture-ad prices in CENTS by picture count: [1 pic, 2 pics, 3 pics]. */
  photoPricesCents: number[];
  /** Broadcasts carry the photo (MMS) instead of "Reply PIC 12". */
  photosInBroadcast: boolean;
  /** Members who may ever receive the starter credit (0 = no cap). */
  starterCreditLimit: number;
  /** Website-listing add-on in CENTS. 0 = included free for every ad. */
  webAddonCents: number;
  /** Starter credit in CENTS, granted once on a member's first real post. */
  starterCreditCents: number;
  digestCap: number;
  /** Digest slots, hours in America/New_York. EMAIL ONLY since session 016 —
   * SMS sends each ad the moment it is approved (see the window below). */
  slots: number[];
  /** SMS send window, hours America/New_York: start inclusive, end EXCLUSIVE. */
  smsWindowStartHour: number;
  smsWindowEndHour: number;
  /** Weekdays that never send SMS (0 = Sunday). */
  smsQuietDays: number[];
  maxChars: number;
  expiryDays: number;
  /** Abuse guards — see engineDefaults for what each cap means. */
  smsRepliesPerHour: number;
  smsPicsPerHour: number;
  smsGlobalPerHour: number;
  /** Digest breaker: billed segments per rolling 24h; 0 pauses digests. */
  digestDailySegmentBudget: number;
  /** Insights: flag numbers requesting more than this many PICs per 24h. */
  picAbusePerDay: number;
  /** PIC photo pulls granted per number per ET day (0 = daily quota off). */
  picDailyAllowance: number;
  /** Max PIC pulls a number can bank across days (rolling/sinking fund cap). */
  picBankCap: number;
  /** "Show number" look-ups per member per ET day (item 23; 0 = metering off). */
  revealsPerDay: number;
  /** Max number look-ups a member can bank across days. */
  revealBankCap: number;
  /** Insights: flag members revealing more than this many numbers per 24h. */
  revealAbusePerDay: number;
  /** Category/LIST confirmations per number per hour before the one throttle
   * notice + silence (item 24; toggles still apply). 0 = unthrottled. */
  categoryConfirmsPerHour: number;
  /** Homepage promo banner text (sales/announcements). Empty = banner hidden. */
  promoBannerText: string;
  /** Where the banner links (site-relative path). */
  promoBannerLink: string;
  /** Emergency stop: no ad goes out (they queue and ride when it clears). */
  adsPaused: boolean;
  /** Emergency stop: member-facing NON-ad messages stop; ads and critical
   * sends (sign-in codes, operator alerts, the outage notice) continue. */
  outboundPaused: boolean;
  /** UNDER ATTACK mode: suppress+tighten+throttle outbound while true. */
  underAttack: boolean;
  /** Global outbound sends/minute ceiling, enforced only while underAttack. */
  outboundThrottlePerMin: number;
  /** Master switch for Twilio line-type lookups. Off = no lookups, no policy. */
  lookupEnabled: boolean;
  /** A throwaway line may receive the free starter credit. */
  voipStarterCredit: boolean;
  /** A throwaway line may use website number look-ups. */
  voipReveals: boolean;
  /** A throwaway line may post ads at all. */
  voipPosting: boolean;
}

export interface WordRule {
  word: string;
  autoReject: boolean;
}

/** EngineSettings key ↔ config-table key (matches supabase/seed.sql). */
const CONFIG_KEYS: Record<keyof EngineSettings, string> = {
  // Dollar pricing (session 016): NEW keys, deliberately not the credit-era
  // credit_cost_text/credit_cost_photo/bump_cost — a stale 2/10 row in prod
  // must never be read as cents. Migration 9973 seeds the new keys.
  costTextCents: "ad_price_text_cents",
  costPhotoCents: "ad_price_photo_cents",
  photoPricesCents: "ad_price_photo_cents_by_count",
  photosInBroadcast: "photos_in_broadcast",
  starterCreditLimit: "starter_credit_limit",
  webAddonCents: "web_addon_cents",
  starterCreditCents: "starter_credit_cents",
  digestCap: "digest_ad_cap",
  slots: "digest_slots_sms",
  smsWindowStartHour: "sms_window_start_hour",
  smsWindowEndHour: "sms_window_end_hour",
  smsQuietDays: "sms_quiet_days",
  maxChars: "ad_max_chars",
  expiryDays: "ad_expiry_days",
  smsRepliesPerHour: "sms_replies_per_hour",
  smsPicsPerHour: "sms_pics_per_hour",
  smsGlobalPerHour: "sms_global_per_hour",
  digestDailySegmentBudget: "digest_daily_segment_budget",
  picAbusePerDay: "pic_abuse_per_day",
  picDailyAllowance: "pic_daily_allowance",
  picBankCap: "pic_bank_cap",
  revealsPerDay: "reveals_per_day",
  revealBankCap: "reveal_bank_cap",
  revealAbusePerDay: "reveal_abuse_per_day",
  categoryConfirmsPerHour: "category_confirms_per_hour",
  promoBannerText: "promo_banner_text",
  promoBannerLink: "promo_banner_link",
  adsPaused: "ads_paused",
  outboundPaused: "outbound_paused",
  underAttack: "under_attack",
  outboundThrottlePerMin: "outbound_throttle_per_min",
  lookupEnabled: "lookup_enabled",
  voipStarterCredit: "voip_starter_credit",
  voipReveals: "voip_reveals",
  voipPosting: "voip_posting",
};

// ---------- file implementation ----------

interface SettingsShape {
  values: Partial<EngineSettings>;
  words: WordRule[] | null; // null = never customized, use defaults
}

const SETTINGS_PATH = join(process.cwd(), ".data", "settings.json");

function load(): SettingsShape {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as SettingsShape;
  } catch {
    return { values: {}, words: null };
  }
}

function save(shape: SettingsShape): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(shape, null, 2), "utf8");
}

function defaultWords(): WordRule[] {
  return engineDefaults.filterWords.map((word) => ({ word, autoReject: false }));
}

// ---------- public interface ----------

export async function getEngineSettings(): Promise<EngineSettings> {
  const defaults: EngineSettings = {
    costTextCents: engineDefaults.costTextCents,
    costPhotoCents: engineDefaults.costPhotoCents,
    photoPricesCents: [...engineDefaults.photoPricesCents],
    photosInBroadcast: engineDefaults.photosInBroadcast,
    starterCreditLimit: engineDefaults.starterCreditLimit,
    webAddonCents: engineDefaults.webAddonCents,
    starterCreditCents: engineDefaults.starterCreditCents,
    digestCap: engineDefaults.digestCap,
    slots: [...engineDefaults.slots],
    smsWindowStartHour: engineDefaults.smsWindowStartHour,
    smsWindowEndHour: engineDefaults.smsWindowEndHour,
    smsQuietDays: [...engineDefaults.smsQuietDays],
    maxChars: engineDefaults.maxChars,
    expiryDays: engineDefaults.expiryDays,
    smsRepliesPerHour: engineDefaults.smsRepliesPerHour,
    smsPicsPerHour: engineDefaults.smsPicsPerHour,
    smsGlobalPerHour: engineDefaults.smsGlobalPerHour,
    digestDailySegmentBudget: engineDefaults.digestDailySegmentBudget,
    picAbusePerDay: engineDefaults.picAbusePerDay,
    picDailyAllowance: engineDefaults.picDailyAllowance,
    picBankCap: engineDefaults.picBankCap,
    revealsPerDay: engineDefaults.revealsPerDay,
    revealBankCap: engineDefaults.revealBankCap,
    revealAbusePerDay: engineDefaults.revealAbusePerDay,
    categoryConfirmsPerHour: engineDefaults.categoryConfirmsPerHour,
    promoBannerText: engineDefaults.promoBannerText,
    promoBannerLink: engineDefaults.promoBannerLink,
    adsPaused: engineDefaults.adsPaused,
    outboundPaused: engineDefaults.outboundPaused,
    underAttack: engineDefaults.underAttack,
    outboundThrottlePerMin: engineDefaults.outboundThrottlePerMin,
    lookupEnabled: engineDefaults.lookupEnabled,
    voipStarterCredit: engineDefaults.voipStarterCredit,
    voipReveals: engineDefaults.voipReveals,
    voipPosting: engineDefaults.voipPosting,
  };
  if (!supabaseConfigured) {
    return { ...defaults, ...load().values };
  }
  const { data, error } = await db()
    .from("config")
    .select("key, value")
    .in("key", Object.values(CONFIG_KEYS));
  if (error) throw error;
  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value]));
  const out = { ...defaults };
  for (const [prop, key] of Object.entries(CONFIG_KEYS) as [keyof EngineSettings, string][]) {
    const value = byKey.get(key);
    if (value !== undefined && value !== null) {
      (out[prop] as unknown) = value;
    }
  }
  return out;
}

export async function saveEngineSettings(update: Partial<EngineSettings>): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.values = { ...shape.values, ...update };
    save(shape);
    return;
  }
  for (const [prop, value] of Object.entries(update) as [keyof EngineSettings, unknown][]) {
    const { error } = await db()
      .from("config")
      .upsert({ key: CONFIG_KEYS[prop], value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
}

export async function getWordRules(): Promise<WordRule[]> {
  if (!supabaseConfigured) {
    return load().words ?? defaultWords();
  }
  const { data, error } = await db()
    .from("word_filter")
    .select("word, auto_reject")
    .order("word");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    word: row.word as string,
    autoReject: row.auto_reject as boolean,
  }));
}

export async function addWordRule(word: string, autoReject: boolean): Promise<void> {
  const clean = word.trim().toLowerCase();
  if (!clean) return;
  if (!supabaseConfigured) {
    const shape = load();
    const words = shape.words ?? defaultWords();
    if (!words.some((w) => w.word === clean)) words.push({ word: clean, autoReject });
    shape.words = words.sort((a, b) => a.word.localeCompare(b.word));
    save(shape);
    return;
  }
  const { error } = await db()
    .from("word_filter")
    .upsert({ word: clean, auto_reject: autoReject }, { onConflict: "word" });
  if (error) throw error;
}

export async function removeWordRule(word: string): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    shape.words = (shape.words ?? defaultWords()).filter((w) => w.word !== word);
    save(shape);
    return;
  }
  const { error } = await db().from("word_filter").delete().eq("word", word);
  if (error) throw error;
}

export async function toggleWordRule(word: string): Promise<void> {
  if (!supabaseConfigured) {
    const shape = load();
    const words = shape.words ?? defaultWords();
    const rule = words.find((w) => w.word === word);
    if (rule) rule.autoReject = !rule.autoReject;
    shape.words = words;
    save(shape);
    return;
  }
  const rules = await getWordRules();
  const rule = rules.find((w) => w.word === word);
  if (!rule) return;
  const { error } = await db()
    .from("word_filter")
    .update({ auto_reject: !rule.autoReject })
    .eq("word", word);
  if (error) throw error;
}

/**
 * Make the stored rules match `desired` exactly — the save behind the word
 * filter tab, where the two text boxes ARE the state.
 *
 * Applied as a DIFF (see lib/word-filter.ts): a wipe-then-reinsert that died
 * halfway would leave the filter empty and every banned word suddenly
 * allowed. Untouched words are never rewritten, so a save is usually one or
 * two statements even on a long list.
 */
export async function replaceWordRules(desired: WordRule[]): Promise<void> {
  const { upserts, removes } = diffWordRules(await getWordRules(), desired);
  if (!supabaseConfigured) {
    const shape = load();
    shape.words = [...desired].sort((a, b) => a.word.localeCompare(b.word));
    save(shape);
    return;
  }
  // Removals first: a word moving between lists is an upsert, never a
  // remove+add, so these two sets can't collide.
  if (removes.length) {
    const { error } = await db().from("word_filter").delete().in("word", removes);
    if (error) throw error;
  }
  if (upserts.length) {
    const { error } = await db()
      .from("word_filter")
      .upsert(
        upserts.map((r) => ({ word: r.word, auto_reject: r.autoReject })),
        { onConflict: "word" },
      );
    if (error) throw error;
  }
}

/**
 * The SMS reply caps the engine should enforce right now. Normally the
 * admin-set values; while UNDER ATTACK, auto-tightened to conservative floors
 * (config attack* defaults) without the admin editing anything — never LOOSER
 * than the configured value.
 */
export function effectiveSmsCaps(settings: EngineSettings): {
  repliesPerHour: number;
  picsPerHour: number;
  globalPerHour: number;
} {
  if (!settings.underAttack) {
    return {
      repliesPerHour: settings.smsRepliesPerHour,
      picsPerHour: settings.smsPicsPerHour,
      globalPerHour: settings.smsGlobalPerHour,
    };
  }
  return {
    repliesPerHour: Math.min(settings.smsRepliesPerHour, engineDefaults.attackRepliesPerHour),
    picsPerHour: Math.min(settings.smsPicsPerHour, engineDefaults.attackPicsPerHour),
    globalPerHour: Math.min(settings.smsGlobalPerHour, engineDefaults.attackGlobalPerHour),
  };
}

/** Match ad text against the word rules. */
export function matchWordRules(
  body: string,
  rules: WordRule[],
): { flagged: boolean; autoReject: boolean } {
  let flagged = false;
  let autoReject = false;
  for (const rule of rules) {
    if (new RegExp(`\\b${rule.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body)) {
      flagged = true;
      if (rule.autoReject) autoReject = true;
    }
  }
  return { flagged, autoReject };
}
