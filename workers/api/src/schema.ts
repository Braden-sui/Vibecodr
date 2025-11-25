import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { PostTypeSchema, postTypes } from "@vibecodr/shared";
import type { PostType } from "@vibecodr/shared";

// Users table
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  // Subscription plan
  plan: text("plan", { enum: ["free", "creator", "pro", "team"] }).default("free"),
  // Storage accounting (optimistic locking)
  storageUsageBytes: integer("storage_usage_bytes").notNull().default(0),
  storageVersion: integer("storage_version").notNull().default(0),
  // Denormalized counters
  followersCount: integer("followers_count").default(0),
  followingCount: integer("following_count").default(0),
  postsCount: integer("posts_count").default(0),
  runsCount: integer("runs_count").default(0),
  remixesCount: integer("remixes_count").default(0),
  // Primary tags as JSON string
  primaryTags: text("primary_tags"),
  // Moderation/feature flags (0/1)
  isFeatured: integer("is_featured").default(0),
  isSuspended: integer("is_suspended").default(0),
  shadowBanned: integer("shadow_banned").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Capsules table - stores the runnable micro-apps
export const capsules = sqliteTable("capsules", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  manifestJson: text("manifest_json").notNull(),
  hash: text("hash").notNull(), // Content hash for integrity
  quarantined: integer("quarantined").default(0),
  quarantineReason: text("quarantine_reason"),
  quarantinedAt: integer("quarantined_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Assets table - tracks files in R2
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  capsuleId: text("capsule_id")
    .notNull()
    .references(() => capsules.id),
  key: text("key").notNull(), // R2 key
  size: integer("size").notNull(),
});

// Artifacts table - runtime artifacts linked to capsules
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  capsuleId: text("capsule_id")
    .notNull()
    .references(() => capsules.id),
  // Logical runtime type for this artifact (e.g., react-jsx, html, etc.)
  type: text("type").notNull(),
  runtimeVersion: text("runtime_version"),
  bundleDigest: text("bundle_digest").notNull(),
  status: text("status", { enum: ["active", "quarantined", "removed", "draft"] })
    .notNull()
    .default("active"),
  visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
    .notNull()
    .default("public"),
  policyStatus: text("policy_status", { enum: ["active", "quarantined", "removed"] })
    .notNull()
    .default("active"),
  safetyTier: text("safety_tier").notNull().default("default"),
  riskScore: integer("risk_score").notNull().default(0),
  lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp" }),
  lastReviewedBy: text("last_reviewed_by").references(() => users.id),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  deletedBy: text("deleted_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`
  ),
});

// Artifact manifests table - versioned runtime manifests per artifact
export const artifactManifests = sqliteTable("artifact_manifests", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id")
    .notNull()
    .references(() => artifacts.id),
  version: integer("version").notNull(),
  manifestJson: text("manifest_json").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  runtimeVersion: text("runtime_version"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`
  ),
});

// Posts table - unified vibes with typed subcategories
export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: postTypes }).notNull(),
  capsuleId: text("capsule_id").references(() => capsules.id),
  reportMd: text("report_md"), // Markdown content for reports
  coverKey: text("cover_key"), // R2 key for cover image
  title: text("title").notNull(),
  description: text("description"),
  tags: text("tags"), // JSON array
  visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
    .notNull()
    .default("public"),
  quarantined: integer("quarantined").default(0),
  likesCount: integer("likes_count").default(0),
  commentsCount: integer("comments_count").default(0),
  runsCount: integer("runs_count").default(0),
  remixesCount: integer("remixes_count").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Runs table - tracks capsule executions
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  capsuleId: text("capsule_id")
    .notNull()
    .references(() => capsules.id),
  postId: text("post_id").references(() => posts.id),
  userId: text("user_id").references(() => users.id),
  startedAt: integer("started_at", { mode: "timestamp" }),
  durationMs: integer("duration_ms"),
  status: text("status", { enum: ["started", "completed", "failed", "killed"] }),
  errorMessage: text("error_message"),
});

// Capsule parameter recipes saved by users
export const capsuleRecipes = sqliteTable("capsule_recipes", {
  id: text("id").primaryKey(),
  capsuleId: text("capsule_id")
    .notNull()
    .references(() => capsules.id),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  paramsJson: text("params_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
});

// Runtime telemetry events (admin analytics + debugging)
export const runtimeEvents = sqliteTable("runtime_events", {
  id: text("id").primaryKey(),
  eventName: text("event_name").notNull(),
  capsuleId: text("capsule_id"),
  artifactId: text("artifact_id"),
  runtimeType: text("runtime_type"),
  runtimeVersion: text("runtime_version"),
  code: text("code"),
  message: text("message"),
  properties: text("properties"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Comments table
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  postId: text("post_id")
    .notNull()
    .references(() => posts.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  atMs: integer("at_ms"), // Timestamp in video/demo for time-based comments
  bbox: text("bbox"), // JSON for spatial comments
  parentCommentId: text("parent_comment_id"),
  // Moderation flag (0/1)
  // INVARIANT: quarantined = 1 implies comment is hidden from non-moderators.
  quarantined: integer("quarantined").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Follows table
export const follows = sqliteTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => users.id),
    followeeId: text("followee_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.followerId, table.followeeId] }),
  })
);

// Remixes table - tracks parent/child capsule relationships
export const remixes = sqliteTable(
  "remixes",
  {
    childCapsuleId: text("child_capsule_id")
      .notNull()
      .references(() => capsules.id),
    parentCapsuleId: text("parent_capsule_id")
      .notNull()
      .references(() => capsules.id),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.childCapsuleId, table.parentCapsuleId] }),
  })
);

// Likes table (optional for MVP)
export const likes = sqliteTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.postId] }),
  })
);

// Reports table - for moderation
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => users.id),
  postId: text("post_id").references(() => posts.id),
  commentId: text("comment_id").references(() => comments.id),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status", { enum: ["pending", "reviewed", "resolved", "dismissed"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// Live waitlist signups
export const liveWaitlist = sqliteTable("live_waitlist", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  email: text("email").notNull(),
  handle: text("handle").notNull(),
  plan: text("plan", { enum: ["free", "creator", "pro", "team"] }).notNull(),
  userId: text("user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
});

// ============================================
// Zod Schemas for Validation
// ============================================

// Manifest schema for capsules
export const manifestSchema = z.object({
  version: z.literal("1.0"),
  runner: z.enum(["client-static", "webcontainer"]),
  entry: z.string(), // Main entry file
  params: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["slider", "toggle", "select", "text"]),
        label: z.string(),
        default: z.union([z.string(), z.number(), z.boolean()]),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        options: z.array(z.string()).optional(),
      })
    )
    .optional(),
  capabilities: z
    .object({
      net: z.array(z.string()).optional(), // Allowed hosts
      storage: z.boolean().optional(),
      workers: z.boolean().optional(),
    })
    .optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

// User schemas
export const createUserSchema = z.object({
  id: z.string(),
  handle: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  plan: z.enum(["free", "creator", "pro", "team"]).optional(),
});

export const updateUserSchema = createUserSchema.partial().required({ id: true });

/**
 * Note: users.id maps 1:1 to Clerk user.id (string)
 * plan: subscription tier; isFeatured/isSuspended/shadowBanned: boolean-like flags (0/1) for curation/moderation
 * *_count fields are denormalized counters maintained by application logic
 */

// Post schemas
const createPostTypeInput = z.union([PostTypeSchema, z.literal("report")]);
export type CreatePostTypeInput = z.infer<typeof createPostTypeInput>;

export function normalizePostType(input: CreatePostTypeInput): PostType {
  return (input === "report" ? "thought" : input) as PostType;
}

export const createPostSchema = z
  .object({
    authorId: z.string(),
    type: createPostTypeInput,
    capsuleId: z.string().optional(),
    reportMd: z.string().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    tags: z.array(z.string()).optional(),
    visibility: z.enum(["public", "unlisted", "private"]).default("public"),
    coverKey: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const normalizedType = value.type === "report" ? "thought" : value.type;
    if (normalizedType === "app" && !value.capsuleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Capsule is required for app vibes",
        path: ["capsuleId"],
      });
    }
  });

// Comment schema
const commentPayloadSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(2000, "Comment too long"),
  atMs: z
    .number({
      invalid_type_error: "Timestamp must be a number",
    })
    .int("Timestamp must be an integer")
    .min(0, "Timestamp must be positive")
    .optional(),
  bbox: z
    .string()
    .max(500, "Bounding box payload too long")
    .nullable()
    .optional(),
  parentCommentId: z.string().optional(),
});

export const createCommentSchema = commentPayloadSchema.extend({
  postId: z.string(),
  userId: z.string(),
});

export const createCommentBodySchema = commentPayloadSchema;

// Report schema
export const createReportSchema = z.object({
  reporterId: z.string(),
  postId: z.string().optional(),
  commentId: z.string().optional(),
  reason: z.enum([
    "spam",
    "harassment",
    "inappropriate",
    "copyright",
    "malware",
    "other",
  ]),
  details: z.string().max(1000).optional(),
});

// Profiles table (1:1 with users)
export const profiles = sqliteTable("profiles", {
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  tagline: text("tagline"),
  location: text("location"),
  websiteUrl: text("website_url"),
  xHandle: text("x_handle"),
  githubHandle: text("github_handle"),
  pronouns: text("pronouns"),
  searchTags: text("search_tags"),
  aboutMd: text("about_md"),
  layoutVersion: integer("layout_version").notNull().default(1),
  pinnedCapsules: text("pinned_capsules"),
  profileCapsuleId: text("profile_capsule_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
});

// Profile themes
export const profileThemes = sqliteTable("profile_themes", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  mode: text("mode", { enum: ["system", "light", "dark"] })
    .notNull()
    .default("system"),
  accentHue: integer("accent_hue").notNull().default(260),
  accentSaturation: integer("accent_saturation").notNull().default(80),
  accentLightness: integer("accent_lightness").notNull().default(60),
  radiusScale: integer("radius_scale").notNull().default(2),
  density: text("density", { enum: ["comfortable", "cozy", "compact"] })
    .notNull()
    .default("comfortable"),
  accentColor: text("accent_color"),
  bgColor: text("bg_color"),
  textColor: text("text_color"),
  fontFamily: text("font_family"),
  coverImageUrl: text("cover_image_url"),
  glass: integer("glass", { mode: "boolean" }).notNull().default(false),
  canvasBlur: integer("canvas_blur"),
});

// Profile blocks – configurable layout blocks per user
export const profileBlocks = sqliteTable("profile_blocks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  position: integer("position").notNull(),
  visibility: text("visibility", {
    enum: ["public", "followers", "private"],
  })
    .notNull()
    .default("public"),
  configJson: text("config_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
});

// Custom profile fields
export const customFields = sqliteTable("custom_fields", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(),
  icon: text("icon"),
  configJson: text("config_json"),
  position: integer("position").notNull().default(0),
});

// Projects/collections highlighted on profiles
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  coverKey: text("cover_key"),
  tags: text("tags"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
});

// Profile link entries (header links)
export const profileLinks = sqliteTable("profile_links", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  label: text("label").notNull(),
  url: text("url").notNull(),
  icon: text("icon"),
  position: integer("position").notNull().default(0),
});

// Badge catalog
export const badges = sqliteTable("badges", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  icon: text("icon"),
  tier: text("tier"),
});

// User-badge mapping
export const userBadges = sqliteTable(
  "user_badges",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    badgeId: text("badge_id")
      .notNull()
      .references(() => badges.id),
    grantedAt: integer("granted_at", { mode: "timestamp" }).default(
      sql`(strftime('%s','now'))`,
    ),
    source: text("source"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.badgeId] }),
  }),
);

// Handle history for redirects after rename
export const handleHistory = sqliteTable("handle_history", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  handle: text("handle").notNull(),
  validUntil: integer("valid_until", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s','now'))`,
  ),
});

// ============================================
// Profile Zod Schemas
// ============================================

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  .max(9);

export const profileThemeSchema = z.object({
  mode: z.enum(["system", "light", "dark"]).default("system"),
  accentHue: z.number().int().min(0).max(360).default(260),
  accentSaturation: z.number().int().min(0).max(100).default(80),
  accentLightness: z.number().int().min(0).max(100).default(60),
  radiusScale: z.number().int().min(1).max(4).default(2),
  density: z.enum(["comfortable", "cozy", "compact"]).default("comfortable"),
  accentColor: hexColor.nullable().optional(),
  bgColor: hexColor.nullable().optional(),
  textColor: hexColor.nullable().optional(),
  fontFamily: z.string().max(120).nullable().optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  glass: z.boolean().optional(),
  canvasBlur: z.number().int().min(0).max(64).optional(),
});

export type ProfileThemeInput = z.infer<typeof profileThemeSchema>;

export const profileBlockConfigSchema = z.object({
  version: z.literal(1),
  type: z.enum([
    "header",
    "about",
    "activity",
    "projects",
    "badges",
    "text",
    "markdown",
    "links",
    "stats",
    "imageGallery",
    "videoEmbed",
    "banner",
    "capsuleGrid",
    "capsuleEmbed",
  ]),
  visibility: z.enum(["public", "followers", "private"]).default("public"),
  props: z.record(z.string(), z.unknown()).default({}),
});

export type ProfileBlockConfig = z.infer<typeof profileBlockConfigSchema>;

export const customFieldConfigSchema = z.object({
  type: z.enum(["text", "number", "url", "date", "select", "multiselect"]),
  options: z.array(z.string()).optional(),
  defaultValue: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
});

export const customFieldDefinitionSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(64),
  type: customFieldConfigSchema.shape.type,
  icon: z.string().max(64).optional(),
  config: customFieldConfigSchema.optional(),
  position: z.number().int().min(0).default(0),
});

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  tagline: z.string().max(160).nullable().optional(),
  location: z.string().max(80).nullable().optional(),
  websiteUrl: z.string().url().max(255).nullable().optional(),
  xHandle: z.string().max(50).nullable().optional(),
  githubHandle: z.string().max(50).nullable().optional(),
  pronouns: z.string().max(40).nullable().optional(),
  aboutMd: z.string().max(8000).nullable().optional(),
  theme: profileThemeSchema.optional(),
  customFields: z.array(customFieldDefinitionSchema).optional(),
  blocks: z.array(profileBlockConfigSchema).optional(),
  pinnedCapsules: z.array(z.string().max(64)).max(12).optional(),
  profileCapsuleId: z.string().max(64).nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
