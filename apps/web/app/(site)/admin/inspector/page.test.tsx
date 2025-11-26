import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ArtifactInspectorPage } from "./page";

const inspectArtifactMock = vi.fn(async () => {
  return new Response(
    JSON.stringify({
      artifact: {
        id: "art-1",
        ownerId: "u1",
        capsuleId: "cap-1",
        type: "react-jsx",
        runtimeVersion: "v0.1.0",
        status: "active",
        policyStatus: "active",
        visibility: "public",
        safetyTier: "default",
        riskScore: 0,
        createdAt: 1_700_000_000,
      },
      capsule: {
        id: "cap-1",
        ownerId: "u1",
        quarantined: false,
        quarantineReason: null,
        createdAt: 1_700_000_000,
        manifestSource: "db",
        manifest: {
          version: "1.0",
          runner: "client-static",
          entry: "index.html",
          params: [],
        },
      },
      runtimeManifest: {
        manifest: { artifactId: "art-1", bundle: { r2Key: "artifacts/art-1/bundle.js" } },
        version: 2,
        runtimeVersion: "v0.1.0",
        source: "db",
      },
      compile: {
        lastCompileResult: { artifactId: "art-1", outcome: "success" },
        lastCompileRequest: { artifactId: "art-1" },
      },
      events: [],
    }),
    { status: 200 }
  );
});

vi.mock("@/lib/api", () => ({
  adminApi: {
    inspectArtifact: inspectArtifactMock,
    inspectCapsule: vi.fn(),
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({
    user: { publicMetadata: { role: "admin" } },
    isSignedIn: true,
  }),
  useAuth: () => ({
    getToken: vi.fn(async () => "worker-token"),
  }),
}));

vi.mock("@/components/Player/PlayerIframe", () => ({
  PlayerIframe: React.forwardRef(() => <div data-testid="player-iframe" />),
}));

describe("ArtifactInspectorPage", () => {
  beforeEach(() => {
    inspectArtifactMock.mockClear();
  });

  it("fetches inspector data and renders manifests", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/artifacts/art-1"]}>
        <Routes>
          <Route path="/admin/artifacts/:artifactId" element={<ArtifactInspectorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(inspectArtifactMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Capsule manifest")).toBeInTheDocument());
    expect(screen.getByText("client-static")).toBeInTheDocument();
    expect(screen.getByTestId("player-iframe")).toBeInTheDocument();
  });
});
