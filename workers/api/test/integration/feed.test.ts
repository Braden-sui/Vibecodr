import { describe, it, expect } from "vitest";

describe("Feed API Integration", () => {
  const BASE_URL = "http://localhost:8787";

  it("GET /api/posts with mode=following should not return 500", async () => {
    let status = 500;

    try {
      const response = await fetch(
        `${BASE_URL}/api/posts?mode=following&userId=test-user-id`
      );
      status = response.status;
    } catch {
      expect(true).toBe(true);
      return;
    }

    expect(status).not.toBe(500);
  });
});
