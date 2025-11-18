import { Suspense } from "react";
import { ClerkProvider, SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/Notifications";
import { AnalyticsProvider } from "@/providers/posthog-provider";
import { TopbarSearch } from "../../components/TopbarSearch";
import { ModerationNavLinks } from "@/components/ModerationNavLinks";
import Link from "next/link";
import { VibecodrWordmark } from "@/components/VibecodrWordmark";
import { EnsureUserSynced } from "@/components/EnsureUserSynced";
import { ClientRouter } from "@/components/ClientRouter";

export const metadata = {
  title: "Vibecodr",
  description: "Runnable micro-apps feed for Vibecoders",
};

export const runtime = "edge";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <AnalyticsProvider>
        <EnsureUserSynced />
        <ClientRouter>
          <header className="border-b">
            <nav className="container mx-auto flex items-center gap-6 py-4">
              <VibecodrWordmark />
              <Link prefetch={false} href="/studio" className="hover:text-primary">
                Studio
              </Link>
              <Link href="/post/new" className="hover:text-primary">
                Share a vibe
              </Link>
              <ModerationNavLinks />
              <div className="ml-auto flex items-center gap-3">
                <Suspense fallback={null}>
                  <TopbarSearch />
                </Suspense>
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
        </ClientRouter>
      </AnalyticsProvider>
    </ClerkProvider>
  );
}
