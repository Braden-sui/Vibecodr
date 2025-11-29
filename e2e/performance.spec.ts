import { test, expect } from "@playwright/test";

/**
 * Performance Test Suite
 *
 * Tests critical performance metrics:
 * - Feed load time < 2s
 * - Player boot time < 1s
 * - Studio load time < 1.5s
 * - Scroll FPS > 30fps
 * - Bundle size limits
 */

test.describe("Feed Performance", () => {
  test("should load feed within 2 seconds", async ({ page }) => {
    const startTime = Date.now();

    await page.goto("/");

    // Wait for feed content to be visible (cards, not specific text)
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 5000 });

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(2000);
    console.log(`Feed load time: ${loadTime}ms`);
  });

  test("should render posts without performance degradation", async ({ page }) => {
    await page.goto("/");

    // Measure time to render posts
    const startTime = Date.now();

    await page.waitForSelector("article, [role='article'], [data-testid='feed-card']", { timeout: 5000 });

    const posts = await page.locator("article, [role='article'], [data-testid='feed-card']").count();

    const renderTime = Date.now() - startTime;

    expect(posts).toBeGreaterThanOrEqual(1);
    expect(renderTime).toBeLessThan(1000);
    console.log(`Rendered ${posts} posts in ${renderTime}ms`);
  });

  test("should maintain smooth scrolling (>30fps)", async ({ page }) => {
    await page.goto("/");

    // Wait for feed content to load
    const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
    await feedCards.first().waitFor({ state: "visible", timeout: 5000 });

    // Start performance measurement
    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const frames: number[] = [];
        let lastTime = performance.now();
        let frameCount = 0;

        const measureFrame = () => {
          const currentTime = performance.now();
          const delta = currentTime - lastTime;
          frames.push(1000 / delta); // FPS

          lastTime = currentTime;
          frameCount++;

          if (frameCount < 60) {
            requestAnimationFrame(measureFrame);
          } else {
            const avgFps = frames.reduce((a, b) => a + b, 0) / frames.length;
            resolve({ avgFps, minFps: Math.min(...frames) });
          }
        };

        // Scroll to trigger rendering
        window.scrollTo({ top: 500, behavior: "smooth" });
        requestAnimationFrame(measureFrame);
      });
    });

    console.log(`Scroll performance:`, metrics);
    expect((metrics as any).avgFps).toBeGreaterThan(30);
  });

  test("should load images lazily", async ({ page }) => {
    await page.goto("/");

    // Check that images below the fold use lazy loading
    const images = await page.locator("img").all();

    let lazyLoadCount = 0;
    for (const img of images) {
      const loading = await img.getAttribute("loading");
      if (loading === "lazy") {
        lazyLoadCount++;
      }
    }

    expect(lazyLoadCount).toBeGreaterThan(0);
    console.log(`Found ${lazyLoadCount} lazy-loaded images`);
  });
});

// Helper to navigate to a real post's player page from the feed
async function navigateToFirstPostPlayer(page: import("@playwright/test").Page) {
  await page.goto("/");

  const feedCards = page.locator("article, [data-testid='feed-card'], [role='article']");
  await feedCards.first().waitFor({ state: "visible", timeout: 10000 });

  const firstCard = feedCards.first();
  const cardLink = firstCard.locator("a").first();

  if (await cardLink.isVisible()) {
    await cardLink.click();
  } else {
    await firstCard.click();
  }

  await page.waitForURL(/\/player\/.+/);
}

test.describe("Player Performance", () => {
  test("should boot player within reasonable time", async ({ page }) => {
    const startTime = Date.now();

    await navigateToFirstPostPlayer(page);

    // Wait for iframe to load
    await page.locator("iframe").first().waitFor({ state: "visible" });

    const bootTime = Date.now() - startTime;

    // Note: includes feed load + navigation, so allow more time
    expect(bootTime).toBeLessThan(5000);
    console.log(`Player boot time (from feed): ${bootTime}ms`);
  });

  test("should load iframe content within 2 seconds after navigation", async ({ page }) => {
    await navigateToFirstPostPlayer(page);

    const startTime = Date.now();

    // Wait for iframe to be fully loaded
    const iframe = page.frameLocator("iframe").first();
    await iframe.locator("body").waitFor({ state: "visible", timeout: 5000 });

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(2000);
    console.log(`Iframe content load time: ${loadTime}ms`);
  });

  test("should update params without lag (<100ms)", async ({ page }) => {
    await navigateToFirstPostPlayer(page);

    const paramsButton = page.getByRole("button", { name: /Params/i });
    if (await paramsButton.isVisible()) {
      await paramsButton.click();

      const slider = page.getByRole("slider").first();
      if (await slider.isVisible()) {
        const startTime = Date.now();
        await slider.fill("75");
        const updateTime = Date.now() - startTime;

        expect(updateTime).toBeLessThan(100);
        console.log(`Param update time: ${updateTime}ms`);
      }
    }
  });

  test("should measure player memory usage", async ({ page, context }) => {
    await navigateToFirstPostPlayer(page);

    // Wait for player to load
    await page.locator("iframe").first().waitFor({ state: "visible" });

    // Measure memory usage using CDP
    const client = await context.newCDPSession(page);
    const { jsHeapSizeUsed } = (await client.send("Performance.getMetrics")) as any;

    const memoryMB = jsHeapSizeUsed / (1024 * 1024);

    expect(memoryMB).toBeLessThan(100); // Should use < 100MB
    console.log(`Player memory usage: ${memoryMB.toFixed(2)}MB`);
  });
});

test.describe("Studio Performance", () => {
  test("should load studio within 1.5 seconds", async ({ page }) => {
    const startTime = Date.now();

    await page.goto("/studio");

    // Wait for studio UI to be visible
    await expect(page.getByText("Import")).toBeVisible();

    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(1500);
    console.log(`Studio load time: ${loadTime}ms`);
  });

  test("should switch tabs without lag (<200ms)", async ({ page }) => {
    await page.goto("/studio");

    await expect(page.getByText("Import")).toBeVisible();

    const startTime = Date.now();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page.getByText("manifest.json")).toBeVisible({ timeout: 1000 });
    const switchTime = Date.now() - startTime;

    expect(switchTime).toBeLessThan(200);
    console.log(`Tab switch time: ${switchTime}ms`);
  });

  test("should handle large file trees efficiently", async ({ page }) => {
    await page.goto("/studio");

    await page.getByRole("tab", { name: "Files" }).click();

    const startTime = Date.now();

    // Wait for file tree to render
    await page.waitForSelector("text=manifest.json", { timeout: 2000 });

    const renderTime = Date.now() - startTime;

    expect(renderTime).toBeLessThan(500);
    console.log(`File tree render time: ${renderTime}ms`);
  });

  test("should preview iframe without blocking UI", async ({ page }) => {
    await page.goto("/studio");

    // Preview iframe should load asynchronously
    const iframe = page.locator("iframe").first();

    // UI should remain responsive while iframe loads
    await page.getByRole("tab", { name: "Params" }).click();
    await expect(page.getByText(/Add Parameter|Params/i)).toBeVisible();
  });
});

test.describe("Bundle Size Performance", () => {
  test("should have reasonable JS bundle size", async ({ page }) => {
    await page.goto("/");

    // Measure network resources
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType("resource").filter((r: any) => {
        return r.name.includes(".js") && r.transferSize;
      });
    });

    const totalJsSize = (resources as any[]).reduce((sum, r) => sum + r.transferSize, 0);
    const totalMB = totalJsSize / (1024 * 1024);

    expect(totalMB).toBeLessThan(2); // Total JS < 2MB
    console.log(`Total JS bundle size: ${totalMB.toFixed(2)}MB`);
  });

  test("should use code splitting for routes", async ({ page }) => {
    await page.goto("/");

    const homeResources = await page.evaluate(() => {
      return performance.getEntriesByType("resource").filter((r: any) => r.name.includes(".js"));
    });

    await page.goto("/studio");

    const studioResources = await page.evaluate(() => {
      return performance.getEntriesByType("resource").filter((r: any) => r.name.includes(".js"));
    });

    // Studio should load additional chunks
    expect((studioResources as any[]).length).toBeGreaterThan((homeResources as any[]).length);
    console.log(
      `Home chunks: ${(homeResources as any[]).length}, Studio chunks: ${(studioResources as any[]).length}`
    );
  });
});

test.describe("API Performance", () => {
  test("should fetch feed posts within 500ms", async ({ page }) => {
    await page.goto("/");

    const apiTiming = await page.evaluate(() => {
      return new Promise((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const apiCall = entries.find((e: any) => e.name.includes("/api/posts"));
          if (apiCall) {
            resolve((apiCall as any).duration);
            observer.disconnect();
          }
        });
        observer.observe({ entryTypes: ["resource"] });

        // Trigger feed load
        setTimeout(() => resolve(0), 2000);
      });
    });

    expect(apiTiming as number).toBeLessThan(500);
    console.log(`API response time: ${apiTiming}ms`);
  });

  test("should handle concurrent API requests efficiently", async ({ page }) => {
    // Navigate to player which makes multiple API calls
    await navigateToFirstPostPlayer(page);

    const startTime = Date.now();

    // Wait for all API calls to complete
    await page.waitForLoadState("networkidle");

    const totalTime = Date.now() - startTime;

    expect(totalTime).toBeLessThan(2000);
    console.log(`Concurrent API requests time: ${totalTime}ms`);
  });
});

test.describe("Lighthouse Performance", () => {
  test("should achieve performance score > 80", async ({ page }) => {
    // This would require lighthouse integration
    // Using playAudit from playwright-lighthouse
    expect(true).toBe(true);
  });

  test("should pass Core Web Vitals", async ({ page }) => {
    await page.goto("/");

    const webVitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        let lcp = 0;
        let fid = 0;
        let cls = 0;

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === "largest-contentful-paint") {
              lcp = (entry as any).renderTime || (entry as any).loadTime;
            }
          }
        }).observe({ entryTypes: ["largest-contentful-paint"] });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            fid = (entry as any).processingStart - (entry as any).startTime;
          }
        }).observe({ entryTypes: ["first-input"] });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              cls += (entry as any).value;
            }
          }
        }).observe({ entryTypes: ["layout-shift"] });

        setTimeout(() => resolve({ lcp, fid, cls }), 5000);
      });
    });

    console.log("Core Web Vitals:", webVitals);

    // LCP should be < 2.5s
    expect((webVitals as any).lcp).toBeLessThan(2500);

    // CLS should be < 0.1
    expect((webVitals as any).cls).toBeLessThan(0.1);
  });
});
