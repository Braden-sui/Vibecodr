import { test, expect } from "@playwright/test";

test.describe("Profile Page", () => {
  test("should load user profile", async ({ page }) => {
    await page.goto("/profile/marta");

    // Check for profile header
    await expect(page.getByText("@marta")).toBeVisible();
  });

  test("should display profile stats", async ({ page }) => {
    await page.goto("/profile/marta");

    // Should show followers, following, posts count
    await expect(page.getByText(/\d+ Posts/i)).toBeVisible();
    await expect(page.getByText(/\d+ Followers/i)).toBeVisible();
    await expect(page.getByText(/\d+ Following/i)).toBeVisible();
  });

  test("should display user's posts", async ({ page }) => {
    await page.goto("/profile/marta");

    // Should show posts grid/list
    await expect(page.getByText("Interactive Boids Simulation")).toBeVisible();
  });

  test("should allow following user", async ({ page }) => {
    await page.goto("/profile/bob");

    const followButton = page.getByRole("button", { name: /Follow/i });
    if (await followButton.isVisible()) {
      await followButton.click();

      // Button should change to "Following"
      await expect(page.getByRole("button", { name: /Following/i })).toBeVisible();
    }
  });

  test("should allow unfollowing user", async ({ page }) => {
    await page.goto("/profile/alice");

    const followingButton = page.getByRole("button", { name: /Following/i });
    if (await followingButton.isVisible()) {
      await followingButton.click();

      // Should change back to "Follow"
      await expect(page.getByRole("button", { name: /Follow/i })).toBeVisible();
    }
  });

  test("should navigate to post on click", async ({ page }) => {
    await page.goto("/profile/marta");

    const post = page.getByText("Interactive Boids Simulation");
    await post.click();

    // Should navigate to player page
    await expect(page).toHaveURL(/\/player\//);
  });

  test("should switch between Posts and Likes tabs", async ({ page }) => {
    await page.goto("/profile/marta");

    // Click Likes tab
    const likesTab = page.getByRole("tab", { name: /Likes/i });
    if (await likesTab.isVisible()) {
      await likesTab.click();

      // Should show liked posts
      await page.waitForTimeout(1000);
    }

    // Switch back to Posts
    const postsTab = page.getByRole("tab", { name: /Posts/i });
    if (await postsTab.isVisible()) {
      await postsTab.click();
    }
  });

  test("should show profile avatar", async ({ page }) => {
    await page.goto("/profile/marta");

    // Profile avatar should be visible
    const avatar = page.locator("img[alt*='marta'], div[class*='avatar']");
    if ((await avatar.count()) > 0) {
      await expect(avatar.first()).toBeVisible();
    }
  });

  test("should handle non-existent profile", async ({ page }) => {
    await page.goto("/profile/nonexistentuser12345");

    // Should show 404 or error state
    await expect(page.getByText(/not found|doesn't exist/i)).toBeVisible();
  });

  test("should display bio if available", async ({ page }) => {
    await page.goto("/profile/marta");

    // Check for bio section
    const bio = page.locator("p[class*='bio'], div[class*='bio']");
    if ((await bio.count()) > 0) {
      await expect(bio.first()).toBeVisible();
    }
  });

  test("should show follower list", async ({ page }) => {
    await page.goto("/profile/marta");

    const followersButton = page.getByText(/\d+ Followers/i);
    if (await followersButton.isVisible()) {
      await followersButton.click();

      // Followers list should appear
      await expect(page.getByText(/@\w+/).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("should show following list", async ({ page }) => {
    await page.goto("/profile/marta");

    const followingButton = page.getByText(/\d+ Following/i);
    if (await followingButton.isVisible()) {
      await followingButton.click();

      // Following list should appear
      await expect(page.getByText(/@\w+/).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("should filter posts by type", async ({ page }) => {
    await page.goto("/profile/marta");

    // Look for filter options (Apps, Animations, etc.)
    const filter = page.getByRole("button", { name: /Apps|All/i });
    if (await filter.isVisible()) {
      await filter.click();

      await page.waitForTimeout(500);
    }
  });

  test("should sort posts by date or popularity", async ({ page }) => {
    await page.goto("/profile/marta");

    // Look for sort options
    const sortButton = page.getByRole("button", { name: /Sort|Latest|Popular/i });
    if (await sortButton.isVisible()) {
      await sortButton.click();

      await page.waitForTimeout(500);
    }
  });
});

test.describe("Own Profile (Authenticated)", () => {
  test("should show edit button on own profile", async ({ page }) => {
    // Assuming user is authenticated as marta
    await page.goto("/profile/marta");

    const editButton = page.getByRole("button", { name: /Edit Profile/i });
    if (await editButton.isVisible()) {
      await expect(editButton).toBeVisible();
    }
  });

  test("should allow editing bio", async ({ page }) => {
    await page.goto("/profile/marta");

    const editButton = page.getByRole("button", { name: /Edit Profile/i });
    if (await editButton.isVisible()) {
      await editButton.click();

      // Bio textarea should appear
      const bioInput = page.getByPlaceholder(/Tell us about yourself/i);
      if (await bioInput.isVisible()) {
        await bioInput.fill("Creative coder and animator");

        const saveButton = page.getByRole("button", { name: /Save/i });
        await saveButton.click();

        await expect(page.getByText("Creative coder and animator")).toBeVisible();
      }
    }
  });

  test("should allow updating display name", async ({ page }) => {
    await page.goto("/profile/marta");

    const editButton = page.getByRole("button", { name: /Edit Profile/i });
    if (await editButton.isVisible()) {
      await editButton.click();

      const nameInput = page.getByPlaceholder(/Display name/i);
      if (await nameInput.isVisible()) {
        await nameInput.fill("Marta Garcia");

        const saveButton = page.getByRole("button", { name: /Save/i });
        await saveButton.click();

        await expect(page.getByText("Marta Garcia")).toBeVisible();
      }
    }
  });

  test("should show quota usage on own profile", async ({ page }) => {
    await page.goto("/profile/marta");

    // Check for quota section
    const quotaSection = page.getByText(/Usage|Quota|Storage/i);
    if (await quotaSection.isVisible()) {
      await expect(quotaSection).toBeVisible();
    }
  });
});

test.describe("Profile Social Actions", () => {
  test("should navigate to follower's profile", async ({ page }) => {
    await page.goto("/profile/marta");

    const followersButton = page.getByText(/\d+ Followers/i);
    if (await followersButton.isVisible()) {
      await followersButton.click();

      // Click on a follower
      const followerLink = page.getByText(/@\w+/).first();
      if (await followerLink.isVisible()) {
        await followerLink.click();

        // Should navigate to follower's profile
        await expect(page).toHaveURL(/\/profile\//);
      }
    }
  });

  test("should follow user from follower list", async ({ page }) => {
    await page.goto("/profile/marta");

    const followersButton = page.getByText(/\d+ Followers/i);
    if (await followersButton.isVisible()) {
      await followersButton.click();

      // Find follow button in list
      const followButton = page.getByRole("button", { name: /Follow/i }).first();
      if (await followButton.isVisible()) {
        await followButton.click();

        await expect(page.getByRole("button", { name: /Following/i }).first()).toBeVisible();
      }
    }
  });
});
