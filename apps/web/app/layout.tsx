import React from "react";
import "./globals.css";
import { ClerkProvider, SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { NotificationBell } from "@/components/Notifications";
import { AnalyticsProvider } from "@/providers/posthog-provider";

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
          <AnalyticsProvider>
          <header className="border-b">
            <nav className="container mx-auto flex items-center gap-6 py-4">
              <Link href="/" className="text-xl font-bold">
                Vibecodr
              </Link>
              <Link href="/studio" className="hover:text-primary">
                Studio
              </Link>
              <Link href="/live" className="hover:text-primary">
                Live
              </Link>
              <Link href="/report/new" className="hover:text-primary">
                New Report
              </Link>
              <div className="ml-auto flex items-center gap-2">
                <SignedIn>
                  <NotificationBell />
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
                <SignedOut>
                  <SignInButton>
                    <button className="rounded-md px-4 py-2 text-sm font-medium hover:text-primary" type="button">
                      Sign In
                    </button>
                  </SignInButton>
                  <SignUpButton>
                    <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90" type="button">
                      Sign Up
                    </button>
                  </SignUpButton>
                </SignedOut>
              </div>
            </nav>
          </header>
          <main className="container mx-auto py-8">{children}</main>
          </AnalyticsProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
