import type { Metadata } from "next";
import Link from "next/link";
import {
  adminBlockNumber,
  adminSaveSettings,
  adminSetPause,
  adminSetUnderAttack,
  adminUnblockNumber,
} from "@/lib/admin-actions";
import { getEngineSettings, getWordRules } from "@/lib/settings";
import { listBlocked } from "@/lib/blocklist";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";
import type { HandbookKey } from "@/lib/admin-handbook";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Settings — ${site.name} admin`,
};

/** Money fields are entered in DOLLARS (decimals allowed) and stored in
 * cents — adminSaveSettings converts. */
const DOLLAR_FIELDS = new Set([
  "costTextCents",
  "photoPrice1Cents",
  "photoPrice2Cents",
  "photoPrice3Cents",
  "webAddonCents",
  "starterCreditCents",
]);

const FIELDS: { key: string; label: string; hint?: string; tip: HandbookKey }[] = [
  { key: "costTextCents", label: "Text ad price ($)", tip: "settings.costs" },
  { key: "photoPrice1Cents", label: "Picture ad — 1 picture ($)", tip: "settings.costs" },
  { key: "photoPrice2Cents", label: "Picture ad — 2 pictures ($)", tip: "settings.costs" },
  {
    key: "photoPrice3Cents",
    label: "Picture ad — 3 pictures ($)",
    hint: "three is the most an ad can be charged for; extras beyond that ride the website free",
    tip: "settings.costs",
  },
  {
    key: "webAddonCents",
    label: "Website listing add-on ($)",
    hint: "0 = every ad lists on the website free (the launch state); set 15 to start charging",
    tip: "settings.webAddon",
  },
  {
    key: "starterCreditCents",
    label: "Starter credit ($)",
    hint: "granted once, on a member's first post — never at account creation",
    tip: "settings.starterCredit",
  },
  {
    key: "digestCap",
    label: "Max ads per pass",
    hint: "how many queued ads one send or email edition handles; the rest ride the next one",
    tip: "settings.digestCap",
  },
  { key: "maxChars", label: "Max ad length (characters)", tip: "settings.maxChars" },
  {
    key: "expiryDays",
    label: "Website listing length (days)",
    hint: "how long an ad stays on the website and answers PIC — the text goes out once, when approved",
    tip: "settings.expiryDays",
  },
  {
    key: "smsRepliesPerHour",
    label: "Command replies per number per hour",
    hint: "past this, the engine stops answering that number",
    tip: "settings.replyCaps",
  },
  {
    key: "smsPicsPerHour",
    label: "Pictures (PIC) per number per hour",
    hint: "burst limit — picture texts cost the most to send",
    tip: "settings.replyCaps",
  },
  {
    key: "picDailyAllowance",
    label: "Picture pulls per number per day",
    hint: "PIC photos each number gets a day; unused ones bank (below). 0 turns the daily limit off",
    tip: "settings.picQuota",
  },
  {
    key: "picBankCap",
    label: "Most picture pulls a number can bank",
    hint: "the rolling/sinking fund ceiling — unused daily pulls stack up to this many",
    tip: "settings.picQuota",
  },
  {
    key: "revealsPerDay",
    label: "Number look-ups (Show number) per member per day",
    hint: "website reveals of seller numbers — the anti-scraping meter; re-viewing a revealed ad is free. 0 turns metering off",
    tip: "settings.reveals",
  },
  {
    key: "revealBankCap",
    label: "Most number look-ups a member can bank",
    hint: "unused daily look-ups stack up to this many",
    tip: "settings.reveals",
  },
  {
    key: "revealAbusePerDay",
    label: "Flag excessive number look-ups (per day)",
    hint: "on Insights, flag any member revealing more than this many numbers in 24h (0 turns the flag off)",
    tip: "settings.reveals",
  },
  {
    key: "categoryConfirmsPerHour",
    label: "Category confirmations per number per hour",
    hint: "category toggles/LIST confirmed before one “changes still apply” notice and silence for the hour — toggles still apply (0 = unthrottled)",
    tip: "settings.categoryThrottle",
  },
  {
    key: "smsGlobalPerHour",
    label: "Command replies service-wide per hour",
    hint: "circuit breaker — digests are never counted",
    tip: "settings.globalBreaker",
  },
  {
    key: "digestDailySegmentBudget",
    label: "Daily digest segment budget",
    hint: "billed SMS segments per rolling 24 hours before digest sending pauses (0 pauses digests)",
    tip: "settings.segmentBudget",
  },
  {
    key: "picAbusePerDay",
    label: "Flag excessive picture requests (per day)",
    hint: "on Insights, flag any number asking for more than this many pictures in 24h (0 turns the flag off)",
    tip: "settings.picAbuseFlag",
  },
  {
    key: "outboundThrottlePerMin",
    label: "Under-attack outbound throttle (per minute)",
    hint: "global sends/minute ceiling, enforced ONLY while UNDER ATTACK mode is on (excess defers to the next tick)",
    tip: "settings.throttlePerMin",
  },
];

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const settings = await getEngineSettings();
  const words = await getWordRules();
  const blocked = await listBlocked();
  // The picture ladder is ONE setting (an array) but three form fields — the
  // operator thinks in "what does a 2-picture ad cost", not in array indexes.
  const values: Record<string, number> = {
    ...(settings as unknown as Record<string, number>),
    photoPrice1Cents: settings.photoPricesCents[0] ?? 0,
    photoPrice2Cents: settings.photoPricesCents[1] ?? 0,
    photoPrice3Cents: settings.photoPricesCents[2] ?? 0,
  };

  return (
    <>
      <h1>Settings</h1>
      {params.saved && (
        <p className="notice" role="status">
          Settings saved — the engine uses them immediately.
        </p>
      )}

      <section className="controls-panel">
        <h2 className="section-h">
          System controls <Tip k="settings.pause" />
        </h2>
        <p className="fine">
          Emergency kill switches. They take effect immediately — the engine reads them live.
        </p>
        <p>
          Outbound:{" "}
          <strong>
            {settings.adsPaused && settings.outboundPaused
              ? "ADS PAUSED · REPLIES PAUSED"
              : settings.adsPaused
                ? "ADS PAUSED — replies still going out"
                : settings.outboundPaused
                  ? "REPLIES PAUSED — ads still going out"
                  : "Normal"}
          </strong>
          {settings.underAttack && <span className="ad-sold"> · UNDER ATTACK</span>}
        </p>
        <div className="sim-actions">
          <form action={adminSetPause} className="inline-form">
            <input type="hidden" name="which" value="ads" />
            <input type="hidden" name="on" value={settings.adsPaused ? "no" : "yes"} />
            <button
              className={settings.adsPaused ? "btn btn-sm" : "btn btn-sm btn-secondary"}
              type="submit"
            >
              {settings.adsPaused ? "Resume ads" : "Pause ads"}
            </button>
          </form>
          <form action={adminSetPause} className="inline-form">
            <input type="hidden" name="which" value="outbound" />
            <input type="hidden" name="on" value={settings.outboundPaused ? "no" : "yes"} />
            <button
              className={settings.outboundPaused ? "btn btn-sm" : "btn btn-sm btn-secondary"}
              type="submit"
            >
              {settings.outboundPaused ? "Resume replies" : "Pause replies (non-ad)"}
            </button>
          </form>
        </div>
        <p className="fine">
          <strong>Pause ads</strong> stops ads going out. Nothing is lost — approved ads
          queue and ride as soon as you resume. <strong>Pause replies</strong> stops
          member-facing messages that are NOT ads (command replies, PIC pictures,
          moderation notices); the ads keep flowing, and so do sign-in codes, alerts to
          you, and the outage notice itself. The two are independent — use either or both.
        </p>
        <p className="fine">
          Turning either one ON <strong>texts every subscriber</strong> a plain-language
          notice, so nobody is left wondering why the service went quiet. Turning it back
          off is silent — the ads returning is its own announcement.
        </p>
        <div className="sim-actions">
          <form action={adminSetUnderAttack} className="inline-form">
            <input type="hidden" name="on" value={settings.underAttack ? "no" : "yes"} />
            <button className="btn btn-sm btn-secondary" type="submit">
              {settings.underAttack ? "Exit UNDER ATTACK mode" : "Enter UNDER ATTACK mode"}
            </button>
          </form>
        </div>
        <p className="fine">
          UNDER ATTACK: stop replying to unknown/gibberish texts, skip new-subscriber catch-up,
          auto-tighten the per-number and service-wide SMS caps, and throttle outbound to the
          per-minute ceiling below. Pair it with the blocklist to kill bad actors — block them
          fast from <Link href="/admin/insights">Insights</Link>. <Tip k="settings.underAttack" />
        </p>
      </section>

      <form action={adminSaveSettings}>
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>
              {f.label}
              {f.hint && <span className="status-muted"> — {f.hint}</span>} <Tip k={f.tip} />
            </label>
            <input
              id={f.key}
              name={f.key}
              type="number"
              min={0}
              step={DOLLAR_FIELDS.has(f.key) ? "0.01" : "1"}
              defaultValue={DOLLAR_FIELDS.has(f.key) ? values[f.key] / 100 : values[f.key]}
              className="admin-num"
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="slots">
            Email edition times (hours ET, comma-separated) <Tip k="settings.slots" />
          </label>
          <input id="slots" name="slots" type="text" defaultValue={settings.slots.join(", ")} />
          <p className="fine">The email edition goes out at these same times.</p>
        </div>
        <div className="field">
          <label htmlFor="bannerText">
            Homepage banner (sales/announcements) <Tip k="settings.banner" />
          </label>
          <input
            id="bannerText"
            name="bannerText"
            type="text"
            maxLength={200}
            defaultValue={settings.promoBannerText}
            placeholder={'e.g. "SPRING SALE — picture ads $20 through Saturday"'}
          />
          <p className="fine">
            Shows as a banner at the top of the homepage. <strong>Clear the text and save to
            hide it.</strong>
          </p>
        </div>
        <div className="field">
          <label htmlFor="bannerLink">Banner links to (site page)</label>
          <input
            id="bannerLink"
            name="bannerLink"
            type="text"
            maxLength={200}
            defaultValue={settings.promoBannerLink}
            placeholder="/account#credits"
          />
          <p className="fine">
            Must start with &ldquo;/&rdquo; (a page on this site) — anything else falls back
            to the credits section.
          </p>
        </div>
        <button className="btn" type="submit">
          Save settings
        </button>
      </form>

      <h2 className="section-h">
        Word filter <Tip k="settings.wordFilter" />
      </h2>
      <p className="fine">
        The filter moved to its own tab, where both lists are editable as plain
        comma-separated text: <Link href="/admin/words">Word filter</Link>. It currently
        holds <strong>{words.length}</strong> {words.length === 1 ? "word" : "words"} —{" "}
        {words.filter((w) => w.autoReject).length} auto-reject,{" "}
        {words.filter((w) => !w.autoReject).length} flag-only.
      </p>

      <h2 className="section-h">
        Blocked numbers <Tip k="settings.blocklist" />
      </h2>
      <p className="fine">
        A blocked number is dropped the instant it texts — no reply, no account, no charge — and
        never receives a digest. Block bad actors with one click from{" "}
        <Link href="/admin/insights">Insights</Link>, or add one by hand here.
      </p>
      <ul className="myads">
        {blocked.map((b) => (
          <li key={b.phone} className="myad-row">
            <div className="sim-actions">
              <span className="pack-name">{formatPhone(b.phone)}</span>
              <span className="status-muted">{b.reason}</span>
              <form action={adminUnblockNumber} className="inline-form">
                <input type="hidden" name="phone" value={b.phone} />
                <button className="btn btn-sm btn-secondary" type="submit">
                  Unblock
                </button>
              </form>
            </div>
          </li>
        ))}
        {blocked.length === 0 && <li className="status-muted">No numbers blocked.</li>}
      </ul>
      <form action={adminBlockNumber} className="review-form">
        <input type="hidden" name="back" value="/admin/settings" />
        <div className="inline-fields">
          <input name="phone" type="tel" placeholder="Number to block…" required />
          <input name="reason" type="text" placeholder="Reason (optional)" />
          <button className="btn btn-sm" type="submit">
            Block
          </button>
        </div>
      </form>
    </>
  );
}
