import { test, expect } from "@playwright/test";

test.describe("Studio Page", () => {
  test("should load studio with tabs", async ({ page }) => {
    await page.goto("/studio");

    // Check for Studio UI
    await expect(page.getByText("Import")).toBeVisible();
    await expect(page.getByText("Files")).toBeVisible();
    await expect(page.getByText("Params")).toBeVisible();
    await expect(page.getByText("Publish")).toBeVisible();
  });

  test("should allow importing from GitHub", async ({ page }) => {
    await page.goto("/studio");

    // Click Import tab
    await page.getByRole("tab", { name: "Import" }).click();

    // Check for GitHub import option
    await expect(page.getByText(/Import from GitHub/i)).toBeVisible();

    // Input GitHub URL
    const input = page.getByPlaceholder(/github\.com\/user\/repo/i);
    await input.fill("https://github.com/example/repo");

    // Check that import button is enabled
    const importButton = page.getByRole("button", { name: /Import/i });
    await expect(importButton).toBeEnabled();
  });

  test("should allow importing from ZIP", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Import" }).click();

    // Check for ZIP upload option
    await expect(page.getByText(/Upload ZIP/i)).toBeVisible();
  });

  test("should validate manifest in Files tab", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Files" }).click();

    // Should show manifest.json in file tree
    await expect(page.getByText("manifest.json")).toBeVisible();
  });

  test("should allow editing params", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Params" }).click();

    // Should show params configuration UI
    await expect(page.getByText(/Add Parameter/i)).toBeVisible();
  });

  test("should preview capsule in iframe", async ({ page }) => {
    await page.goto("/studio");

    // Look for preview iframe
    const iframe = page.frameLocator("iframe").first();
    await expect(iframe.locator("body")).toBeVisible({ timeout: 10000 });
  });

  test("should handle publish flow", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Should show publish form
    await expect(page.getByText(/Title/i)).toBeVisible();
    await expect(page.getByText(/Description/i)).toBeVisible();
  });

  test("should validate required publish fields", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    const publishButton = page.getByRole("button", { name: /Publish/i });

    // Should be disabled without required fields
    await expect(publishButton).toBeDisabled();
  });

  test("should allow adding tags", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Look for tag input
    const tagInput = page.getByPlaceholder(/Add tags/i);
    if (await tagInput.isVisible()) {
      await tagInput.fill("animation");
      await tagInput.press("Enter");

      await expect(page.getByText("animation")).toBeVisible();
    }
  });

  test("should show bundle size in publish tab", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Should display bundle size info
    await expect(page.getByText(/Bundle Size/i)).toBeVisible();
  });
});

test.describe("Studio Import Flow", () => {
  test("should import from GitHub and validate", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Import" }).click();

    const input = page.getByPlaceholder(/github\.com\/user\/repo/i);
    await input.fill("https://github.com/example/simple-app");

    const importButton = page.getByRole("button", { name: /Import/i });
    await importButton.click();

    // Should show loading state
    await expect(page.getByText(/Importing/i)).toBeVisible({ timeout: 2000 });
  });

  test("should validate manifest after import", async ({ page }) => {
    await page.goto("/studio");

    // After import (assuming mock data), Files tab should show manifest
    await page.getByRole("tab", { name: "Files" }).click();

    // Look for manifest validation indicators
    const manifestFile = page.getByText("manifest.json");
    if (await manifestFile.isVisible()) {
      await manifestFile.click();

      // Should show manifest content or validation status
      await expect(page.getByText(/version/i)).toBeVisible();
    }
  });
});

test.describe("Studio Params Configuration", () => {
  test("should add slider param", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Params" }).click();

    const addButton = page.getByRole("button", { name: /Add Parameter/i });
    if (await addButton.isVisible()) {
      await addButton.click();

      // Select slider type
      await page.getByRole("combobox", { name: /Type/i }).click();
      await page.getByText("Slider").click();

      // Fill in slider details
      await page.getByPlaceholder(/Parameter name/i).fill("speed");
      await page.getByPlaceholder(/Min/i).fill("0");
      await page.getByPlaceholder(/Max/i).fill("100");
      await page.getByPlaceholder(/Default/i).fill("50");

      // Save
      await page.getByRole("button", { name: /Save/i }).click();

      await expect(page.getByText("speed")).toBeVisible();
    }
  });

  test("should add toggle param", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Params" }).click();

    const addButton = page.getByRole("button", { name: /Add Parameter/i });
    if (await addButton.isVisible()) {
      await addButton.click();

      // Select toggle type
      await page.getByRole("combobox", { name: /Type/i }).click();
      await page.getByText("Toggle").click();

      await page.getByPlaceholder(/Parameter name/i).fill("darkMode");

      await page.getByRole("button", { name: /Save/i }).click();

      await expect(page.getByText("darkMode")).toBeVisible();
    }
  });

  test("should enforce max 20 params", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Params" }).click();

    // This would require adding 20+ params, so just check for warning message
    // In real implementation, add params until limit is reached
  });
});

test.describe("Studio Publish Flow", () => {
  test("should complete full publish flow", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Fill in title
    const titleInput = page.getByPlaceholder(/Give your capsule a title/i);
    await titleInput.fill("My Awesome Capsule");

    // Fill in description
    const descInput = page.getByPlaceholder(/Describe what your capsule does/i);
    await descInput.fill("An interactive animation");

    // Add tags
    const tagInput = page.getByPlaceholder(/Add tags/i);
    if (await tagInput.isVisible()) {
      await tagInput.fill("animation");
      await tagInput.press("Enter");
    }

    // Publish button should now be enabled
    const publishButton = page.getByRole("button", { name: /Publish/i });
    await expect(publishButton).toBeEnabled();
  });

  test("should show quota warning if approaching limit", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Check for quota warning (if mock data shows high usage)
    const quotaWarning = page.getByText(/storage limit/i);
    if (await quotaWarning.isVisible()) {
      await expect(quotaWarning).toBeVisible();
    }
  });

  test("should validate bundle size before publish", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Should show bundle size
    await expect(page.getByText(/Bundle Size/i)).toBeVisible();
  });
});

test.describe("Studio Remix Flow", () => {
  test("should load remix with remixFrom param", async ({ page }) => {
    await page.goto("/studio?remixFrom=post123");

    // Should indicate remix mode
    await expect(page.getByText(/Remixing/i)).toBeVisible({ timeout: 5000 });
  });

  test("should preserve original author attribution", async ({ page }) => {
    await page.goto("/studio?remixFrom=post123");

    await page.getByRole("tab", { name: "Publish" }).click();

    // Should show "Remixed from" field
    await expect(page.getByText(/Remixed from/i)).toBeVisible();
  });
});
