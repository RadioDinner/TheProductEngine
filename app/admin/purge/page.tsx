import type { Metadata } from "next";
import Link from "next/link";
import { PurgeMember } from "@/components/PurgeMember";
import { site } from "@/lib/config";
import { Tip } from "@/components/Tip";

export const metadata: Metadata = {
  title: `Purge a member — ${site.name} admin`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default function AdminPurge() {
  return (
    <>
      <h1>
        Purge a member <Tip k="purge.purpose" />
      </h1>

      <p className="fine">
        Removes a member and everything attached to them: their ads and pictures, every
        text and email logged either way, their ledger entries, conversations, number
        look-ups, ratings, recorded sales, strikes, town-hall events, calls, and any
        sends still queued for them. Then the account itself.
      </p>
      <p className="fine">
        <strong>This is how you correct Insights.</strong> Nothing on that page is a
        stored number — every figure is worked out live from these rows, so there is no
        total to edit. Take the rows away and money spent, ads served, the funnel and
        the people counts all come right at once, and stay right.
      </p>
      <p className="notice">
        <strong>It cannot be undone.</strong> There is no archive and no restore. Preview
        first — the button says so — and read what it found before you type DELETE. Meant
        for clearing out your own pre-launch testing, not for handling a member you have
        fallen out with: for that, <Link href="/admin/settings">block the number</Link> or
        ban them from posting, both of which keep the record.
      </p>

      <PurgeMember />

      <h2 className="section-h">What it does not touch</h2>
      <p className="fine">
        Digests that already went out keep their numbering and their history — the ad
        rows inside them go, but the editions themselves stay, so the record of what was
        sent on a given day is not rewritten. A purged member&rsquo;s six-digit member id
        is retired for a year rather than freed, so a number that comes back can never be
        handed somebody else&rsquo;s old identity. Blocked numbers stay blocked: purging
        does not un-block anyone.
      </p>
    </>
  );
}
