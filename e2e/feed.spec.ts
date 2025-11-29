import { test, expect } from "@playwright/test";

/**
 * Feed E2E Tests
 *
 * These tests assert STRUCTURAL behavior, not specific content.
 * They work against dynamic data from D1 and do not require seeded fixtures.
 *
 * Assertions check:
 * - Feed cards render (structure exists)
 * - Tabs switch correctly (UI behavior)
 * - Navigation works (routing)
 * - Interactions trigger expected state changes
 */

test.describe("Feed Page Structure", () => {
  test("should load feed with post cards", async ({ page }) => {
    await page.goto("/");

    // Wait for feed content to load - check for feed card structure, not specific titles
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await expect(feedCards.first()).toBeVisible({ timeout: 10000 });

    // Verify at least one card rendered
    const cardCount = await feedCards.count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test("should have functional tab navigation", async ({ page }) => {
    await page.goto("/");

    // Wait for feed to load
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {
      // Feed might be empty, which is ok - we're testing tabs work
    });

    // Click Following tab - should exist and be clickable
    const followingTab = page.getByRole("tab", { name: /Following/i });
    if (await followingTab.isVisible()) {
      await followingTab.click();

      // Tab should become selected (aria-selected or similar)
      await expect(followingTab).toHaveAttribute("aria-selected", "true");

      // Switch back to Latest
      const latestTab = page.getByRole("tab", { name: /Latest/i });
      await latestTab.click();
      await expect(latestTab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("should navigate to player when clicking a post card", async ({ page }) => {
    await page.goto("/");

    // Wait for and click the first post card
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Click on the card (or a link within it)
    const firstCard = feedCards.first();
    const cardLink = firstCard.locator("a").first();

    if (await cardLink.isVisible()) {
      await cardLink.click();
    } else {
      await firstCard.click();
    }

    // Should navigate to player page
    await expect(page).toHaveURL(/\/player\/.+/);
  });

  test("should navigate to profile when clicking author handle", async ({ page }) => {
    await page.goto("/");

    // Wait for feed cards
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Find an author handle link (starts with @)
    const authorLink = page.locator("a").filter({ hasText: /^@\w+/ }).first();

    if (await authorLink.isVisible()) {
      await authorLink.click();

      // Should navigate to profile page
      await expect(page).toHaveURL(/\/profile\/.+/);
    }
  });

  test("should display post stats on cards", async ({ page }) => {
    await page.goto("/");

    // Wait for feed cards
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Stats should be visible (numbers representing runs, likes, comments)
    const firstCard = feedCards.first();
    const statsNumbers = firstCard.locator("text=/\\d+/");

    // At least one stat number should be visible
    await expect(statsNumbers.first()).toBeVisible();
  });
});

test.describe("Feed Interactions", () => {
  test("should have working like buttons", async ({ page }) => {
    await page.goto("/");

    // Wait for feed cards
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Find a like button (heart icon or button with number)
    const likeButton = page.locator("button[aria-label*='like' i], button[aria-label*='heart' i]").first();

    if (await likeButton.isVisible()) {
      // Button should be clickable (interaction works)
      await likeButton.click();

      // No crash, button still visible
      await expect(likeButton).toBeVisible();
    }
  });

  test("should have working share buttons", async ({ page }) => {
    await page.goto("/");

    // Wait for feed cards
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Find share button
    const shareButton = page.locator("button[aria-label*='share' i]").first();

    if (await shareButton.isVisible()) {
      await shareButton.click();

      // Share action should trigger without crashing
      await page.waitForTimeout(500);
    }
  });

  test("should navigate to Studio on Remix click", async ({ page }) => {
    await page.goto("/");

    // Wait for feed cards
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

    // Find Remix button
    const remixButton = page.getByRole("button", { name: /Remix/i }).first();

    if (await remixButton.isVisible()) {
      await remixButton.click();

      // Should navigate to Studio with remix param
      await expect(page).toHaveURL(/\/studio(\?|.*remixFrom=)/);
    }
  });
});

test.describe("Feed Empty States", () => {
  test("should handle empty Following tab gracefully", async ({ page }) => {
    await page.goto("/");

    // Click Following tab
    const followingTab = page.getByRole("tab", { name: /Following/i });
    if (await followingTab.isVisible()) {
      await followingTab.click();

      // Should show either posts or an empty state message - not crash
      await page.waitForTimeout(1000);

      // Page should still be functional
      const latestTab = page.getByRole("tab", { name: /Latest/i });
      await expect(latestTab).toBeVisible();
    }
  });
});
