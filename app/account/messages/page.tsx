import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { listChatsFor } from "@/lib/store";
import { site } from "@/lib/config";

export const metadata: Metadata = {
  title: `Messages — ${site.name}`,
  robots: { index: false },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** Chat threads (FEATURES item 4): between member ids, no phone exposure. */
export default async function MessagesPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=%2Faccount%2Fmessages");
  const chats = await listChatsFor(session.phone);

  return (
    <div className="container account">
      <p className="backlink">
        <Link href="/account">← Your account</Link>
      </p>
      <h1>Messages</h1>
      <p className="fine">
        Conversations with other members about their ads. Member numbers stand in for names —
        nobody&apos;s phone number is shown here.
      </p>
      {chats.length === 0 && (
        <p>
          No conversations yet. Open one from any ad page with &ldquo;Message the seller&rdquo;.
        </p>
      )}
      <ul className="myads">
        {chats.map((chat) => (
          <li key={chat.id} className="myad-row">
            <p className="myad-title">
              {chat.otherPhoto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={chat.otherPhoto}
                  alt=""
                  width={28}
                  height={28}
                  style={{ borderRadius: "50%", verticalAlign: "middle", marginRight: 8, objectFit: "cover" }}
                />
              )}
              <Link href={`/account/messages/${chat.id}`}>
                Member {chat.otherMemberId ?? "(new)"}
                {chat.otherVerified && (
                  <span className="verified-badge" title="Verified member">
                    {" "}
                    ✓
                  </span>
                )}
                {chat.adId ? ` · about ad #${chat.adId}` : ""}
              </Link>
              {chat.unread && <span className="ad-sold"> New</span>}
            </p>
            <p className="myad-dates">Last message {when(chat.lastMessageAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
