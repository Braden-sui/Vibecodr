"use client";

import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ManifestErrorActions } from "../Studio/ManifestErrorActions";

describe("ManifestErrorActions", () => {
  it("renders top 3 issues and shows remaining count", () => {
    const errors = [
      { path: "entry", message: "Entry file app.tsx does not exist in the bundle." },
      { path: "params.intensity", message: "Param intensity must have min <= default <= max." },
      { path: "params.color", message: "Default value is not in options list" },
      { path: "capabilities.net", message: "Network access is currently disabled." },
    ];

    render(<ManifestErrorActions errors={errors} message="Test manifest issues" />);

    expect(screen.getByText(/test manifest issues/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/\+1 more issues listed below/i)).toBeInTheDocument();
  });

  it("invokes actions when buttons are clicked", () => {
    const errors = [{ path: "entry", message: "Missing entry file" }];
    const onDownloadManifest = vi.fn();
    const onOpenEditor = vi.fn();
    const onResetManifest = vi.fn();

    render(
      <ManifestErrorActions
        errors={errors}
        onDownloadManifest={onDownloadManifest}
        onOpenEditor={onOpenEditor}
        onResetManifest={onResetManifest}
        canDownload
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /download manifest\.json/i }));
    fireEvent.click(screen.getByRole("button", { name: /open in studio to edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset to default manifest/i }));

    expect(onDownloadManifest).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(onResetManifest).toHaveBeenCalledTimes(1);
  });
});
