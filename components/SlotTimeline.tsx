import { FEATURED_CAPACITY, assignSlots, formatRunDay } from "@/lib/featured-schedule";

export interface TimelineRun {
  /** The day this run starts showing. */
  startDay: string;
  /** Who it is — a business name, or whatever the operator should read. */
  label: string;
}

/**
 * The four featured slots as rows, with each booked run drawn as a bar across
 * the dates it occupies (user, session 019: "I want all 4 of the slots showing
 * as rows with durations across dates").
 *
 * This is the picture the arithmetic was always describing. The queue page can
 * only say "the next one starts September 16th"; four rows show WHY — which
 * slot frees when, where the gaps are, and how far out the board is sold.
 *
 * Server component, drawn with CSS grid rather than a chart library: the
 * horizontal axis is one grid column per day, so a bar is just a
 * `grid-column: start / end`. Nothing to hydrate, nothing to load.
 *
 * Slots are derived, not stored — assignSlots() replays the same
 * earliest-free-slot rule the booking used, so this drawing can never disagree
 * with the schedule it is drawing.
 */
export function SlotTimeline({
  runs,
  today,
  windowStart,
  windowEnd,
}: {
  runs: TimelineRun[];
  today: string;
  /** First and last day of the window drawn (last is exclusive). */
  windowStart: string;
  windowEnd: string;
}) {
  const booked = assignSlots(runs.map((r) => r.startDay));

  // One grid column per day. Days are ISO strings, so the offset is a plain
  // difference in milliseconds — no timezone can slide it at noon UTC.
  const dayIndex = (day: string): number =>
    Math.round(
      (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${windowStart}T12:00:00Z`)) / 86400000,
    );
  const totalDays = Math.max(1, dayIndex(windowEnd));

  // A tick at the first of each month, so the axis is readable without
  // labelling 60 days.
  const monthTicks: { at: number; label: string }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(Date.parse(`${windowStart}T12:00:00Z`) + i * 86400000)
      .toISOString()
      .slice(0, 10);
    if (day.endsWith("-01") || i === 0) {
      monthTicks.push({
        at: i,
        label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      });
    }
  }

  const todayAt = dayIndex(today);
  const slots = Array.from({ length: FEATURED_CAPACITY }, (_, i) => i + 1);

  return (
    <div className="slot-timeline">
      <div className="slot-axis" style={{ gridTemplateColumns: `repeat(${totalDays}, 1fr)` }}>
        {monthTicks.map((tick) => (
          <span
            key={tick.at}
            className="slot-tick"
            style={{ gridColumn: `${tick.at + 1} / span 1` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {slots.map((slot) => {
        const inSlot = booked.filter((b) => b.slot === slot);
        return (
          <div key={slot} className="slot-row">
            <span className="slot-name">
              Slot {slot}
              <span className="status-muted"> · {slot <= 2 ? "left" : "right"}</span>
            </span>
            <div
              className="slot-track"
              style={{ gridTemplateColumns: `repeat(${totalDays}, 1fr)` }}
            >
              {/* Today's line, so "sold out until…" is something you can see. */}
              {todayAt >= 0 && todayAt < totalDays && (
                <span
                  className="slot-today"
                  style={{ gridColumn: `${todayAt + 1} / span 1` }}
                  aria-hidden="true"
                />
              )}
              {inSlot.map((run) => {
                const from = Math.max(0, dayIndex(run.startDay));
                const to = Math.min(totalDays, dayIndex(run.endDay));
                if (to <= 0 || from >= totalDays) return null; // outside the window
                const label = runs[run.index]?.label ?? "Booked";
                const ended = run.endDay <= today;
                return (
                  <span
                    key={`${run.startDay}-${run.index}`}
                    className={`slot-bar${ended ? " slot-bar--past" : ""}`}
                    style={{ gridColumn: `${from + 1} / ${Math.max(from + 2, to + 1)}` }}
                    title={`${label} · ${formatRunDay(run.startDay)} to ${formatRunDay(run.endDay)}`}
                  >
                    <span className="slot-bar-label">{label}</span>
                  </span>
                );
              })}
              {inSlot.length === 0 && <span className="slot-empty">open</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
