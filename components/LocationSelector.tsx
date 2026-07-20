import type { Area } from "@/lib/areas";

/**
 * The area / location filter (FEATURES item 26). Multi-select: a reader can
 * tick one or more plain settlements and see just those areas' ads. Rendered
 * as a plain GET form (no client JS), matching the homepage category filter,
 * so it works for the flip-phone browser too.
 *
 * BUILT BUT HIDDEN for now (user instruction): the homepage only mounts this
 * when AREAS_SELECTOR_ENABLED is true. Listing-side filtering by area is the
 * next step and lands when a second area actually has ads — until then Holmes
 * is the only area with data, so ticking a box changes nothing yet.
 */
export function LocationSelector({
  areas,
  selected,
}: {
  areas: Area[];
  /** Currently-chosen area slugs (from the ?area= query). */
  selected: string[];
}) {
  const chosen = new Set(selected);
  return (
    <section className="location-filter" aria-labelledby="location-h">
      <h2 id="location-h" className="side-h">
        Location
      </h2>
      <form className="location-form" action="/" method="get">
        <ul className="location-options">
          {areas.map((area) => (
            <li key={area.slug}>
              <label className="location-option">
                <input
                  type="checkbox"
                  name="area"
                  value={area.slug}
                  defaultChecked={chosen.has(area.slug)}
                />
                <span>
                  {area.shortName}
                  {area.live ? "" : " (soon)"}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm btn-block" type="submit">
          Show these areas
        </button>
      </form>
    </section>
  );
}
