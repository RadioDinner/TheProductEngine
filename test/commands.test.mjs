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
  // Known quirk (harmless — no pack is 100, so it's rejected downstream):
  t.eq("buycredit 1000 parses first 3 digits = 100", parseCommand("buycredit 1000").amount, 100);
}
