"use client";

import { useEffect, useState } from "react";
import { FEATURED_ROTATE_MS, rotationIndex } from "@/lib/featured";

/** Serializable spot shape the server page passes down. */
export interface RotatorSpot {
  id: number;
  src: string;
  caption: string | null;
  linkUrl: string | null;
}

/**
 * One Featured slot (item 19): shows one image ad at a time, advancing every
 * 8 seconds through up to 3 spots. Restraint, not carousel razzle:
 *
 * - rotation PAUSES while the tab is hidden (visibilitychange) — no burning
 *   timers offscreen, and nobody misses a paid impression;
 * - prefers-reduced-motion: no auto-advance at all — the dots become the
 *   only (manual) way through, and they're always there for direct access;
 * - the swap is an instant src change, not a slide/fade (nothing animates,
 *   so there's nothing further to suppress).
 *
 * External links are the operator-only exception to the no-links rule and
 * always carry rel="sponsored noopener nofollow" + target="_blank".
 */
export function FeaturedRotator({ slot, spots }: { slot: number; spots: RotatorSpot[] }) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion || spots.length < 2) return;
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(
        () => setIndex((i) => rotationIndex(i + 1, spots.length)),
        FEATURED_ROTATE_MS,
      );
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion, spots.length]);

  const shown = spots[rotationIndex(index, spots.length)];
  if (!shown) return null;

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- operator images
    // live in our own bucket (or are data: URIs in dev) with arbitrary
    // dimensions; next/image would refuse the data: form and buys nothing here.
    <img className="featured-img" src={shown.src} alt={shown.caption ?? "Featured advertisement"} />
  );

  return (
    <div className="featured-slot" data-testid={`featured-slot-${slot}`} data-spot-id={shown.id}>
      {shown.linkUrl ? (
        <a href={shown.linkUrl} target="_blank" rel="sponsored noopener nofollow">
          {image}
        </a>
      ) : (
        image
      )}
      {shown.caption && <p className="featured-caption">{shown.caption}</p>}
      {spots.length > 1 && (
        <div className="featured-dots">
          {spots.map((spot, i) => {
            const current = spot.id === shown.id;
            return (
              <button
                key={spot.id}
                type="button"
                className="featured-dot"
                aria-current={current ? "true" : undefined}
                aria-label={`Show featured ad ${i + 1} of ${spots.length}`}
                onClick={() => setIndex(i)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
