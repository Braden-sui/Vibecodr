"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";

export function ModerationNavLinks() {
  const { user, isSignedIn } = useUser();

  const role = (user?.publicMetadata as any)?.role as string | undefined;
  const isModerator = role === "moderator" || (user?.publicMetadata as any)?.isModerator === true;
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
