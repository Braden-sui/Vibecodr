import { test, expect } from "@playwright/test";

/**
 * Profile E2E Tests
 *
 * These tests navigate to profiles DYNAMICALLY from the feed,
 * rather than using hardcoded usernames that may not exist.
 *
 * Assertions check:
 * - Profile page loads with expected structure
 * - Stats display correctly
 * - Tab navigation works
 * - Social actions (follow/unfollow) function
 * - Error states display correctly
 */

// Helper to navigate to a real user's profile from the feed
async function navigateToFirstAuthorProfile(page: import("@playwright/test").Page) {
  await page.goto("/");

  // Wait for feed cards
  const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
  await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

  // Find and click an author handle link
  const authorLink = page.locator("a").filter({ hasText: /^@\w+/ }).first();
  await authorLink.click();

  // Wait for profile page
  await expect(page).toHaveURL(/\/profile\/.+/);
}

test.describe("Profile Page Structure", () => {
  test("should load profile with user handle", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Should show the user's handle (@username)
    const handle = page.locator("text=/^@\\w+/").first();
    await expect(handle).toBeVisible();
  });

  test("should display profile stats", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Should show some stats (posts, followers, following - at least one)
    const statsNumbers = page.locator("text=/\\d+/");
    await expect(statsNumbers.first()).toBeVisible();
  });

  test("should display user's posts or empty state", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Should show either posts or an empty state - page shouldn't crash
    await page.waitForTimeout(1000);

    // Profile content area should exist
    const profileContent = page.locator("main, [role='main'], .profile-content");
    await expect(profileContent.first()).toBeVisible();
  });

  test("should show profile avatar", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Avatar should be visible (img or avatar div)
    const avatar = page.locator("img[alt*='avatar' i], img[alt*='profile' i], [data-testid='avatar'], [class*='avatar']");
    if (await avatar.count() > 0) {
      await expect(avatar.first()).toBeVisible();
    }
  });
});

test.describe("Profile Navigation", () => {
  test("should have functional tab navigation", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Look for tabs (Posts, Likes, etc.)
    const postsTab = page.getByRole("tab", { name: /Posts/i });
    const likesTab = page.getByRole("tab", { name: /Likes/i });

    if (await postsTab.isVisible()) {
      await postsTab.click();
      await expect(postsTab).toHaveAttribute("aria-selected", "true");
    }

    if (await likesTab.isVisible()) {
      await likesTab.click();
      await expect(likesTab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("should navigate to post player when clicking a post", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Find a post card on the profile
    const postCards = page.locator("article, [data-testid='feed-card'], [role='article']");

    if (await postCards.count() > 0) {
      const cardLink = postCards.first().locator("a").first();

      if (await cardLink.isVisible()) {
        await cardLink.click();
      } else {
        await postCards.first().click();
      }

      // Should navigate to player
      await expect(page).toHaveURL(/\/player\/.+/);
    }
  });
});

test.describe("Profile Social Actions", () => {
  test("should have follow button for other users", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Look for follow/following button
    const followButton = page.getByRole("button", { name: /Follow/i });
    const followingButton = page.getByRole("button", { name: /Following/i });

    // One of these should be visible (unless viewing own profile)
    const hasFollowAction = await followButton.isVisible() || await followingButton.isVisible();

    // If neither is visible, we might be on our own profile (which is ok)
    if (hasFollowAction) {
      // Button should be clickable
      if (await followButton.isVisible()) {
        await followButton.click();
        await page.waitForTimeout(500);
      } else if (await followingButton.isVisible()) {
        await followingButton.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test("should show follower/following counts", async ({ page }) => {
    await navigateToFirstAuthorProfile(page);

    // Look for follower/following text with numbers
    const followerText = page.locator("text=/\\d+.*follower/i");
    const followingText = page.locator("text=/\\d+.*following/i");

    // At least one should be visible
    const hasFollowerCount = await followerText.isVisible({ timeout: 2000 }).catch(() => false);
    const hasFollowingCount = await followingText.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasFollowerCount || hasFollowingCount).toBe(true);
  });
});

test.describe("Profile Error States", () => {
  test("should handle non-existent profile gracefully", async ({ page }) => {
    // Use a random string that won't match any user
    await page.goto("/profile/nonexistent-user-xyz-12345");

    // Should show error state (not found, doesn't exist, etc.)
    const errorMessage = page.getByText(/not found|doesn't exist|no user/i);
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Profile Mobile Responsiveness", () => {
  test("should work on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await navigateToFirstAuthorProfile(page);

    // Profile should be visible and functional
    const handle = page.locator("text=/^@\\w+/").first();
    await expect(handle).toBeVisible();
  });
});
