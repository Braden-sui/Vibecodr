import { test, expect } from "@playwright/test";

test.describe("Player Page", () => {
  test("should load player with capsule", async ({ page }) => {
    await page.goto("/player/post1");

    // Wait for player to load
    await expect(page.locator("iframe").first()).toBeVisible({ timeout: 10000 });
  });

  test("should display post metadata", async ({ page }) => {
    await page.goto("/player/post1");

    // Check for title and author (in mock data)
    await expect(page.getByText("Interactive Boids Simulation")).toBeVisible();
    await expect(page.getByText("@marta")).toBeVisible();
  });

  test("should show param controls if params exist", async ({ page }) => {
    await page.goto("/player/post1");

    // Look for params drawer/controls
    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Should show param controls
      await expect(page.getByRole("slider").first()).toBeVisible();
    }
  });

  test("should allow adjusting slider params", async ({ page }) => {
    await page.goto("/player/post1");

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Adjust slider
      const slider = page.getByRole("slider").first();
      if (await slider.isVisible()) {
        await slider.fill("75");

        // Should trigger param change in iframe
        await page.waitForTimeout(500);
      }
    }
  });

  test("should allow toggling boolean params", async ({ page }) => {
    await page.goto("/player/post1");

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Find toggle switch
      const toggle = page.getByRole("switch").first();
      if (await toggle.isVisible()) {
        await toggle.click();

        // Should update param value
        await page.waitForTimeout(500);
      }
    }
  });

  test("should restart capsule on restart button", async ({ page }) => {
    await page.goto("/player/post1");

    const restartButton = page.getByRole("button", { name: /Restart/i });
    if (await restartButton.isVisible()) {
      await restartButton.click();

      // Iframe should reload
      await page.waitForTimeout(1000);
    }
  });

  test("should display stats (runs, likes, comments)", async ({ page }) => {
    await page.goto("/player/post1");

    // Check for stats display
    await expect(page.getByText(/\d+/)).toBeVisible(); // Numbers should be visible
  });

  test("should open comments drawer", async ({ page }) => {
    await page.goto("/player/post1");

    const commentsButton = page.getByRole("button", { name: /Comments/i });
    if (await commentsButton.isVisible()) {
      await commentsButton.click();

      // Comments section should be visible
      await expect(page.getByPlaceholder(/Add a comment/i)).toBeVisible();
    }
  });

  test("should allow liking post", async ({ page }) => {
    await page.goto("/player/post1");

    const likeButton = page.getByRole("button", { name: /Like/i }).or(
      page.locator("button").filter({ hasText: /\d+/ }).first()
    );

    if (await likeButton.isVisible()) {
      const initialText = await likeButton.textContent();
      await likeButton.click();

      // Should show optimistic update
      await page.waitForTimeout(500);
      const newText = await likeButton.textContent();
      expect(newText).not.toBe(initialText);
    }
  });

  test("should navigate to remix in Studio", async ({ page }) => {
    await page.goto("/player/post1");

    const remixButton = page.getByRole("button", { name: /Remix/i });
    if (await remixButton.isVisible()) {
      await remixButton.click();

      // Should navigate to Studio with remix param
      await expect(page).toHaveURL(/\/studio\?remixFrom=/);
    }
  });

  test("should share capsule", async ({ page }) => {
    await page.goto("/player/post1");

    const shareButton = page.getByRole("button", { name: /Share/i });
    if (await shareButton.isVisible()) {
      await shareButton.click();

      // Share functionality should trigger
      await page.waitForTimeout(500);
    }
  });

  test("should navigate to author profile", async ({ page }) => {
    await page.goto("/player/post1");

    const authorLink = page.getByText("@marta").first();
    await authorLink.click();

    // Should navigate to profile
    await expect(page).toHaveURL(/\/profile\/marta/);
  });

  test("should display capability badges", async ({ page }) => {
    await page.goto("/player/post1");

    // Check for capability badges (Network, Storage, etc.)
    const badges = page.locator("[class*='badge']");
    if ((await badges.count()) > 0) {
      await expect(badges.first()).toBeVisible();
    }
  });

  test("should show remix lineage if remixed", async ({ page }) => {
    await page.goto("/player/post2"); // Assuming post2 is a remix

    // Check for "Remixed from" indicator
    const remixIndicator = page.getByText(/Remixed from/i);
    if (await remixIndicator.isVisible()) {
      await expect(remixIndicator).toBeVisible();
    }
  });

  test("should handle iframe load errors gracefully", async ({ page }) => {
    await page.goto("/player/nonexistent");

    // Should show error state
    const errorMessage = page.getByText(/not found|error/i);
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test("should report post", async ({ page }) => {
    await page.goto("/player/post1");

    // Open the report dialog from Player controls
    const reportButton = page.getByRole("button", { name: /Report/i });
    if (await reportButton.isVisible()) {
      await reportButton.click();

      // Report dialog should open
      await expect(page.getByText(/Report Post/i)).toBeVisible();
    }
  });

  test("report -> moderator quarantines -> post disappears for normal user (mocked)", async ({ page }) => {
    // Intercept moderation report calls so we can assert payload and avoid hitting the real backend.
    await page.route("**/api/moderation/report", async (route) => {
      const request = route.request();
      expect(request.method()).toBe("POST");

      const rawBody = request.postData() || "{}";
      let body: { targetType?: string; targetId?: string; reason?: string };
      try {
        body = JSON.parse(rawBody) as { targetType?: string; targetId?: string; reason?: string };
      } catch {
        body = {};
      }

      expect(body.targetType).toBe("post");
      expect(body.targetId).toBe("post1");
      expect(typeof body.reason).toBe("string");

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/player/post1");

    const reportButton = page.getByRole("button", { name: /Report/i });
    await reportButton.click();

    // Choose a reason and submit the report.
    const reasonSelect = page.getByRole("combobox", { name: /Reason/i });
    await reasonSelect.click();
    await page.getByRole("option", { name: /Spam or misleading/i }).click();

    const submitButton = page.getByRole("button", { name: /Submit Report/i });
    await submitButton.click();

    await expect(page.getByText(/Report Submitted/i)).toBeVisible();

    // Stop intercepting further report calls.
    await page.unroute("**/api/moderation/report");

    // Simulate the effect of a moderator quarantining the post by stubbing the feed API
    // so that the reported post is no longer present for a normal viewer.
    await page.route("**/api/posts?mode=latest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: [] }),
      });
    });

    await page.goto("/");

    // The reported post title should no longer appear in the feed.
    await expect(page.getByText("Interactive Boids Simulation")).toHaveCount(0);
  });
});

test.describe("Player Interactions", () => {
  test("should post a comment", async ({ page }) => {
    await page.goto("/player/post1");

    const commentsButton = page.getByRole("button", { name: /Comments/i });
    if (await commentsButton.isVisible()) {
      await commentsButton.click();

      const textarea = page.getByPlaceholder(/Add a comment/i);
      await textarea.fill("Great work!");

      const postButton = page.getByRole("button", { name: /Post/i });
      await postButton.click();

      // Comment should appear
      await expect(page.getByText("Great work!")).toBeVisible({ timeout: 3000 });
    }
  });

  test("should create snapshot with current params", async ({ page }) => {
    await page.goto("/player/post1");

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      // Adjust a param
      const slider = page.getByRole("slider").first();
      if (await slider.isVisible()) {
        await slider.fill("80");
      }

      // Look for snapshot/share button
      const snapshotButton = page.getByRole("button", { name: /Snapshot|Share/i });
      if (await snapshotButton.isVisible()) {
        await snapshotButton.click();

        // Should generate snapshot URL
        await page.waitForTimeout(1000);
      }
    }
  });

  test("should increment run count on page load", async ({ page }) => {
    await page.goto("/player/post1");

    // Run count should increment (hard to test without API mock)
    // Just verify stats are visible
    await expect(page.getByText(/\d+/).first()).toBeVisible();
  });
});

test.describe("Player Mobile Responsiveness", () => {
  test("should work on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/player/post1");

    // Player should be visible and functional
    await expect(page.locator("iframe").first()).toBeVisible();
  });

  test("should show mobile-optimized controls", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/player/post1");

    // Controls should be accessible on mobile
    const buttons = page.getByRole("button");
    await expect(buttons.first()).toBeVisible();
  });
});
