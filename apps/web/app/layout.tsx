import React from "react";
import "./globals.css";
import { ClerkProvider, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export const metadata = {
  title: "Vibecodr",
  description: "Runnable micro-apps feed for makers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // TODO: Add PostHog analytics provider
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <header className="border-b">
            <nav className="container mx-auto flex items-center gap-6 py-4">
              <Link href="/" className="text-xl font-bold">
                Vibecodr
              </Link>
              <Link href="/studio" className="hover:text-primary">
                Studio
              </Link>
              <Link href="/report/new" className="hover:text-primary">
                New Report
              </Link>
              <div className="ml-auto flex items-center gap-4">
                <SignedIn>
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
                <SignedOut>
                  <Link href="/sign-in" className="hover:text-primary">
                    Sign In
                  </Link>
                  <Link
                    href="/sign-up"
                    className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                  >
                    Sign Up
                  </Link>
                </SignedOut>
              </div>
            </nav>
          </header>
          <main className="container mx-auto py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}

