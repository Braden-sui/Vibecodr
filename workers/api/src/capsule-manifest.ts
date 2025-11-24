import { manifestSchema, type Manifest } from "@vibecodr/shared";

const ERROR_PARSE = "E-VIBECODR-0201";
const ERROR_VALIDATE = "E-VIBECODR-0202";
const ERROR_REQUIRED = "E-VIBECODR-0203";

export type ManifestParseContext = {
  source: string;
  capsuleId?: string | null;
  postId?: string | null;
};

export type CapsuleSummary = ({ id: string; artifactId?: string; bundleKey?: string; contentHash?: string } & Partial<Manifest>) | null;

export function safeParseCapsuleManifest(
  manifestJson: unknown,
  ctx: ManifestParseContext
): Manifest | null {
  if (manifestJson === null || manifestJson === undefined) {
    return null;
  }

  let raw: unknown = manifestJson;

  if (typeof manifestJson === "string") {
    const trimmed = manifestJson.trim();
    if (!trimmed) {
      return null;
    }

    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      console.error(`${ERROR_PARSE} manifest JSON parse failed`, {
        ...ctx,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  const validation = manifestSchema.safeParse(raw);
  if (!validation.success) {
    console.error(`${ERROR_VALIDATE} manifest validation failed`, {
      ...ctx,
      issues: validation.error.errors.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return null;
  }

  return validation.data;
}

export function requireCapsuleManifest(
  manifestJson: unknown,
  ctx: ManifestParseContext
): Manifest {
  const manifest = safeParseCapsuleManifest(manifestJson, ctx);
  if (!manifest) {
    throw new Error(`${ERROR_REQUIRED} manifest unavailable for ${ctx.source}`);
  }
  return manifest;
}

export function buildCapsuleSummary(
  capsuleId: unknown,
  manifestJson: unknown,
  ctx: ManifestParseContext
): CapsuleSummary {
  if (typeof capsuleId !== "string" || capsuleId.length === 0) {
    return null;
  }

  const manifest = safeParseCapsuleManifest(manifestJson, { ...ctx, capsuleId });
  if (!manifest) {
    return { id: capsuleId };
  }

  return { id: capsuleId, ...manifest };
}
