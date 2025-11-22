CREATE TABLE `artifact_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`runtime_version` text,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`capsule_id` text NOT NULL,
	`type` text NOT NULL,
	`runtime_version` text,
	`bundle_digest` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`policy_status` text DEFAULT 'active' NOT NULL,
	`safety_tier` text DEFAULT 'default' NOT NULL,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` integer,
	`last_reviewed_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`key` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `badges` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`icon` text,
	`tier` text
);
--> statement-breakpoint
CREATE TABLE `capsules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`manifest_json` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`at_ms` integer,
	`bbox` text,
	`parent_comment_id` text,
	`quarantined` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`icon` text,
	`config_json` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	PRIMARY KEY(`follower_id`, `followee_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`followee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `handle_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`handle` text NOT NULL,
	`valid_until` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `live_waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`email` text NOT NULL,
	`handle` text NOT NULL,
	`plan` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`type` text NOT NULL,
	`capsule_id` text,
	`report_md` text,
	`cover_key` text,
	`title` text NOT NULL,
	`description` text,
	`tags` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`quarantined` integer DEFAULT 0,
	`likes_count` integer DEFAULT 0,
	`comments_count` integer DEFAULT 0,
	`runs_count` integer DEFAULT 0,
	`remixes_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profile_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`position` integer NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	`updated_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profile_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`icon` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profile_themes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'system' NOT NULL,
	`accent_hue` integer DEFAULT 260 NOT NULL,
	`accent_saturation` integer DEFAULT 80 NOT NULL,
	`accent_lightness` integer DEFAULT 60 NOT NULL,
	`radius_scale` integer DEFAULT 2 NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`accent_color` text,
	`bg_color` text,
	`text_color` text,
	`font_family` text,
	`cover_image_url` text,
	`glass` integer DEFAULT false NOT NULL,
	`canvas_blur` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`display_name` text,
	`avatar_url` text,
	`bio` text,
	`user_id` text PRIMARY KEY NOT NULL,
	`tagline` text,
	`location` text,
	`website_url` text,
	`x_handle` text,
	`github_handle` text,
	`pronouns` text,
	`search_tags` text,
	`about_md` text,
	`layout_version` integer DEFAULT 1 NOT NULL,
	`pinned_capsules` text,
	`profile_capsule_id` text,
	`created_at` integer DEFAULT (strftime('%s','now')),
	`updated_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_key` text,
	`tags` text,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `remixes` (
	`child_capsule_id` text NOT NULL,
	`parent_capsule_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	PRIMARY KEY(`child_capsule_id`, `parent_capsule_id`),
	FOREIGN KEY (`child_capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`post_id` text,
	`comment_id` text,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`post_id` text,
	`user_id` text,
	`started_at` integer,
	`duration_ms` integer,
	`status` text,
	`error_message` text,
	FOREIGN KEY (`capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_badges` (
	`user_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`granted_at` integer DEFAULT (strftime('%s','now')),
	`source` text,
	PRIMARY KEY(`user_id`, `badge_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`badge_id`) REFERENCES `badges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`bio` text,
	`plan` text DEFAULT 'free',
	`storage_usage_bytes` integer DEFAULT 0 NOT NULL,
	`storage_version` integer DEFAULT 0 NOT NULL,
	`followers_count` integer DEFAULT 0,
	`following_count` integer DEFAULT 0,
	`posts_count` integer DEFAULT 0,
	`runs_count` integer DEFAULT 0,
	`remixes_count` integer DEFAULT 0,
	`primary_tags` text,
	`is_featured` integer DEFAULT 0,
	`is_suspended` integer DEFAULT 0,
	`shadow_banned` integer DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s','now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `badges_slug_unique` ON `badges` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);