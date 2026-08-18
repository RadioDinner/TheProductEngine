import { HANDBOOK, type HandbookKey } from "@/lib/admin-handbook";
import { HelpTip } from "@/components/HelpTip";

/**
 * Server-side lookup for a handbook "?" tip. Pages write <Tip k="digests.sendEarly" />
 * and the key is checked at compile time — a typo fails tsc, so a tip can never
 * silently render blank. Keeping the lookup on the server means the handbook text
 * travels only in the admin-gated page payload.
 */
export function Tip({ k }: { k: HandbookKey }) {
  const entry = HANDBOOK[k];
  return (
    <HelpTip title={entry.title} what={entry.what} why={entry.why} gotchas={entry.gotchas} />
  );
}
