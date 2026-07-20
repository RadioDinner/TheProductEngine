// Inbound SMS command parsing — tolerance + ad-id extraction.
import { parseCommand } from "../lib/commands.ts";

export const name = "commands";

export function run(t) {
  t.eq("SUBSCRIBE", parseCommand("SUBSCRIBE").kind, "subscribe");
  t.eq("lowercase stop", parseCommand("stop").kind, "stop");
  t.eq("cancel -> stop", parseCommand("cancel").kind, "stop");
  t.eq("/help with slash", parseCommand("/help").kind, "help");
  t.eq("AD NEW body", parseCommand("AD NEW Horse cart, $50").body, "Horse cart, $50");
  t.eq("bare AD body", parseCommand("ad Horse cart").body, "Horse cart");
  t.eq("ad new mixed case + punctuation", parseCommand("Ad New: Hay $5").body, "Hay $5");
  t.eq("extra whitespace AD NEW", parseCommand("  AD   NEW   Wagon  ").body, "Wagon");
  // Reversed order (item: flip-phone typers) — "NEW AD" means "AD NEW".
  t.eq("NEW AD reversed -> ad", parseCommand("NEW AD Horse cart, $50").kind, "ad");
  t.eq("NEW AD reversed body", parseCommand("NEW AD Horse cart, $50").body, "Horse cart, $50");
  t.eq("New Ad mixed case + punct", parseCommand("New Ad: Hay $5").body, "Hay $5");
  t.eq("NEWAD run-together -> ad", parseCommand("NEWAD Wagon").body, "Wagon");
  t.eq(
    "NEW AD real dump-trailer body -> ad",
    parseCommand("NEW AD 7x12 10k Tandem Axle Dump Trailer for Sale 11k OBO. Text 330-600-1834").kind,
    "ad",
  );
  t.eq("new (not ad) stays unknown", parseCommand("new puppies for sale").kind, "unknown");
  t.eq("SOLD full 8-digit id (not truncated)", parseCommand("SOLD 12345678").id, 12345678);
  t.eq("SOLD 4-digit", parseCommand("SOLD 1042").id, 1042);
  t.eq("SOLD with phone in text -> full run", parseCommand("SOLD call 3305550142").id, 3305550142);
  t.eq("PIC no id -> null", parseCommand("PIC").id, null);
  t.eq("STATUS no id -> null", parseCommand("STATUS").id, null);
  t.eq("BUMP 1042", parseCommand("BUMP 1042").id, 1042);
  t.eq("buycredit 10", parseCommand("buycredit 10").amount, 10);
  t.eq("BUYCREDIT 25", parseCommand("BUYCREDIT 25").amount, 25);
  t.eq("yes -> confirm", parseCommand("yes").kind, "confirm");
  t.eq("y -> confirm", parseCommand("y").kind, "confirm");
  t.eq("credits (no arg)", parseCommand("credits").kind, "credits");
  t.eq("credits with junk -> unknown", parseCommand("credits foo").kind, "unknown");
  t.eq("gibberish -> unknown", parseCommand("asdf qwer").kind, "unknown");
  t.eq("empty -> unknown", parseCommand("").kind, "unknown");
  t.eq("whitespace only -> unknown", parseCommand("   ").kind, "unknown");
  // Trailing punctuation on a single-word keyword still routes (compliance: STOP.)
  t.eq("STOP. -> stop", parseCommand("STOP.").kind, "stop");
  t.eq("Stop! -> stop", parseCommand("Stop!").kind, "stop");
  t.eq("YES. -> confirm", parseCommand("YES.").kind, "confirm");
  t.eq("SUBSCRIBE, -> subscribe", parseCommand("SUBSCRIBE,").kind, "subscribe");
  t.eq("credits! (no arg) -> credits", parseCommand("credits!").kind, "credits");
  t.eq("SOLD. 1042 keeps id", parseCommand("SOLD. 1042").id, 1042);
  // Slash followed by a space still routes to the keyword.
  t.eq("/ help (slash+space) -> help", parseCommand("/ help").kind, "help");
  t.eq("all-punctuation token -> unknown", parseCommand("...").kind, "unknown");
  // Known quirk (harmless — no pack is 100, so it's rejected downstream):
  t.eq("buycredit 1000 parses first 3 digits = 100", parseCommand("buycredit 1000").amount, 100);

  // "AD <verb> <id>" re-routes to the owner command (a mistyped SOLD/BUMP must
  // not silently post a junk ad + burn a credit). Only the exact keyword+number
  // shape re-routes; a real ad that merely starts with the word does not.
  t.eq("AD SOLD 1325 -> sold command", parseCommand("AD SOLD 1325").kind, "sold");
  t.eq("AD SOLD 1325 -> id 1325", parseCommand("AD SOLD 1325").id, 1325);
  t.eq("AD BUMP 1042 -> bump", parseCommand("AD BUMP 1042").kind, "bump");
  t.eq("AD STATUS 1042 -> status", parseCommand("AD STATUS 1042").kind, "status");
  t.eq("ad pic 900 -> pic", parseCommand("ad pic 900").kind, "pic");
  // Even explicit "AD NEW SOLD 1325" re-routes — the body is the exact
  // keyword+number shape, and no real ad is literally "SOLD 1325".
  t.eq("AD NEW SOLD 1325 also re-routes to sold", parseCommand("AD NEW SOLD 1325").kind, "sold");
  t.eq("real ad starting with 'sold' stays an ad",
    parseCommand("AD sold out, taking spring orders, $200 each. 330-555-0100").kind, "ad");
  t.eq("AD SOLD (no number) stays an ad", parseCommand("AD SOLD everything must go").kind, "ad");

  // Ratings flow (FEATURES item 2): RATE 1-5 and SKIP.
  t.eq("RATE 5 -> rate", parseCommand("RATE 5").kind, "rate");
  t.eq("RATE 5 stars", parseCommand("rate 5").stars, 5);
  t.eq("rate 3 stars text", parseCommand("RATE 3 stars").stars, 3);
  t.eq("RATE 6 -> null stars (hint)", parseCommand("RATE 6").stars, null);
  t.eq("RATE alone -> null stars", parseCommand("RATE").stars, null);
  t.eq("RATE 55 -> null stars", parseCommand("RATE 55").stars, null);
  t.eq("SKIP -> skip", parseCommand("SKIP").kind, "skip");
  t.eq("skip. with punctuation", parseCommand("skip.").kind, "skip");
  t.eq("NO -> skip", parseCommand("No").kind, "skip");
}
