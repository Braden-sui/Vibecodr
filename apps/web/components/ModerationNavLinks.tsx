"use client";

import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";

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
      <Link to="/moderation/flagged" className="hover:text-primary">
        Moderation
      </Link>
      {isAdmin && (
        <Link to="/moderation/audit" className="hover:text-primary">
          Audit log
        </Link>
      )}
    </>
  );
}
