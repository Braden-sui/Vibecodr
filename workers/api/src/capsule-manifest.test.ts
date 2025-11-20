import { describe, it, expect, vi, afterEach } from "vitest";
import { buildCapsuleSummary, requireCapsuleManifest, safeParseCapsuleManifest } from "./capsule-manifest";

const baseManifest = {
  version: "1.0",
  runner: "client-static" as const,
  entry: "index.html",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireCapsuleManifest", () => {
  it("returns manifest when safe parse succeeds", () => {
    const manifest = requireCapsuleManifest(JSON.stringify(baseManifest), {
      source: "test",
    });

    expect(manifest).toEqual(baseManifest);
  });

  it("throws with structured error when manifest missing", () => {
    expect(() =>
      requireCapsuleManifest("{}", {
        source: "test",
      })
    ).toThrowError(/E-VIBECODR-0203/);
  });
});

describe("safeParseCapsuleManifest", () => {
  it("returns parsed manifest when JSON string is valid", () => {
    const manifest = safeParseCapsuleManifest(JSON.stringify(baseManifest), {
      source: "test",
    });

    expect(manifest).toEqual(baseManifest);
  });

  it("swallows malformed JSON rows and logs parse error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const manifest = safeParseCapsuleManifest("{invalid", { source: "test" });

    expect(manifest).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("E-VIBECODR-0201"),
      expect.objectContaining({ source: "test" })
    );
  });

  it("rejects invalid manifest shapes without throwing", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const manifest = safeParseCapsuleManifest({ version: "1.0" }, { source: "test" });

    expect(manifest).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("E-VIBECODR-0202"),
      expect.objectContaining({ source: "test" })
    );
  });
});

describe("buildCapsuleSummary", () => {
  it("returns capsule summary with manifest details when valid", () => {
    const summary = buildCapsuleSummary("capsule-id", JSON.stringify(baseManifest), {
      source: "test",
    });

    expect(summary).toEqual({ id: "capsule-id", ...baseManifest });
  });

  it("returns minimal capsule summary when manifest cannot be parsed", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = buildCapsuleSummary("capsule-id", "{invalid", { source: "test" });

    expect(summary).toEqual({ id: "capsule-id" });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns null when capsule id is missing", () => {
    const summary = buildCapsuleSummary(null, JSON.stringify(baseManifest), {
      source: "test",
    });

    expect(summary).toBeNull();
  });
});
