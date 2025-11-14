"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

export function ModerationNavLinks() {
  const { user, isSignedIn } = useUser();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModerator = role === "moderator" || metadata?.isModerator === true;
  const isAdmin = role === "admin";

  if (!isSignedIn || (!isModerator && !isAdmin)) {
    return null;
  }

  return (
    <>
      <Link href="/moderation/flagged" className="hover:text-primary">
        Moderation
      </Link>
      {isAdmin && (
        <Link href="/moderation/audit" className="hover:text-primary">
          Audit log
        </Link>
      )}
    </>
  );
}
