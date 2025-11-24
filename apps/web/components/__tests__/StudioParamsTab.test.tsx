import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { ParamsTab } from "../Studio/ParamsTab";
import type { CapsuleDraft } from "../Studio/StudioShell";

const updateManifestMock = vi.fn();
const compileDraftMock = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

vi.mock("@/lib/api", () => ({
  capsulesApi: {
    updateManifest: (...args: unknown[]) => updateManifestMock(...args),
    compileDraft: (...args: unknown[]) => compileDraftMock(...args),
  },
}));

describe("ParamsTab", () => {
  const baseDraft: CapsuleDraft = {
    id: "draft-1",
    capsuleId: "cap-123",
    manifest: {
      version: "1.0",
      runner: "client-static",
      entry: "index.html",
      params: [
        {
          name: "count",
          type: "slider",
          label: "Count",
          default: 5,
          min: 0,
          max: 10,
          step: 1,
        },
      ],
    },
    validationStatus: "valid",
    buildStatus: "idle",
    artifact: null,
  };

  beforeEach(() => {
    updateManifestMock.mockReset();
    compileDraftMock.mockReset();
  });

  it("patches manifest params and compiles draft", async () => {
    updateManifestMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ warnings: [] }),
    });
    compileDraftMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifactId: "art-1",
        bundleDigest: "digest",
        bundleSizeBytes: 128,
        runtimeVersion: "v0.1.0",
      }),
    });

    const Wrapper = () => {
      const [draft, setDraft] = useState<CapsuleDraft | undefined>(baseDraft);
      return <ParamsTab draft={draft} onDraftChange={setDraft} />;
    };

    const { container } = render(<Wrapper />);
    const saveButton = screen.getByRole("button", { name: /save & compile/i });

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(updateManifestMock).toHaveBeenCalledTimes(1);
      expect(compileDraftMock).toHaveBeenCalledTimes(1);
    });

    const [capsuleId, manifestPayload] = updateManifestMock.mock.calls[0] as any[];
    expect(capsuleId).toBe("cap-123");
    expect(manifestPayload.params[0]).toMatchObject({
      name: "count",
      type: "slider",
      min: 0,
      max: 10,
    });

    expect(container.textContent).toContain("Params saved");
  });

  it("blocks save when params fail schema validation", async () => {
    updateManifestMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    compileDraftMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const invalidDraft: CapsuleDraft = {
      ...baseDraft,
      manifest: {
        ...baseDraft.manifest!,
        params: [
          {
            name: "bad",
            type: "slider",
            label: "Bad",
            default: 5,
            // missing min/max
          } as any,
        ],
      },
    };

    const Wrapper = () => {
      const [draft, setDraft] = useState<CapsuleDraft | undefined>(invalidDraft);
      return <ParamsTab draft={draft} onDraftChange={setDraft} />;
    };

    render(<Wrapper />);
    const saveButton = screen.getByRole("button", { name: /save & compile/i });

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Fix these before saving/i)).toBeInTheDocument();
    });
    expect(updateManifestMock).not.toHaveBeenCalled();
    expect(compileDraftMock).not.toHaveBeenCalled();
  });
});
