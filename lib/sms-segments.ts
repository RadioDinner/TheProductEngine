/**
 * GSM-7 aware SMS segmentation + ad packing.
 *
 * Carriers bill per SEGMENT, not per message: a single-segment SMS is 160
 * GSM-7 characters (153 when a message spans multiple segments); a message
 * with any non-GSM character is billed as UCS-2 at 70/67. So the cheapest,
 * most reliable digest is a series of messages each kept to ONE GSM-7 segment,
 * with whole ads packed in — no ad split across a boundary, and one stray
 * emoji can't flip the entire broadcast to UCS-2 (it's contained to its own
 * message).
 */

// GSM 03.38 basic set — each character is 1 septet.
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(
    "",
  ),
);
// Extension set — each character is 2 septets (via an ESC prefix).
const GSM7_EXT = new Set("\f^{}\\[~]|€".split(""));

// Common non-GSM characters mapped to GSM-7 equivalents so real ad text
// (curly quotes, dashes, ellipses from phone keyboards) stays single-byte.
const TRANSLIT: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "«": '"', "»": '"', "‹": "'", "›": "'",
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", "•": "-", "·": "-", " ": " ",
  "™": "TM", "®": "(R)", "©": "(C)", "€": "€",
};

/** Replace common non-GSM punctuation with GSM-7 equivalents. */
export function gsmSanitize(text: string): string {
  let out = "";
  for (const ch of text) out += TRANSLIT[ch] ?? ch;
  return out;
}

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXT.has(ch)) return false;
  }
  return true;
}

/** Septet count assuming GSM-7 (extension chars count as 2). */
export function septets(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXT.has(ch) ? 2 : 1;
  return n;
}

export interface Segmentation {
  encoding: "gsm" | "ucs2";
  units: number;
  segments: number;
}

export function segmentation(text: string): Segmentation {
  if (isGsm7(text)) {
    const units = septets(text);
    return { encoding: "gsm", units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = text.length; // UTF-16 code units = UCS-2 billing units
  return { encoding: "ucs2", units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Does this message stay within one segment at the target size? */
function fitsOneSegment(text: string, maxGsm: number): boolean {
  return isGsm7(text) ? septets(text) <= maxGsm : text.length <= 70;
}

/**
 * Pack a header + ad lines + optional footer into as few single-segment SMS
 * messages as possible, keeping each ad whole. An ad longer than one segment
 * on its own becomes its own (multi-segment) message — unavoidable, but still
 * minimal. Ad lines should already be gsmSanitize()d by the caller.
 */
export function packMessages(params: {
  header: string;
  adLines: string[];
  footer?: string;
  maxGsm?: number;
}): string[] {
  const max = params.maxGsm ?? 160;
  const sep = "\n";
  const headerLines = params.header ? [params.header] : [];
  const groups: string[][] = [];
  let cur = [...headerLines];
  const hasAd = () => cur.length > headerLines.length;

  for (const line of params.adLines) {
    const candidate = [...cur, line].join(sep);
    if (!hasAd() || fitsOneSegment(candidate, max)) {
      // Place the first ad even if header+ad overflows one segment; otherwise
      // only add while it still fits.
      cur.push(line);
    } else {
      groups.push(cur);
      cur = [line];
    }
  }
  if (hasAd()) groups.push(cur);

  const messages = groups.map((g) => g.join(sep));

  if (params.footer) {
    const last = messages[messages.length - 1];
    const withFooter = last !== undefined ? `${last}${sep}${params.footer}` : params.footer;
    if (last !== undefined && fitsOneSegment(withFooter, max)) {
      messages[messages.length - 1] = withFooter;
    } else {
      messages.push(params.footer);
    }
  }
  return messages;
}

/** Total billed segments across a set of messages. */
export function totalSegments(messages: string[]): number {
  return messages.reduce((sum, m) => sum + segmentation(m).segments, 0);
}
