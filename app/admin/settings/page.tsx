import type { Metadata } from "next";
import Link from "next/link";
import {
  adminAddWord,
  adminBlockNumber,
  adminRemoveWord,
  adminSaveSettings,
  adminSetPause,
  adminSetUnderAttack,
  adminToggleWord,
  adminUnblockNumber,
} from "@/lib/admin-actions";
import { getEngineSettings, getWordRules } from "@/lib/settings";
import { listBlocked } from "@/lib/blocklist";
import { formatPhone } from "@/lib/phone";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Settings — ${site.name} admin`,
};

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "costText", label: "Text ad cost (credits)" },
  { key: "costPhoto", label: "Picture ad cost (credits)" },
  { key: "bumpCost", label: "Bump cost (credits)", hint: "0 = free for now" },
  { key: "digestCap", label: "Max ads per digest" },
  { key: "maxChars", label: "Max ad length (characters)" },
  { key: "expiryDays", label: "Ad run time (days)" },
  {
    key: "smsRepliesPerHour",
    label: "Command replies per number per hour",
    hint: "past this, the engine stops answering that number",
  },
  {
    key: "smsPicsPerHour",
    label: "Pictures (PIC) per number per hour",
    hint: "burst limit — picture texts cost the most to send",
  },
  {
    key: "picDailyAllowance",
    label: "Picture pulls per number per day",
    hint: "PIC photos each number gets a day; unused ones bank (below). 0 turns the daily limit off",
  },
  {
    key: "picBankCap",
    label: "Most picture pulls a number can bank",
    hint: "the rolling/sinking fund ceiling — unused daily pulls stack up to this many",
  },
  {
    key: "smsGlobalPerHour",
    label: "Command replies service-wide per hour",
    hint: "circuit breaker — digests are never counted",
  },
  {
    key: "digestDailySegmentBudget",
    label: "Daily digest segment budget",
    hint: "billed SMS segments per rolling 24 hours before digest sending pauses (0 pauses digests)",
  },
  {
    key: "picAbusePerDay",
    label: "Flag excessive picture requests (per day)",
    hint: "on Insights, flag any number asking for more than this many pictures in 24h (0 turns the flag off)",
  },
  {
    key: "savedCardDiscountPercent",
    label: "Saved-card discount (%)",
    hint: "percent off a credit pack bought by text (BUYCREDIT) with a saved card; 0 = no discount",
  },
  {
    key: "outboundThrottlePerMin",
    label: "Under-attack outbound throttle (per minute)",
    hint: "global sends/minute ceiling, enforced ONLY while UNDER ATTACK mode is on (excess defers to the next tick)",
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
  const values = settings as unknown as Record<string, number>;

  return (
    <>
      <h1>Settings</h1>
      {params.saved && (
        <p className="notice" role="status">
          Settings saved — the engine uses them immediately.
        </p>
      )}

      <section className="controls-panel">
        <h2 className="section-h">System controls</h2>
        <p className="fine">
          Emergency kill switches. They take effect immediately — the engine reads them live.
        </p>
        <p>
          Outbound:{" "}
          <strong>
            {settings.pauseMode === "all"
              ? "FULL PAUSE — all outbound stopped"
              : settings.pauseMode === "bulk"
                ? "PARTIAL PAUSE — digests off, replies + sign-in on"
                : "Normal"}
          </strong>
          {settings.underAttack && <span className="ad-sold"> · UNDER ATTACK</span>}
        </p>
        <div className="sim-actions">
          <form action={adminSetPause} className="inline-form">
            <input type="hidden" name="mode" value="off" />
            <button className="btn btn-sm" type="submit" disabled={settings.pauseMode === "off"}>
              Resume normal
            </button>
          </form>
          <form action={adminSetPause} className="inline-form">
            <input type="hidden" name="mode" value="bulk" />
            <button
              className="btn btn-sm btn-secondary"
              type="submit"
              disabled={settings.pauseMode === "bulk"}
            >
              Partial pause (digests off)
            </button>
          </form>
          <form action={adminSetPause} className="inline-form">
            <input type="hidden" name="mode" value="all" />
            <button
              className="btn btn-sm btn-secondary"
              type="submit"
              disabled={settings.pauseMode === "all"}
            >
              FULL pause (all outbound off)
            </button>
          </form>
        </div>
        <p className="fine">
          Partial pause stops digests + new-subscriber catch-up but still sends command replies,
          picture (PIC) texts, sign-in codes and STOP confirmations. FULL pause stops every
          subscriber- and user-facing SMS and email (you still sign into admin with your
          password; alerts to you still arrive). Queued digests wait and resume when you set it
          back to Normal.
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
          fast from <Link href="/admin/insights">Insights</Link>.
        </p>
      </section>

      <form action={adminSaveSettings}>
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>
              {f.label}
              {f.hint && <span className="status-muted"> — {f.hint}</span>}
            </label>
            <input
              id={f.key}
              name={f.key}
              type="number"
              min={0}
              defaultValue={values[f.key]}
              className="admin-num"
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="slots">Digest slots (hours ET, comma-separated)</label>
          <input id="slots" name="slots" type="text" defaultValue={settings.slots.join(", ")} />
          <p className="fine">The email edition goes out at these same times.</p>
        </div>
        <button className="btn" type="submit">
          Save settings
        </button>
      </form>

      <h2 className="section-h">Word filter</h2>
      <p className="fine">
        Flagged words sort their ads to the top of the review queue. Auto-reject words bounce
        the ad instantly — nothing charged, no strike, kept for the audit trail.
      </p>
      <ul className="myads">
        {words.map((w) => (
          <li key={w.word} className="myad-row">
            <div className="sim-actions">
              <span className="pack-name">{w.word}</span>
              <span className={w.autoReject ? "ad-sold" : "status-muted"}>
                {w.autoReject ? "auto-reject" : "flag only"}
              </span>
              <form action={adminToggleWord} className="inline-form">
                <input type="hidden" name="word" value={w.word} />
                <button className="btn btn-sm btn-secondary" type="submit">
                  Make {w.autoReject ? "flag only" : "auto-reject"}
                </button>
              </form>
              <form action={adminRemoveWord} className="inline-form">
                <input type="hidden" name="word" value={w.word} />
                <button className="btn btn-sm btn-secondary" type="submit">
                  Remove
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <form action={adminAddWord} className="review-form">
        <div className="inline-fields">
          <input name="word" type="text" placeholder="Add a word…" required />
          <label className="sim-photo-toggle">
            <input type="checkbox" name="autoReject" /> auto-reject
          </label>
          <button className="btn btn-sm" type="submit">
            Add
          </button>
        </div>
      </form>

      <h2 className="section-h">Blocked numbers</h2>
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
