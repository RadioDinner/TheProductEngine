import type { Metadata } from "next";
import {
  adminAddWord,
  adminRemoveWord,
  adminSaveSettings,
  adminToggleWord,
} from "@/lib/admin-actions";
import { getEngineSettings, getWordRules } from "@/lib/settings";
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
    hint: "picture texts cost the most to send",
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
];

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const settings = await getEngineSettings();
  const words = await getWordRules();
  const values = settings as unknown as Record<string, number>;

  return (
    <>
      <h1>Settings</h1>
      {params.saved && (
        <p className="notice" role="status">
          Settings saved — the engine uses them immediately.
        </p>
      )}
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
        </div>
        <div className="field">
          <label htmlFor="emailSlots">Email edition slots (hours ET, comma-separated)</label>
          <input
            id="emailSlots"
            name="emailSlots"
            type="text"
            defaultValue={settings.emailSlots.join(", ")}
          />
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
    </>
  );
}
