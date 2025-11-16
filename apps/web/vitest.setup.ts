import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { createElement } from "react";

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
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => {
    return createElement("a", { href, ...props }, children);
  },
}));

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
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

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
