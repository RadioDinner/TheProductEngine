import Link from "next/link";
import { site } from "@/lib/config";

export default function NotFound() {
  return (
    <div className="container">
      <div className="empty-state">
        <h1>No listing at this address.</h1>
        <p>
          The page you’re after doesn’t exist — the ad number may be mistyped.{" "}
          <Link href="/">See the latest ads</Link>, or text <strong>STATUS</strong> and the ad
          number to <strong>{site.smsNumber}</strong> to check any ad by text.
        </p>
      </div>
    </div>
  );
}
