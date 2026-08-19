/**
 * The signed-in MEMBER gate: a session, plus the number still being welcome.
 *
 * WHY THIS EXISTS (session 016). The blocklist was enforced in exactly two
 * places — the top of the inbound SMS engine and every outbound send — so
 * "Block" meant "silent on the text lane" and nothing at all on the website.
 * A blocked number that had ever set a password could still sign in, post ads,
 * open chats and reveal sellers' numbers. That is not what the button looks
 * like it does: the admin handbook says a blocked number is "dropped at the
 * door: no reply, no account, no charge", and the operator blocking someone
 * mid-abuse reasonably expects them gone, not merely muted.
 *
 * Deliberately NOT wired into readSession(), even though that is the one
 * chokepoint every authenticated request already passes through: readSession
 * also backs requireAdmin, so a blocklist check there would let the operator
 * lock themselves out of the admin panel — with no way back in, since
 * unblocking lives inside the panel. Member write-paths take this gate;
 * admin keeps the plain session.
 *
 * Reading the public site while blocked is left alone on purpose. Browsing
 * costs nothing and reveals nothing a signed-out visitor can't see; what
 * matters is that a blocked number cannot ACT.
 */
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { isBlockedNumber } from "@/lib/blocklist";

/**
 * The signed-in member's phone, or a redirect.
 *
 * `next` is where to send them back to after signing in. A blocked number is
 * sent to the sign-in page with `error=blocked` rather than a bare failure, so
 * the screen can say something true instead of looking broken.
 *
 * isBlockedNumber fails OPEN on a database error (by design — see
 * lib/blocklist.ts), so a Supabase blip degrades to today's behaviour rather
 * than locking every member out of their own account.
 */
export async function requireMemberPhone(next: string): Promise<string> {
  const session = await readSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (await isBlockedNumber(session.phone)) {
    redirect(`/login?error=blocked&next=${encodeURIComponent(next)}`);
  }
  return session.phone;
}
