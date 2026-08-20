"use client";

/**
 * Fire one analytics event when a server-rendered page mounts.
 *
 * The problem it solves: nearly every page here is a server component, and
 * `track()` only exists in the browser. Converting a page to a client
 * component just to count it would drag its data fetching to the client and
 * cost far more than the measurement is worth. So the page stays a server
 * component and renders this instead:
 *
 *     <TrackEvent name="view_item" params={{ items: [...] }} />
 *
 * It renders nothing. If the tag has not loaded yet the event is queued by
 * track() rather than dropped, which matters here more than anywhere else —
 * this is the first event of a page load, and it is the one that answers
 * "which listings are people actually looking at".
 */

import { useEffect, useRef } from "react";
import { track } from "./track";
import type { GaParams } from "./events";

interface Props {
  name: string;
  params?: GaParams;
}

export function TrackEvent({ name, params }: Props) {
  const sentKey = useRef<string | null>(null);

  useEffect(() => {
    // `params` is a fresh object on every render, so an effect keyed on it
    // would re-fire on any parent re-render. Key on the CONTENT instead, which
    // also makes this correct across a client-side navigation to another
    // listing: the name is the same, the parameters are not, so it fires again.
    const key = `${name}:${JSON.stringify(params ?? {})}`;
    if (sentKey.current === key) return;
    sentKey.current = key;
    track(name, params ?? {});
  }, [name, params]);

  return null;
}

export default TrackEvent;
