# Testing Infrastructure

Comprehensive testing suite for the Vibecodr platform covering all layers of the application.

## Overview

Our testing strategy includes:

- **Unit Tests** - Testing individual functions and utilities
- **Component Tests** - Testing React components in isolation
- **Integration Tests** - Testing API endpoints and data flow
- **E2E Tests** - Testing complete user flows across browsers
- **Performance Tests** - Measuring load times, FPS, and resource usage

## Test Structure

```
vibecodr/
├── packages/shared/
│   ├── src/
│   │   ├── manifest.test.ts          # Manifest validation tests
│   │   └── ...
│   └── vitest.config.ts
├── workers/api/
│   ├── src/
│   │   ├── storage/quotas.test.ts    # Quota enforcement tests
│   │   └── handlers/social.test.ts   # Social handlers tests
│   └── test/
│       └── integration/              # API integration tests
├── apps/web/
│   ├── components/
│   │   └── __tests__/                # Component tests
│   │       ├── FeedCard.test.tsx
│   │       ├── QuotaUsage.test.tsx
│   │       ├── ReportButton.test.tsx
│   │       ├── Comments.test.tsx
│   │       └── Notifications.test.tsx
│   ├── vitest.config.ts
│   └── vitest.setup.ts
└── e2e/
    ├── feed.spec.ts                  # Feed page E2E tests
    ├── studio.spec.ts                # Studio page E2E tests
    ├── player.spec.ts                # Player page E2E tests
    ├── profile.spec.ts               # Profile page E2E tests
    └── performance.spec.ts           # Performance benchmarks
```

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run unit tests in watch mode
npm run test:unit -- --watch

# Run unit tests for specific package
npm run test:unit -w packages/shared
npm run test:unit -w workers/api
```

### Component Tests

```bash
# Run all component tests
npm run test:component

# Run component tests in watch mode
npm run test:component -- --watch

# Run specific component test
npm run test:component -- FeedCard
```

### E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run E2E tests for specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Run E2E tests in UI mode
npm run test:e2e:ui

# Run specific test file
npx playwright test e2e/feed.spec.ts
```

### Performance Tests

```bash
# Run performance tests
npm run test:performance

# Run performance tests with report
npx playwright test e2e/performance.spec.ts --reporter=html
```

### Coverage

```bash
# Generate coverage report
npm run test:coverage

# View coverage in browser
open packages/shared/coverage/index.html
open apps/web/coverage/index.html
```

## Test Coverage Thresholds

### Unit Tests (packages/shared)
- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%

### Component Tests (apps/web)
- Lines: 70%
- Functions: 70%
- Branches: 65%
- Statements: 70%

## Writing Tests

### Unit Tests

Unit tests use Vitest and test individual functions/utilities:

```typescript
import { describe, it, expect } from "vitest";
import { manifestSchema } from "./manifest";

describe("Manifest Validation", () => {
  it("should validate a minimal valid manifest", () => {
    const manifest = {
      version: "1.0",
      runner: "client-static",
      entry: "index.html",
    };

    const result = manifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
```

### Component Tests

Component tests use Vitest + React Testing Library:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedCard } from "../FeedCard";

describe("FeedCard", () => {
  it("should render post title", () => {
    const post = {
      id: "1",
      title: "Test Post",
      type: "app" as const,
    };

    render(<FeedCard post={post} />);
    expect(screen.getByText("Test Post")).toBeInTheDocument();
  });
});
```

### E2E Tests

E2E tests use Playwright:

```typescript
import { test, expect } from "@playwright/test";

test("should load feed", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Vibecodr Feed")).toBeVisible();
  await expect(page.getByText("Interactive Boids Simulation")).toBeVisible();
});
```

### Performance Tests

Performance tests measure metrics:

```typescript
test("should load feed within 2 seconds", async ({ page }) => {
  const startTime = Date.now();
  await page.goto("/");
  await expect(page.getByText("Vibecodr Feed")).toBeVisible();

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(2000);
});
```

## CI/CD Integration

Tests run automatically on:
- Every push to `main`, `develop`, or `claude/**` branches
- Every pull request to `main` or `develop`

### GitHub Actions Workflow

The test workflow includes:
1. **Unit Tests** - Runs unit tests for all packages
2. **Component Tests** - Runs component tests for web app
3. **E2E Tests** - Runs E2E tests on Chromium, Firefox, and WebKit
4. **Performance Tests** - Runs performance benchmarks
5. **Lint & Type Check** - Validates code quality

See `.github/workflows/test.yml` for full configuration.

## Test Files Created

### Unit Tests (3 files)
- `packages/shared/src/manifest.test.ts` - Manifest validation (12 tests)
- `workers/api/src/storage/quotas.test.ts` - Quota enforcement (9 tests)
- `workers/api/src/handlers/social.test.ts` - Social handlers (8 tests)

### Component Tests (5 files)
- `apps/web/components/__tests__/FeedCard.test.tsx` - Feed card component (10 tests)
- `apps/web/components/__tests__/QuotaUsage.test.tsx` - Quota usage component (8 tests)
- `apps/web/components/__tests__/ReportButton.test.tsx` - Report button component (11 tests)
- `apps/web/components/__tests__/Comments.test.tsx` - Comments component (14 tests)
- `apps/web/components/__tests__/Notifications.test.tsx` - Notifications component (14 tests)

### E2E Tests (5 files)
- `e2e/feed.spec.ts` - Feed page tests (11 tests)
- `e2e/studio.spec.ts` - Studio page tests (18 tests)
- `e2e/player.spec.ts` - Player page tests (22 tests)
- `e2e/profile.spec.ts` - Profile page tests (17 tests)
- `e2e/performance.spec.ts` - Performance tests (15 tests)

### Integration Tests (2 files)
- `workers/api/test/integration/capsules.test.ts` - Capsules API (6 tests)
- `workers/api/test/integration/social.test.ts` - Social API (12 tests)

**Total: 190+ tests across all levels**

## Performance Budgets

Our performance targets:

| Metric | Target | Importance |
|--------|--------|------------|
| Feed Load Time | < 2s | Critical |
| Player Boot Time | < 1s | Critical |
| Studio Load Time | < 1.5s | High |
| Scroll FPS | > 30fps | High |
| LCP | < 2.5s | Critical |
| FID | < 100ms | Critical |
| CLS | < 0.1 | High |
| Total JS Bundle | < 2MB | Medium |

## Debugging Tests

### Visual Debugging

```bash
# Open Playwright Inspector
npx playwright test --debug

# Run tests in headed mode
npx playwright test --headed

# Run with trace recording
npx playwright test --trace on
```

### Component Test Debugging

```bash
# Run single test in watch mode
npm run test:component -- FeedCard --watch

# Enable verbose logging
npm run test:component -- --reporter=verbose
```

## Best Practices

1. **Write tests first** - TDD approach for new features
2. **Test user behavior** - Focus on what users do, not implementation
3. **Avoid testing implementation details** - Test public APIs
4. **Use descriptive test names** - Should read like documentation
5. **Keep tests independent** - Each test should run in isolation
6. **Mock external dependencies** - Use vi.mock() for external services
7. **Test edge cases** - Include error states and boundary conditions
8. **Maintain test coverage** - Keep coverage above thresholds

## Troubleshooting

### Tests timing out

Increase timeout in test file:
```typescript
test("slow test", async ({ page }) => {
  test.setTimeout(60000); // 60 seconds
  // ...
});
```

### Flaky tests

Add retries in playwright.config.ts:
```typescript
retries: process.env.CI ? 2 : 0
```

### Mock not working

Clear mocks between tests:
```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library](https://testing-library.com/react)
- [Test Coverage Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
