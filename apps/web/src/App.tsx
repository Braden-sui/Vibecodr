import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import { AnalyticsProvider } from "@/providers/posthog-provider";
import { EnsureUserSynced } from "@/components/EnsureUserSynced";
import { AppRoutes } from "./routes";
import { VibecodrWordmark } from "@/components/VibecodrWordmark";
import { ModerationNavLinks } from "@/components/ModerationNavLinks";
import { NotificationBell } from "@/components/Notifications";
import { TopbarSearch } from "@/components/TopbarSearch";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/clerk-react";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function App() {
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <AnalyticsProvider>
        <EnsureUserSynced />
        <BrowserRouter>
          <div className="border-b">
            <nav className="container mx-auto flex items-center gap-6 py-4">
              <VibecodrWordmark />
              <a href="/studio" className="hover:text-primary">
                Studio
              </a>
              <a href="/post/new" className="hover:text-primary">
                Share a vibe
              </a>
              <ModerationNavLinks />
              <div className="ml-auto flex items-center gap-3">
                <TopbarSearch />
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
                    <button
                      className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                      type="button"
                    >
                      Sign Up
                    </button>
                  </SignUpButton>
                </SignedOut>
              </div>
            </nav>
          </div>
          <main className="container mx-auto py-8">
            <AppRoutes />
          </main>
        </BrowserRouter>
      </AnalyticsProvider>
    </ClerkProvider>
  );
}
