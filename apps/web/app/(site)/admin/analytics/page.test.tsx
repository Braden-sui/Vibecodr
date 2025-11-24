import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminAnalyticsPage from "./page";

const mockWorkerUrl = vi.fn((path: string) => `https://worker.test${path}`);
const mockGetToken = vi.fn(async () => "worker-token");

vi.mock("@/lib/api", () => ({
  workerUrl: (path: string) => mockWorkerUrl(path),
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({
    user: { publicMetadata: { role: "admin" } },
    isSignedIn: true,
  }),
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

describe("AdminAnalyticsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    (global as any).fetch = fetchMock;
    mockWorkerUrl.mockClear();
    mockGetToken.mockClear();
  });

  it("renders a safe fallback when health metrics are missing", async () => {
    const payloadWithoutHealth = {
      snapshotTime: Date.now(),
      summary: [],
      recent: [],
      errorsLastDay: [],
      capsuleErrorRates: [],
      capsuleRunVolumes: [],
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payloadWithoutHealth,
    });

    render(
      <MemoryRouter>
        <AdminAnalyticsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockWorkerUrl).toHaveBeenCalledWith("/runtime-analytics/summary"));
    await waitFor(() => expect(screen.getByText("Health data unavailable")).toBeInTheDocument());
  });
});
