// Price derivation — what the website shows next to an ad. "$10k OBO"
// rendering as "$10" is a real-world pricing bug (session 007).
import { derivePrice } from "../lib/ad-display.ts";

export const name = "ads";

export function run(t) {
  t.eq("$10k keeps the k", derivePrice("7x12 dump trailer. $10k OBO"), "$10k");
  t.eq("$10K uppercase", derivePrice("Trailer $10K firm"), "$10K");
  t.eq("plain dollars", derivePrice("Hay $5"), "$5");
  t.eq("thousands with comma", derivePrice("Buggy, $1,000 OBO"), "$1,000");
  t.eq("cents kept", derivePrice("Eggs $5.50/dozen"), "$5.50");
  t.eq("k must end the token", derivePrice("$5 Kids bikes"), "$5");
  t.eq("first price wins", derivePrice("Was $20, now $15"), "$20");
  t.eq("no price", derivePrice("Free kittens to a good home"), null);
}
