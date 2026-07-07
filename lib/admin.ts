import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/session";

/** Admins are the phone numbers listed in ADMIN_PHONES (comma-separated). */
export function isAdminPhone(phone: string): boolean {
  return (process.env.ADMIN_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean)
    .includes(phone);
}

/** Signed-out → login; signed-in non-admin → plain 404 (the portal doesn't advertise). */
export async function requireAdmin(): Promise<string> {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Fadmin");
  if (!isAdminPhone(session.phone)) notFound();
  return session.phone;
}
