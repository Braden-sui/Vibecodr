import { useRef } from "react";
import { BrowserRouter, Link, useLocation } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import { AnalyticsProvider } from "@/providers/posthog-provider";
import { EnsureUserSynced } from "@/components/EnsureUserSynced";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppRoutes } from "./routes";
import { VibecodrWordmark } from "@/components/VibecodrWordmark";
import { ModerationNavLinks } from "@/components/ModerationNavLinks";
import { AdminAnalyticsNavLink } from "@/components/AdminAnalyticsNavLink";
import { AdminPlanNavLink } from "@/components/AdminPlanNavLink";
import { NotificationBell } from "@/components/Notifications";
import { TopbarSearch } from "@/components/TopbarSearch";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/clerk-react";
import { Highlight, HighlightItem } from "@/lib/animate-ui/highlight";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function PrimaryNav() {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  // Track if this is the initial mount to prevent re-animation on route changes
  const hasAnimatedRef = useRef(false);
  const shouldAnimate = !prefersReducedMotion && !hasAnimatedRef.current;
  if (!hasAnimatedRef.current) hasAnimatedRef.current = true;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 vc-glass rounded-none border-x-0 border-t-0",
        shouldAnimate && "animate-in fade-in slide-in-from-top-3 duration-400"
      )}
    >
      <nav className="container mx-auto flex items-center gap-5 py-4">
        <Highlight className="flex items-center gap-2 rounded-full px-2 py-1" radiusClassName="rounded-full">
          <HighlightItem asChild>
            <Link to="/" data-highlighted={isActive("/") || undefined} className="flex items-center gap-3 px-2 py-1">
              <VibecodrWordmark />
              <span className="hidden text-sm font-medium text-muted-foreground sm:inline">Playable vibes lab</span>
            </Link>
          </HighlightItem>

          <HighlightItem asChild>
            <Link
              to="/post/new"
              data-highlighted={isActive("/post/new") || undefined}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold hover:text-primary"
            >
              Share a vibe
            </Link>
          </HighlightItem>

          <HighlightItem asChild>
            <Link
              to="/pricing"
              data-highlighted={isActive("/pricing") || undefined}
              className="rounded-full px-3 py-2 text-sm hover:text-primary"
            >
              Pricing
            </Link>
          </HighlightItem>
        </Highlight>

        <div className="flex items-center gap-3 text-sm">
          <ModerationNavLinks />
          <AdminAnalyticsNavLink />
          <AdminPlanNavLink />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <TopbarSearch />
          <SignedIn>
            <NotificationBell />
          </SignedIn>
          <SignedOut>
            <SignInButton>
              <button
                className="rounded-full px-4 py-2 text-sm font-medium transition-transform hover:text-primary hover:scale-[1.03] active:scale-[0.98]"
                type="button"
              >
                Sign In
              </button>
            </SignInButton>
            <SignUpButton>
              <button
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-vc-soft transition-all hover:scale-[1.04] hover:shadow-[0_8px_30px_-18px_rgba(59,130,246,0.65)] active:scale-[0.98]"
                type="button"
              >
                Sign Up
              </button>
            </SignUpButton>
          </SignedOut>
        </div>
      </nav>
    </header>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <AnalyticsProvider>
          <EnsureUserSynced />
          <BrowserRouter>
            <PrimaryNav />
            <main className="container mx-auto py-10">
              <AppRoutes />
            </main>
          </BrowserRouter>
        </AnalyticsProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
