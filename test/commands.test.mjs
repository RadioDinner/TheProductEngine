// Inbound SMS command parsing — tolerance + ad-id extraction.
import { parseCommand } from "../lib/commands.ts";

export const name = "commands";

export function run(t) {
  /* ---- bare AD is canonical (session 020), and NEW must not eat a word ----
   * "New Holland" and "New Idea" are two of the commonest farm brands there
   * are. Stripping any leading "new" shipped ads that misnamed the goods. */
  const body = (text) => parseCommand(text).body;
  t.eq("bare AD posts", parseCommand("AD Hay for sale, $5 a bale").kind, "ad");
  t.eq("bare AD keeps the whole body", body("AD Hay for sale, $5 a bale"), "Hay for sale, $5 a bale");
  // No casing rule, on purpose (user: "when someone posts an ad by texting
  // 'AD New holland tractor', I want it to keep the New"). A member still
  // typing the old keyword keeps a leading NEW, which the operator trims in
  // review — cheap and visible, unlike an eaten brand name.
  t.eq("a trained member's AD NEW keeps the word rather than risk eating one",
    body("AD NEW Hay for sale, $5 a bale"), "NEW Hay for sale, $5 a bale");
  t.eq("AD NEW: separator", body("AD NEW: hay for sale"), "hay for sale");
  t.eq("AD NEW - separator", body("AD NEW - hay for sale"), "hay for sale");
  t.eq("bare AD NEW asks for the guide", body("AD NEW"), "");
  t.eq("New Holland keeps its brand", body("AD New Holland baler, $2800"), "New Holland baler, $2800");
  t.eq("New Idea keeps its brand", body("AD New Idea manure spreader, $900"), "New Idea manure spreader, $900");
  t.eq("a lower-case new is the seller's word",
    body("AD new puppies ready August 1"), "new puppies ready August 1");
  // Every casing a flip-phone typer might send "New Holland" in.
  t.eq("New holland — the user's own example", body("AD New holland tractor"), "New holland tractor");
  t.eq("NEW Holland (caps-lock N)", body("AD NEW Holland tractor"), "NEW Holland tractor");
  t.eq("NEW holland", body("AD NEW holland tractor"), "NEW holland tractor");
  t.eq("ALL CAPS", body("AD NEW HOLLAND BALER, $2800"), "NEW HOLLAND BALER, $2800");
  t.eq("all lower", body("AD new holland tractor"), "new holland tractor");
  t.eq("reversed NEW AD hands off the bare form", body("NEW AD Hay for sale"), "Hay for sale");
  t.eq("run-together NEWAD hands off the bare form", body("NEWAD Hay for sale"), "Hay for sale");
  // The owner-command re-route has to survive a NEW the strip declined to take.
  t.eq("AD NEW SOLD 1325 still routes to sold", parseCommand("AD NEW SOLD 1325").kind, "sold");
  t.eq("AD SOLD 1325 still routes to sold", parseCommand("AD SOLD 1325").kind, "sold");
  t.eq("a real ad about being sold out is NOT intercepted",
    parseCommand("AD sold out of hay, taking spring orders").kind, "ad");

  t.eq("SUBSCRIBE", parseCommand("SUBSCRIBE").kind, "subscribe");
  t.eq("lowercase stop", parseCommand("stop").kind, "stop");
  t.eq("cancel -> stop", parseCommand("cancel").kind, "stop");
  t.eq("/help with slash", parseCommand("/help").kind, "help");
  // These two pinned the OLD behaviour, where any leading "new" was stripped.
  // Session 020 narrowed that to protect brand names ("AD New holland tractor"
  // must keep its New), so an unseparated NEW now stays in the body and the
  // operator trims it in review. See stripKeywordNew for the full reasoning.
  t.eq("AD NEW body keeps the word now", parseCommand("AD NEW Horse cart, $50").body, "NEW Horse cart, $50");
  t.eq("bare AD body", parseCommand("ad Horse cart").body, "Horse cart");
  // A separator still marks it unambiguously as the keyword, so this is unchanged.
  t.eq("ad new mixed case + punctuation", parseCommand("Ad New: Hay $5").body, "Hay $5");
  t.eq("extra whitespace AD NEW", parseCommand("  AD   NEW   Wagon  ").body, "NEW   Wagon");
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
  // The bump feature is REMOVED (session 016, user decision: "completely
  // gone, from everywhere") — BUMP and the old purchase keywords are plain
  // unknown words now, answered by the automated-system redirect.
  t.eq("BUMP 1042 -> unknown (feature removed)", parseCommand("BUMP 1042").kind, "unknown");
  t.eq("buycredit 10 -> unknown (feature removed)", parseCommand("buycredit 10").kind, "unknown");
  t.eq("yes -> unknown (BUYCREDIT confirm removed)", parseCommand("yes").kind, "unknown");
  // CREDITS retired with the credit system it was named for (session 016);
  // BAL/BALANCE is the balance command, and it is what the welcome promises.
  t.eq("CREDITS is gone", parseCommand("credits").kind, "unknown");
  t.eq("BAL (no arg)", parseCommand("BAL").kind, "credits");
  t.eq("BALANCE (no arg)", parseCommand("balance").kind, "credits");
  t.eq("BAL with junk -> unknown", parseCommand("bal foo").kind, "unknown");
  t.eq("gibberish -> unknown", parseCommand("asdf qwer").kind, "unknown");
  t.eq("empty -> unknown", parseCommand("").kind, "unknown");
  t.eq("whitespace only -> unknown", parseCommand("   ").kind, "unknown");
  // Trailing punctuation on a single-word keyword still routes (compliance: STOP.)
  t.eq("STOP. -> stop", parseCommand("STOP.").kind, "stop");
  t.eq("Stop! -> stop", parseCommand("Stop!").kind, "stop");

  // CTIA/FCC opt-out words (session 013). END/REVOKE/OPTOUT are sole-keyword
  // only — real messages starting with those words must never unsubscribe.
  t.eq("END -> stop", parseCommand("END").kind, "stop");
  t.eq("STOPALL -> stop", parseCommand("STOPALL").kind, "stop");
  t.eq("REVOKE -> stop", parseCommand("Revoke").kind, "stop");
  t.eq("OPTOUT -> stop", parseCommand("optout").kind, "stop");
  t.eq("OPT-OUT -> stop", parseCommand("OPT-OUT").kind, "stop");
  t.eq("OPT OUT -> stop", parseCommand("OPT OUT").kind, "stop");
  t.eq("END. -> stop", parseCommand("END.").kind, "stop");
  t.eq("'End table for sale' is NOT a stop", parseCommand("End table for sale $30").kind, "unknown");
  t.eq("'Revoke my ad' is NOT a stop", parseCommand("Revoke my ad 1042").kind, "unknown");
  t.eq("'opt for the buggy' is NOT a stop", parseCommand("opt for the buggy").kind, "unknown");
  t.eq("SUBSCRIBE, -> subscribe", parseCommand("SUBSCRIBE,").kind, "subscribe");
  t.eq("bal! (no arg) -> balance", parseCommand("bal!").kind, "credits");
  t.eq("SOLD. 1042 keeps id", parseCommand("SOLD. 1042").id, 1042);
  // Slash followed by a space still routes to the keyword.
  t.eq("/ help (slash+space) -> help", parseCommand("/ help").kind, "help");
  t.eq("all-punctuation token -> unknown", parseCommand("...").kind, "unknown");

  // "AD <verb> <id>" re-routes to the owner command (a mistyped SOLD must
  // not silently post a junk ad + charge the seller). Only the exact
  // keyword+number shape re-routes; a real ad that merely starts with the
  // word does not. BUMP left the re-route set with the feature (session 016).
  t.eq("AD SOLD 1325 -> sold command", parseCommand("AD SOLD 1325").kind, "sold");
  t.eq("AD SOLD 1325 -> id 1325", parseCommand("AD SOLD 1325").id, 1325);
  t.eq("AD BUMP 1042 -> ad (bump removed)", parseCommand("AD BUMP 1042").kind, "ad");
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
