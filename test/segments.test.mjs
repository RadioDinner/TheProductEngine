// GSM-7 / UCS-2 segmentation + ad packing — the cost-accounting math.
import { segmentation, septets, isGsm7, packMessages, totalSegments, gsmSanitize } from "../lib/sms-segments.ts";

export const name = "segments";

export function run(t) {
  // Segment boundaries (GSM: 160 single / 153 multi; UCS-2: 70 / 67).
  t.eq("160 GSM chars = 1 seg", segmentation("a".repeat(160)).segments, 1);
  t.eq("161 GSM chars = 2 seg", segmentation("a".repeat(161)).segments, 2);
  t.eq("306 GSM chars = 2 seg (153*2)", segmentation("a".repeat(306)).segments, 2);
  t.eq("307 GSM chars = 3 seg", segmentation("a".repeat(307)).segments, 3);
  t.eq("GSM extension char { = 2 septets", septets("{"), 2);
  t.eq("159 a + { = 161 septets -> 2 seg", segmentation("a".repeat(159) + "{").segments, 2);
  t.eq("emoji -> ucs2 encoding", segmentation("hello 😀").encoding, "ucs2");
  t.eq("70 UCS2 units = 1 seg", segmentation("😀".repeat(35)).segments, 1);
  t.eq("71 UCS2 units = 2 seg", segmentation("😀".repeat(35) + "x").segments, 2);
  t.eq("plain ascii is gsm", isGsm7("Hello, world! $5"), true);
  t.eq("emoji is not gsm", isGsm7("hi 😀"), false);

  // Packing: whole ads into fewest single-segment messages.
  const p1 = packMessages({ header: "Hdr:", adLines: ["#1 short ad", "#2 another"], maxGsm: 160 });
  t.eq("small ads pack into 1 message", p1.length, 1);
  t.eq("packed message keeps header + ads", p1[0], "Hdr:\n#1 short ad\n#2 another");

  const long = "#3 " + "x".repeat(200);
  const p2 = packMessages({ header: "Hdr:", adLines: ["#1 a", long, "#2 b"], maxGsm: 160 });
  t.eq("an over-long ad is its own whole message", p2.some((m) => m.includes(long)), true);

  const p3 = packMessages({ header: "H", adLines: ["#1 a"], footer: "Reply STOP to end", maxGsm: 160 });
  t.eq("footer appended to last message when it fits", p3[p3.length - 1].includes("Reply STOP to end"), true);

  t.eq("totalSegments sums parts", totalSegments(["a".repeat(160), "b".repeat(161)]), 3);
  t.eq("gsmSanitize keeps ascii, maps curly quotes", gsmSanitize("it’s “ok”"), "it's \"ok\"");
}
