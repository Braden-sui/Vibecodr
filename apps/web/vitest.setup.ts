import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { createElement, type ComponentProps, type PropsWithChildren } from "react";

// Extend Vitest matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock Next.js Link
vi.mock("next/link", () => {
  type LinkProps = ComponentProps<"a">;
  return {
    default: ({ children, href = "#", ...props }: LinkProps) =>
      createElement("a", { href, ...props }, children),
  };
});


// Mock Clerk hooks/components with safe defaults for tests.
vi.mock("@clerk/clerk-react", () => {
  const mockUser = {
    id: "test-user",
    username: "tester",
    fullName: "Test User",
    imageUrl: "",
    publicMetadata: {},
  };
  const useUser = vi.fn(() => ({ user: mockUser, isSignedIn: true, isLoaded: true }));
  const useAuth = vi.fn(() => ({
    getToken: vi.fn(async () => "test-token"),
    isLoaded: true,
    userId: mockUser.id,
    sessionId: "sess-test",
    orgId: null,
  }));
  const passthrough = ({ children }: PropsWithChildren) => createElement("div", null, children);
  const button = ({ children, ...props }: ComponentProps<"button">) =>
    createElement("button", { type: "button", ...props }, children);
  return {
    useUser,
    useAuth,
    ClerkProvider: passthrough,
    SignedIn: passthrough,
    SignedOut: passthrough,
    SignInButton: button,
    SignUpButton: button,
    UserButton: () => createElement("div", { "data-testid": "mock-user-button" }),
  };
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(private readonly callback: IntersectionObserverCallback = () => undefined) {}
  disconnect(): void {}
  observe(_target: Element): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(_target: Element): void {}
}
global.IntersectionObserver = MockIntersectionObserver;

// Mock ResizeObserver
class MockResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback = () => undefined) {}
  disconnect(): void {}
  observe(_target: Element, _options?: ResizeObserverOptions | undefined): void {}
  unobserve(_target: Element): void {}
}
global.ResizeObserver = MockResizeObserver;

const RADIX_STACK_REGEX = /@radix-ui\/react-/i;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function isRadixNoise(args: unknown[]): boolean {
  return args.some((arg) => {
    if (!arg) return false;
    if (typeof arg === "string") {
      return RADIX_STACK_REGEX.test(arg);
    }
    if (arg instanceof Error && typeof arg.stack === "string") {
      return RADIX_STACK_REGEX.test(arg.stack);
    }
    return false;
  });
}

console.error = (...args: unknown[]) => {
  if (isRadixNoise(args)) {
    return;
  }
  originalConsoleError(...args);
};

console.warn = (...args: unknown[]) => {
  if (isRadixNoise(args)) {
    return;
  }
  originalConsoleWarn(...args);
};
