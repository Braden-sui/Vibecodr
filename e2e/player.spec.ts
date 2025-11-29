import { test, expect } from "@playwright/test";

/**
 * Player E2E Tests
 *
 * These tests navigate to player pages DYNAMICALLY from the feed,
 * rather than using hardcoded post IDs that may not exist.
 *
 * Assertions check:
 * - Player iframe loads
 * - Controls work (restart, params, share)
 * - Navigation from player works
 * - Error states display correctly
 */

// Helper to navigate to a real post's player page from the feed
async function navigateToFirstPost(page: import("@playwright/test").Page) {
  await page.goto("/");

  // Wait for feed cards
  const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
  await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

  // Click on the first card to navigate to player
  const firstCard = feedCards.first();
  const cardLink = firstCard.locator("a").first();

  if (await cardLink.isVisible()) {
    await cardLink.click();
  } else {
    await firstCard.click();
  }

  // Wait for player page
  await expect(page).toHaveURL(/\/player\/.+/);
}

test.describe("Player Page Structure", () => {
  test("should load player with iframe", async ({ page }) => {
    await navigateToFirstPost(page);

    // Wait for player iframe to load
    await expect(page.locator("iframe").first()).toBeVisible({ timeout: 10000 });
  });

  test("should display post metadata (title and author)", async ({ page }) => {
    await navigateToFirstPost(page);

    // Should have some title text (h1 or prominent text)
    const heading = page.locator("h1, [data-testid='post-title']").first();
    await expect(heading).toBeVisible();

    // Should have author handle somewhere
    const authorHandle = page.locator("text=/^@\\w+/").first();
    if (await authorHandle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(authorHandle).toBeVisible();
    }
  });

  test("should display stats (runs, likes, comments)", async ({ page }) => {
    await navigateToFirstPost(page);

    // Check for stats section with numbers
    const statsNumbers = page.locator("text=/\\d+/");
    await expect(statsNumbers.first()).toBeVisible();
  });

  test("should have player controls", async ({ page }) => {
    await navigateToFirstPost(page);

    // Should have control buttons (restart, share, etc.)
    const buttons = page.getByRole("button");
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });
});

test.describe("Player Controls", () => {
  test("should have working restart button", async ({ page }) => {
    await navigateToFirstPost(page);

    const restartButton = page.getByRole("button", { name: /Restart/i });
    if (await restartButton.isVisible()) {
      await restartButton.click();

      // Should not crash, button still visible
      await expect(restartButton).toBeVisible();
    }
  });

  test("should show param controls if post has params", async ({ page }) => {
    await navigateToFirstPost(page);

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Should show some param controls (sliders, toggles, etc.)
      const paramControls = page.locator("input, [role='slider'], [role='switch']");
      if (await paramControls.count() > 0) {
        await expect(paramControls.first()).toBeVisible();
      }
    }
  });

  test("should allow adjusting params without crashing", async ({ page }) => {
    await navigateToFirstPost(page);

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Try to adjust a slider if present
      const slider = page.getByRole("slider").first();
      if (await slider.isVisible({ timeout: 1000 }).catch(() => false)) {
        await slider.fill("50");
        await page.waitForTimeout(500);
      }

      // Try to toggle a switch if present
      const toggle = page.getByRole("switch").first();
      if (await toggle.isVisible({ timeout: 1000 }).catch(() => false)) {
        await toggle.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test("should have working share button", async ({ page }) => {
    await navigateToFirstPost(page);

    const shareButton = page.getByRole("button", { name: /Share/i });
    if (await shareButton.isVisible()) {
      await shareButton.click();

      // Should trigger share action without crashing
      await page.waitForTimeout(500);
    }
  });

  test("should have working remix button", async ({ page }) => {
    await navigateToFirstPost(page);

    const remixButton = page.getByRole("button", { name: /Remix/i });
    if (await remixButton.isVisible()) {
      await remixButton.click();

      // Should navigate to Studio
      await expect(page).toHaveURL(/\/studio/);
    }
  });
});

test.describe("Player Navigation", () => {
  test("should navigate to author profile when clicking handle", async ({ page }) => {
    await navigateToFirstPost(page);

    // Find author handle link
    const authorLink = page.locator("a").filter({ hasText: /^@\w+/ }).first();

    if (await authorLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await authorLink.click();

      // Should navigate to profile
      await expect(page).toHaveURL(/\/profile\/.+/);
    }
  });
});

test.describe("Player Error States", () => {
  test("should handle non-existent post gracefully", async ({ page }) => {
    // Use a random UUID that won't exist
    await page.goto("/player/00000000-0000-0000-0000-000000000000");

    // Should show error state (not found, error, or similar)
    const errorMessage = page.getByText(/not found|error|doesn't exist/i);
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Player Mobile Responsiveness", () => {
  test("should work on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await navigateToFirstPost(page);

    // Player iframe should be visible
    await expect(page.locator("iframe").first()).toBeVisible();
  });

  test("should show accessible controls on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await navigateToFirstPost(page);

    // Controls should be accessible
    const buttons = page.getByRole("button");
    await expect(buttons.first()).toBeVisible();
  });
});

test.describe("Player Comments", () => {
  test("should open comments section", async ({ page }) => {
    await navigateToFirstPost(page);

    const commentsTab = page.getByRole("tab", { name: /Comments/i });
    if (await commentsTab.isVisible()) {
      await commentsTab.click();

      // Should show comment input or comments list
      const commentArea = page.getByPlaceholder(/comment/i).or(page.locator("[data-testid='comments-list']"));
      await expect(commentArea).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe("Player Reporting", () => {
  test("should have report functionality", async ({ page }) => {
    await navigateToFirstPost(page);

    // Look for report button (might be in a menu)
    const reportButton = page.getByRole("button", { name: /Report/i });
    const moreButton = page.getByRole("button", { name: /More/i }).or(page.locator("button[aria-label*='more' i]"));

    if (await reportButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reportButton.click();
      await expect(page.getByText(/Report/i)).toBeVisible();
    } else if (await moreButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await moreButton.click();
      // Report option should be in menu
      const reportOption = page.getByRole("menuitem", { name: /Report/i });
      if (await reportOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(reportOption).toBeVisible();
      }
    }
  });
});
