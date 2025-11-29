import { z } from "zod";
import { manifestSchema } from "../manifest";
export * from "./quotas";

export const postTypes = ["thought", "image", "link", "app", "longform"] as const;
export const PostTypeSchema = z.enum(postTypes);
export type PostType = z.infer<typeof PostTypeSchema>;

export const ApiAuthorProfileSchema = z.object({
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
});

export const ApiAuthorSummarySchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  followersCount: z.number(),
  runsCount: z.number(),
  remixesCount: z.number(),
  isFeatured: z.boolean(),
  plan: z.string().optional(),
  profile: ApiAuthorProfileSchema.optional(),
});

export const ApiPostStatsSchema = z.object({
  runs: z.number(),
  comments: z.number(),
  likes: z.number(),
  remixes: z.number(),
});

export const ApiFeedViewerStateSchema = z.object({
  liked: z.boolean().optional(),
  followingAuthor: z.boolean().optional(),
});

export const ApiCapsuleSummarySchema = z
  .object({
    id: z.string(),
  })
  .catchall(z.unknown());

export const ApiFeedPostSchema = z.object({
  id: z.string(),
  type: PostTypeSchema,
  title: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()),
  author: ApiAuthorSummarySchema,
  capsule: ApiCapsuleSummarySchema.nullable(),
  coverKey: z.string().nullable().optional(),
  createdAt: z.union([z.number(), z.string()]),
  stats: ApiPostStatsSchema,
  viewer: ApiFeedViewerStateSchema.optional(),
  score: z.number().optional(),
  // Quarantine status - only present when viewing own quarantined posts
  quarantined: z.boolean().optional(),
});

export const ApiFeedResponseSchema = z.object({
  posts: z.array(ApiFeedPostSchema),
  mode: z.string(),
  limit: z.number(),
  offset: z.number(),
});

export const ApiPostResponseSchema = z.object({
  post: ApiFeedPostSchema,
});

export const ApiRecipeAuthorSchema = z.object({
  id: z.string(),
  handle: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export const ApiRecipeSchema = z.object({
  id: z.string(),
  capsuleId: z.string().optional(),
  name: z.string(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  author: ApiRecipeAuthorSchema,
  createdAt: z.union([z.number(), z.string()]).nullable().optional(),
});

export const ApiRecipeListResponseSchema = z.object({
  recipes: z.array(ApiRecipeSchema),
  limit: z.number(),
  offset: z.number(),
});

export const ApiRecipeCreateResponseSchema = z.object({
  recipe: ApiRecipeSchema,
});

export const ApiUserStatsSchema = z.object({
  followers: z.number(),
  following: z.number(),
  posts: z.number(),
  runs: z.number(),
  remixes: z.number(),
});

export const ApiUserProfileResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    handle: z.string(),
    name: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    plan: z.string().optional(),
    createdAt: z.union([z.number(), z.string()]),
    stats: ApiUserStatsSchema,
  }),
});

export const ApiUserPostsResponseSchema = z.object({
  posts: z.array(ApiFeedPostSchema),
  limit: z.number(),
  offset: z.number(),
});

export const ApiRemixNodeSchema = z.object({
  capsuleId: z.string(),
  postId: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  authorId: z.string().nullable(),
  authorHandle: z.string().nullable(),
  authorDisplayName: z.string().nullable(),
  createdAt: z.number().nullable(),
  parentId: z.string().nullable(),
  children: z.array(z.string()),
  depth: z.number().int(),
  remixCount: z.number().int(),
  isRequested: z.boolean().optional(),
});

export const ApiRemixTreeResponseSchema = z.object({
  rootCapsuleId: z.string(),
  requestedCapsuleId: z.string(),
  directParentId: z.string().nullable(),
  nodes: z.array(ApiRemixNodeSchema),
  truncated: z.boolean().optional(),
});

/**
 * Validation issue for manifest warnings/errors
 */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/**
 * Runtime artifact summary - returned from capsule creation
 */
export const ArtifactSummarySchema = z.object({
  id: z.string().optional(),
  runtimeVersion: z.string().nullable().optional(),
  bundleDigest: z.string().nullable().optional(),
  bundleSizeBytes: z.number().nullable().optional(),
  queued: z.boolean().optional(),
  status: z.enum(["pending", "queued", "ready", "failed"]).optional(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

/**
 * DraftCapsule - the canonical shape for a capsule created via import or publish.
 * This is the core abstraction that both Studio and Composer work against.
 *
 * Import flows (GitHub, ZIP) return this shape.
 * Publish flows return this shape.
 * Client state extends this with UI-specific fields.
 */
export const DraftCapsuleSchema = z.object({
  capsuleId: z.string(),
  manifest: manifestSchema,
  contentHash: z.string(),
  totalSize: z.number().int(),
  fileCount: z.number().int(),
  entryPoint: z.string(),
  entryCandidates: z.array(z.string()),
  warnings: z.array(ValidationIssueSchema).optional(),
  errors: z.array(ValidationIssueSchema).optional(),
  artifact: ArtifactSummarySchema.nullable().optional(),
  sourceName: z.string().optional(),
});
export type DraftCapsule = z.infer<typeof DraftCapsuleSchema>;

export const ApiFilesSummarySchema = z.object({
  capsuleId: z.string(),
  contentHash: z.string(),
  manifest: manifestSchema,
  draftManifest: manifestSchema.optional(),
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int(),
      hash: z.string().optional(),
    })
  ),
  totalSize: z.number().int(),
  fileCount: z.number().int(),
  entryPoint: z.string(),
  entryCandidates: z.array(z.string()).default([]),
});

/**
 * ApiImportResponse - wraps DraftCapsule with success flag and legacy fields.
 * Returns the canonical DraftCapsule shape plus backward-compatible fields.
 */
export const ApiImportResponseSchema = z.object({
  success: z.literal(true),
  // Core DraftCapsule fields (flattened for backward compatibility)
  capsuleId: z.string(),
  manifest: manifestSchema,
  // Legacy field - same as manifest, kept for backward compat
  draftManifest: manifestSchema,
  // Nested summary for backward compat with existing clients
  filesSummary: ApiFilesSummarySchema.pick({
    contentHash: true,
    totalSize: true,
    fileCount: true,
    entryPoint: true,
    entryCandidates: true,
  }),
  warnings: z.array(ValidationIssueSchema).optional(),
  artifact: ArtifactSummarySchema.nullable().optional(),
  // Source name (repo name or zip filename)
  sourceName: z.string().optional(),
});

/**
 * Helper to extract DraftCapsule from ApiImportResponse
 */
export function toDraftCapsule(response: ApiImportResponse): DraftCapsule {
  return {
    capsuleId: response.capsuleId,
    manifest: response.manifest,
    contentHash: response.filesSummary.contentHash,
    totalSize: response.filesSummary.totalSize,
    fileCount: response.filesSummary.fileCount,
    entryPoint: response.filesSummary.entryPoint,
    entryCandidates: response.filesSummary.entryCandidates,
    warnings: response.warnings,
    artifact: response.artifact,
    sourceName: response.sourceName,
  };
}

export const ApiUpdateManifestResponseSchema = z.object({
  ok: z.boolean(),
  capsuleId: z.string(),
  warnings: z.array(ValidationIssueSchema).optional(),
  manifest: manifestSchema.optional(),
  entryCandidates: z.array(z.string()).optional(),
});

export type ApiFeedPost = z.infer<typeof ApiFeedPostSchema>;
export type ApiFeedResponse = z.infer<typeof ApiFeedResponseSchema>;
export type ApiPostResponse = z.infer<typeof ApiPostResponseSchema>;
export type ApiUserProfileResponse = z.infer<typeof ApiUserProfileResponseSchema>;
export type ApiUserPostsResponse = z.infer<typeof ApiUserPostsResponseSchema>;
export type ApiAuthorProfile = z.infer<typeof ApiAuthorProfileSchema>;
export type ApiRecipe = z.infer<typeof ApiRecipeSchema>;
export type ApiRecipeListResponse = z.infer<typeof ApiRecipeListResponseSchema>;
export type ApiRecipeCreateResponse = z.infer<typeof ApiRecipeCreateResponseSchema>;
export type ApiRemixNode = z.infer<typeof ApiRemixNodeSchema>;
export type ApiRemixTreeResponse = z.infer<typeof ApiRemixTreeResponseSchema>;
export type ApiFilesSummary = z.infer<typeof ApiFilesSummarySchema>;
export type ApiImportResponse = z.infer<typeof ApiImportResponseSchema>;

/**
 * ApiPublishResponse - returned from /capsules/publish
 * Also returns DraftCapsule-compatible shape.
 */
export const ApiPublishResponseSchema = z.object({
  success: z.literal(true),
  capsule: z.object({
    id: z.string(),
    contentHash: z.string(),
    totalSize: z.number().int(),
    fileCount: z.number().int(),
  }),
  manifest: manifestSchema.optional(),
  warnings: z.array(ValidationIssueSchema).optional(),
  artifact: ArtifactSummarySchema.nullable().optional(),
});
export type ApiPublishResponse = z.infer<typeof ApiPublishResponseSchema>;

/**
 * Helper to extract DraftCapsule from ApiPublishResponse
 */
export function publishToDraftCapsule(
  response: ApiPublishResponse,
  manifest: z.infer<typeof manifestSchema>
): DraftCapsule {
  return {
    capsuleId: response.capsule.id,
    manifest: response.manifest ?? manifest,
    contentHash: response.capsule.contentHash,
    totalSize: response.capsule.totalSize,
    fileCount: response.capsule.fileCount,
    entryPoint: manifest.entry,
    entryCandidates: [manifest.entry],
    warnings: response.warnings,
    artifact: response.artifact,
  };
}
export type ApiUpdateManifestResponse = z.infer<typeof ApiUpdateManifestResponseSchema>;
