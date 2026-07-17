// Featured rotating sidebar (FEATURES item 19): the per-slot rotation order
// (position sort, 3-spot display cap), the 8-second tick → index math the
// client rotator uses, and the operator-link acceptance rule.
import {
  FEATURED_ROTATE_MS,
  SPOTS_PER_SLOT,
  acceptableSpotLink,
  rotationIndex,
  slotRotation,
} from "../lib/featured.ts";

export const name = "featured";

export function run(t) {
  t.eq("8-second rotation", FEATURED_ROTATE_MS, 8000);
  t.eq("3 spots per slot", SPOTS_PER_SLOT, 3);

  // Per-slot rotation: filter to the slot, position order, id breaking ties.
  const spots = [
    { id: 10, slot: 2, position: 1 },
    { id: 11, slot: 1, position: 3 },
    { id: 12, slot: 1, position: 1 },
    { id: 13, slot: 1, position: 2 },
    { id: 14, slot: 1, position: 2 }, // duplicate order — older id first
  ];
  t.eq(
    "slot 1 order: position then id",
    slotRotation(spots, 1).map((s) => s.id),
    [12, 13, 14],
  );
  t.eq(
    "slot 1 caps at 3 (position-3 spot displaced by the dup)",
    slotRotation(spots, 1).length,
    3,
  );
  t.eq("slot 2 alone", slotRotation(spots, 2).map((s) => s.id), [10]);
  t.eq("empty slot", slotRotation(spots, 3), []);
  t.eq("input order untouched", spots.map((s) => s.id), [10, 11, 12, 13, 14]);

  // Tick → index math (also the dots' manual path).
  t.eq("tick 0 shows first", rotationIndex(0, 3), 0);
  t.eq("tick 1 shows second", rotationIndex(1, 3), 1);
  t.eq("tick 3 wraps", rotationIndex(3, 3), 0);
  t.eq("tick 7 of 3", rotationIndex(7, 3), 1);
  t.eq("single spot never moves", rotationIndex(500, 1), 0);
  t.eq("negative tick wraps safely", rotationIndex(-1, 3), 2);
  t.eq("zero spots stays 0", rotationIndex(4, 0), 0);
  t.eq("NaN tick stays 0", rotationIndex(Number.NaN, 3), 0);

  // Operator link rule: absolute http(s) only — never script/data schemes.
  t.eq("https ok", acceptableSpotLink("https://millersharness.com/sale"), true);
  t.eq("http ok", acceptableSpotLink("http://example.com"), true);
  t.eq("javascript: refused", acceptableSpotLink("javascript:alert(1)"), false);
  t.eq("data: refused", acceptableSpotLink("data:text/html,<b>x</b>"), false);
  t.eq("protocol-relative refused", acceptableSpotLink("//example.com"), false);
  t.eq("bare domain refused", acceptableSpotLink("example.com"), false);
  t.eq("empty refused", acceptableSpotLink(""), false);
}
