import { z } from "zod";

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
  type: z.string(),
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

export type ApiFeedPost = z.infer<typeof ApiFeedPostSchema>;
export type ApiFeedResponse = z.infer<typeof ApiFeedResponseSchema>;
export type ApiPostResponse = z.infer<typeof ApiPostResponseSchema>;
export type ApiUserProfileResponse = z.infer<typeof ApiUserProfileResponseSchema>;
export type ApiUserPostsResponse = z.infer<typeof ApiUserPostsResponseSchema>;
export type ApiAuthorProfile = z.infer<typeof ApiAuthorProfileSchema>;
