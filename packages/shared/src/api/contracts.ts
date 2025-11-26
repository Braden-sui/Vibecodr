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

const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

const ArtifactSummarySchema = z.object({
  id: z.string().optional(),
  runtimeVersion: z.string().nullable().optional(),
  bundleDigest: z.string().nullable().optional(),
  bundleSizeBytes: z.number().nullable().optional(),
  queued: z.boolean().optional(),
});

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

export const ApiImportResponseSchema = z.object({
  success: z.literal(true),
  capsuleId: z.string(),
  manifest: manifestSchema,
  draftManifest: manifestSchema,
  filesSummary: ApiFilesSummarySchema.pick({
    contentHash: true,
    totalSize: true,
    fileCount: true,
    entryPoint: true,
    entryCandidates: true,
  }),
  warnings: z.array(ValidationIssueSchema).optional(),
  artifact: ArtifactSummarySchema.nullable().optional(),
});

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
export type ApiUpdateManifestResponse = z.infer<typeof ApiUpdateManifestResponseSchema>;
