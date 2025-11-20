import { manifestSchema, validateManifest, type Manifest, type ValidationResult } from "@vibecodr/shared/manifest";

const ERROR_PARSE = "E-VIBECODR-0204";
const ERROR_VALIDATE = "E-VIBECODR-0205";

export type ManifestValidationContext = {
  source: string;
  capsuleId?: string | null;
  postId?: string | null;
};

export type ManifestIssue = {
  path: string;
  message: string;
  code?: string;
};

export type ManifestParseOutcome = {
  manifest: Manifest | null;
  warnings?: ManifestIssue[];
  errors?: ManifestIssue[];
};

function logIssues(code: string, ctx: ManifestValidationContext, issues: ManifestIssue[]) {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error(`${code} manifest validation failed`, { ...ctx, issues });
  }
}

function normalizeValidationIssues(validation: ValidationResult): {
  errors?: ManifestIssue[];
  warnings?: ManifestIssue[];
} {
  return {
    errors: validation.errors?.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.errorCode ?? issue.code,
    })),
    warnings: validation.warnings?.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
}

export function safeParseCapsuleManifest(
  manifestJson: unknown,
  ctx: ManifestValidationContext
): ManifestParseOutcome {
  if (manifestJson === null || manifestJson === undefined) {
    return {
      manifest: null,
      errors: [{ path: "manifest", message: "Manifest payload missing" }],
    };
  }

  let raw: unknown = manifestJson;

  if (typeof manifestJson === "string") {
    const trimmed = manifestJson.trim();
    if (!trimmed) {
      return {
        manifest: null,
        errors: [{ path: "manifest", message: "Manifest JSON is empty" }],
      };
    }

    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logIssues(ERROR_PARSE, ctx, [{ path: "manifest", message }]);
      return {
        manifest: null,
        errors: [{ path: "manifest", message: "Invalid manifest JSON" }],
      };
    }
  }

  const validation = validateManifest(raw);
  const { errors, warnings } = normalizeValidationIssues(validation);

  if (!validation.valid) {
    if (errors && errors.length > 0) {
      logIssues(ERROR_VALIDATE, ctx, errors);
    }
    return { manifest: null, errors, warnings };
  }

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const zodIssues: ManifestIssue[] = parsed.error.errors.map((issue) => ({
      path: issue.path.join(".") || "manifest",
      message: issue.message,
      code: issue.code,
    }));
    logIssues(ERROR_VALIDATE, ctx, zodIssues);
    return { manifest: null, errors: zodIssues, warnings };
  }

  return { manifest: parsed.data, warnings };
}

export function requireCapsuleManifest(
  manifestJson: unknown,
  ctx: ManifestValidationContext
): Manifest {
  const result = safeParseCapsuleManifest(manifestJson, ctx);
  if (!result.manifest) {
    throw new Error(`${ERROR_VALIDATE} manifest unavailable for ${ctx.source}`);
  }
  return result.manifest;
}
