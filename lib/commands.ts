/**
 * Tolerant SMS command parser (spec Q13): case-insensitive, slash optional,
 * forgiving about the AD NEW keyword and stray whitespace.
 */

export type Command =
  | { kind: "subscribe" }
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "ad"; body: string }
  | { kind: "pic"; id: number | null }
  | { kind: "credits" }
  | { kind: "sold"; id: number | null }
  | { kind: "status"; id: number | null }
  | { kind: "myads" }
  | { kind: "bump"; id: number | null }
  | { kind: "buycredit"; amount: number | null }
  | { kind: "confirm" }
  | { kind: "unknown"; text: string };

function adNumber(arg: string): number | null {
  // Full digit run, not a 6-digit prefix: "SOLD 12345678" must not silently
  // become ad #123456 (a phone number in the text becomes a not-found id,
  // caught by the ownership check, instead of a wrong-ad match).
  const match = arg.match(/\d{3,}/);
  if (!match) return null;
  const id = Number(match[0]);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseCommand(raw: string): Command {
  // Re-trim after stripping a leading slash so "/ help" (slash then space)
  // doesn't leave a leading space that swallows the keyword.
  const text = raw.trim().replace(/^\/+/, "").trim();
  const lower = text.toLowerCase();
  // First whitespace-delimited token; strip trailing punctuation so "STOP.",
  // "YES!", "SUBSCRIBE," still route (people and carriers add punctuation to a
  // keyword). `rest` is sliced from the ORIGINAL token so args survive
  // ("SOLD. 1234" -> id 1234). Trailing digits are kept (no keyword ends in one).
  const [rawWord = ""] = lower.split(/\s+/, 1);
  const word = rawWord.replace(/[^a-z0-9]+$/g, "");
  const rest = text.slice(rawWord.length).trim();

  switch (word) {
    case "subscribe":
      return { kind: "subscribe" };
    case "stop":
    case "unsubscribe":
    case "cancel":
    case "quit":
      return { kind: "stop" };
    case "start":
    case "unstop":
      return { kind: "start" };
    case "help":
    case "info":
      return { kind: "help" };
    case "ad": {
      // "AD NEW <body>" is canonical; bare "AD <body>" works too.
      const body = rest.replace(/^new\b[\s:,-]*/i, "").trim();
      // "AD SOLD 1325" / "AD BUMP 3" / "AD STATUS 1042" / "AD PIC 900": the sender
      // clearly meant the owner command, not an ad whose entire text is a keyword
      // plus a number. Re-route ONLY that exact shape, so a real ad ("AD sold out,
      // taking spring orders...") is never intercepted. Prevents a mistyped SOLD
      // from silently posting a junk ad and burning a credit/free pass.
      if (/^(sold|bump|status|pic)\s+\d{3,}\s*$/i.test(body)) {
        return parseCommand(body);
      }
      return { kind: "ad", body };
    }
    case "pic":
    case "photo":
    case "picture":
      return { kind: "pic", id: adNumber(rest) };
    case "credits":
    case "credit":
      return rest ? { kind: "unknown", text } : { kind: "credits" };
    case "sold":
      return { kind: "sold", id: adNumber(rest) };
    case "status":
      return { kind: "status", id: adNumber(rest) };
    case "myads":
      return { kind: "myads" };
    case "bump":
      return { kind: "bump", id: adNumber(rest) };
    case "buycredit":
    case "buycredits": {
      const match = rest.match(/\d{1,3}/);
      return { kind: "buycredit", amount: match ? Number(match[0]) : null };
    }
    case "yes":
    case "y":
    case "confirm":
      return { kind: "confirm" };
    default:
      return { kind: "unknown", text };
  }
}
