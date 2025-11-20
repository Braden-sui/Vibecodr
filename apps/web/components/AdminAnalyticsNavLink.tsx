"use client";

import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";

type PublicMetadata = {
  role?: string;
} | null;

export function AdminAnalyticsNavLink() {
  const { user, isSignedIn } = useUser();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;

  if (!isSignedIn || role !== "admin") {
    return null;
  }

  return (
    <Link to="/admin/analytics" className="hover:text-primary">
      Analytics
    </Link>
  );
}
