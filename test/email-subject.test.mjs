// Email edition subject — led by the digest's standout ad (user format,
// session 008): "The Plain Exchange : 07-16-26 - Tractor trailer +3 more ads".
import {
  composeEmailSubject,
  pickStandoutAd,
  priceValue,
  shortDateLabel,
} from "../lib/ad-display.ts";

export const name = "email-subject";

const ad = (body) => ({ body });

export function run(t) {
  // Price ranking — the raw number behind "who's the standout".
  t.eq("plain dollars", priceValue("Hay $5"), 5);
  t.eq("thousands comma", priceValue("Buggy, $1,000 OBO"), 1000);
  t.eq("k shorthand is thousands", priceValue("Trailer $10k OBO"), 10000);
  t.eq("cents", priceValue("Eggs $5.50/dozen"), 5.5);
  t.eq("no price", priceValue("Free kittens to a good home"), null);

  // Standout pick: biggest ticket wins; no prices → digest order stands.
  t.eq(
    "highest price leads",
    pickStandoutAd([ad("Free kittens"), ad("Tractor trailer, $12,500 OBO"), ad("Hay $5")])?.body,
    "Tractor trailer, $12,500 OBO",
  );
  t.eq(
    "$10k outranks $9,999",
    pickStandoutAd([ad("Buggy $9,999"), ad("Tractor trailer $10k")])?.body,
    "Tractor trailer $10k",
  );
  t.eq(
    "no prices → first ad",
    pickStandoutAd([ad("Free kittens"), ad("Barn help wanted")])?.body,
    "Free kittens",
  );
  t.eq("tie keeps digest order", pickStandoutAd([ad("Hay $5"), ad("Eggs $5")])?.body, "Hay $5");
  t.eq("empty digest", pickStandoutAd([]), null);

  // Subject date is MM-DD-YY from the ET calendar day.
  t.eq("short date", shortDateLabel("2026-07-16"), "07-16-26");

  // The full subject line, exactly the user's format.
  t.eq(
    "user's example shape",
    composeEmailSubject(
      "The Plain Exchange",
      [ad("Free kittens"), ad("Tractor trailer, $12,500"), ad("Hay $5"), ad("Barn help wanted")],
      "2026-07-16",
    ),
    "The Plain Exchange : 07-16-26 - Tractor trailer +3 more ads",
  );
  t.eq(
    "single ad — no tail",
    composeEmailSubject("The Plain Exchange", [ad("Tractor trailer, $12,500")], "2026-07-16"),
    "The Plain Exchange : 07-16-26 - Tractor trailer",
  );
  t.eq(
    "two ads — singular tail",
    composeEmailSubject("The Plain Exchange", [ad("Hay $5"), ad("Eggs $4")], "2026-07-16"),
    "The Plain Exchange : 07-16-26 - Hay $5 +1 more ad",
  );
  t.eq(
    "edition tag preserved (send early)",
    composeEmailSubject("The Plain Exchange", [ad("Hay $5"), ad("Eggs $4")], "2026-07-16", " (sent early)"),
    "The Plain Exchange : 07-16-26 - Hay $5 +1 more ad (sent early)",
  );
  // Long lead clauses are already ellipsized by deriveTitle (64-char cap), so
  // a rambling first sentence can't blow up the subject line.
  const long = "Amish-built oak dining table with eight matching chairs and two leaf extensions in excellent condition $850";
  t.eq(
    "long title ellipsized",
    composeEmailSubject("The Plain Exchange", [ad(long)], "2026-07-16").length <= "The Plain Exchange : 07-16-26 - ".length + 64,
    true,
  );
}
