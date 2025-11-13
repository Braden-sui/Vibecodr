import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { z } from "zod";

// Users table
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  // Subscription plan
  plan: text("plan", { enum: ["free", "creator", "pro", "team"] }).default("free"),
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

// Posts table - feed items (can be app or report)
export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: ["app", "report"] }).notNull(),
  capsuleId: text("capsule_id").references(() => capsules.id),
  reportMd: text("report_md"), // Markdown content for reports
  coverKey: text("cover_key"), // R2 key for cover image
  title: text("title").notNull(),
  description: text("description"),
  tags: text("tags"), // JSON array
  visibility: text("visibility", { enum: ["public", "unlisted", "private"] })
    .notNull()
    .default("public"),
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
export const createPostSchema = z.object({
  authorId: z.string(),
  type: z.enum(["app", "report"]),
  capsuleId: z.string().optional(),
  reportMd: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
});

// Comment schema
export const createCommentSchema = z.object({
  postId: z.string(),
  userId: z.string(),
  body: z.string().min(1).max(2000),
  atMs: z.number().optional(),
  bbox: z.string().optional(),
});

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
