import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QuotaUsage } from "../QuotaUsage";

describe("QuotaUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should display loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // Never resolves

    render(<QuotaUsage />);

    expect(screen.getByText(/Loading your usage statistics/i)).toBeInTheDocument();
  });

  it("should display quota information when loaded", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "free",
        usage: {
          storage: 500 * 1024 * 1024, // 500 MB
          runs: 2500,
          bundleSize: 10 * 1024 * 1024,
        },
        limits: {
          maxStorage: 1024 * 1024 * 1024, // 1 GB
          maxRuns: 5000,
          maxBundleSize: 25 * 1024 * 1024,
        },
      }),
    });

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText("Usage & Quota")).toBeInTheDocument();
    });

    expect(screen.getByText("FREE")).toBeInTheDocument();
    expect(screen.getByText(/500\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5k/)).toBeInTheDocument();
  });

  it("should show warning when approaching storage limit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "free",
        usage: {
          storage: 800 * 1024 * 1024, // 800 MB (80%)
          runs: 1000,
          bundleSize: 10 * 1024 * 1024,
        },
        limits: {
          maxStorage: 1024 * 1024 * 1024,
          maxRuns: 5000,
          maxBundleSize: 25 * 1024 * 1024,
        },
      }),
    });

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText(/You've used 80% of your storage/i)).toBeInTheDocument();
    });
  });

  it("should show upgrade CTA when quota is high", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "free",
        usage: {
          storage: 950 * 1024 * 1024, // 950 MB (95%)
          runs: 4500, // 90%
          bundleSize: 10 * 1024 * 1024,
        },
        limits: {
          maxStorage: 1024 * 1024 * 1024,
          maxRuns: 5000,
          maxBundleSize: 25 * 1024 * 1024,
        },
      }),
    });

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText(/Running low on resources/i)).toBeInTheDocument();
      expect(screen.getByText(/Upgrade Plan/i)).toBeInTheDocument();
    });
  });

  it("should format bytes correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "pro",
        usage: {
          storage: 2.5 * 1024 * 1024 * 1024, // 2.5 GB
          runs: 50000,
          bundleSize: 50 * 1024 * 1024,
        },
        limits: {
          maxStorage: 50 * 1024 * 1024 * 1024,
          maxRuns: 250000,
          maxBundleSize: 100 * 1024 * 1024,
        },
      }),
    });

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText(/2\.5 GB/)).toBeInTheDocument();
    });
  });

  it("should display plan badge with correct styling", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "pro",
        usage: { storage: 0, runs: 0, bundleSize: 0 },
        limits: {
          maxStorage: 50 * 1024 * 1024 * 1024,
          maxRuns: 250000,
          maxBundleSize: 100 * 1024 * 1024,
        },
      }),
    });

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText("PRO")).toBeInTheDocument();
    });
  });

  it("should handle API errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<QuotaUsage />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load quota information/i)).toBeInTheDocument();
    });
  });
});
