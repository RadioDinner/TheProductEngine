import { permanentRedirect } from "next/navigation";

/**
 * The Digests tab became **Batches** in session 022 (user request). The name
 * had been wrong since session 018, when SMS stopped being a scheduled digest
 * and became batches triggered by count and age — every heading on the page
 * already said "batch" while the tab and the URL still said "digest".
 *
 * The old address stays, permanently redirecting, because it is the admin page
 * most likely to be bookmarked and it is linked from older session logs and
 * from the handbook. Query parameters ride along so an action that redirects
 * here with `?saved=…` still lands on the notice it meant to show.
 */
export default async function AdminDigestsMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const v of value) query.append(key, v);
  }
  permanentRedirect(`/admin/batches${query.size ? `?${query}` : ""}`);
}
