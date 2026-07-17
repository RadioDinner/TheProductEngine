import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  robots: { index: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="container admin">
      <nav className="admin-nav" aria-label="Admin">
        <Link href="/admin">Review</Link>
        <Link href="/admin/digests">Digests</Link>
        <Link href="/admin/reports">Reports</Link>
        <Link href="/admin/insights">Insights</Link>
        <Link href="/admin/ads">Ads</Link>
        <Link href="/admin/business">Business</Link>
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/subscribers">Subscribers</Link>
        <Link href="/admin/messages">Messages</Link>
        <Link href="/admin/settings">Settings</Link>
        <Link href="/admin/help">Help</Link>
      </nav>
      {children}
    </div>
  );
}
