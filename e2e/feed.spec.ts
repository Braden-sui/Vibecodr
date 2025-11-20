import { test, expect } from "@playwright/test";

test.describe("Feed Page", () => {
  test("should load feed with posts", async ({ page }) => {
    await page.goto("/");

    // Wait for feed to load
    await expect(page.getByText("Vibecodr Feed")).toBeVisible();

    // Check for posts (mock data should be visible)
    await expect(page.getByText("Interactive Boids Simulation")).toBeVisible();
    await expect(page.getByText("Building a Tiny Paint App")).toBeVisible();
  });

  test("should switch between Latest and Following tabs", async ({ page }) => {
    await page.goto("/");

    // Click Following tab
    await page.getByRole("tab", { name: "Following" }).click();

    // Should show empty state for Following
    await expect(page.getByText("Follow other Vibecoders to personalize this lane.")).toBeVisible();

    // Switch back to Latest
    await page.getByRole("tab", { name: "Latest" }).click();

    // Should show posts again
    await expect(page.getByText("Interactive Boids Simulation")).toBeVisible();
  });

  test("should navigate to post player on click", async ({ page }) => {
    await page.goto("/");

    // Click on a post card
    await page.getByText("Interactive Boids Simulation").click();

    // Should navigate to player page
    await expect(page).toHaveURL(/\/player\//);
  });

  test("should open profile on author click", async ({ page }) => {
    await page.goto("/");

    // Click on author handle
    await page.getByText("@marta").first().click();

    // Should navigate to profile page
    await expect(page).toHaveURL(/\/profile\/marta/);
  });

  test("should display post stats", async ({ page }) => {
    await page.goto("/");

    // Check for stats (likes, comments, runs)
    const firstCard = page.locator("article, [role='article'], .group").first();

    await expect(firstCard.getByText(/\d+/)).toBeVisible(); // Stats should be visible
  });

  test("should render capability badges", async ({ page }) => {
    await page.goto("/");

    // Look for capability badges
    await expect(page.getByText("Network").first()).toBeVisible();
  });
});

test.describe("Feed Interactions", () => {
  test("should like a post", async ({ page }) => {
    await page.goto("/");

    // Find and click like button on first post
    const likeButton = page.locator("button").filter({ hasText: /^\d+$/ }).first();
    const initialCount = await likeButton.textContent();

    await likeButton.click();

    // Should show increased count (optimistic update)
    const newCount = await likeButton.textContent();
    expect(parseInt(newCount || "0")).toBeGreaterThan(parseInt(initialCount || "0"));
  });

  test("should open share dialog", async ({ page }) => {
    await page.goto("/");

    // Click share button on first post
    await page.locator("button[aria-label*='share' i], button:has-text('Share')").first().click();

    // Share functionality should trigger (native share or clipboard)
  });

  test("should navigate to Studio on Remix click", async ({ page }) => {
    await page.goto("/");

    // Click Remix button
    await page.getByRole("button", { name: /Remix/i }).first().click();

    // Should navigate to Studio with remix params
    await expect(page).toHaveURL(/\/studio\?remixFrom=/);
  });
});
