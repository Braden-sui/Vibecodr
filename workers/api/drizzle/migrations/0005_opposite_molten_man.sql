CREATE INDEX `idx_follows_follower_followee` ON `follows` (`follower_id`,`followee_id`);--> statement-breakpoint
CREATE INDEX `idx_follows_followee_follower` ON `follows` (`followee_id`,`follower_id`);--> statement-breakpoint
CREATE INDEX `idx_likes_post` ON `likes` (`post_id`);--> statement-breakpoint
CREATE INDEX `idx_posts_feed_visibility_quarantined_created_at` ON `posts` (`visibility`,`quarantined`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_posts_author_created_at` ON `posts` (`author_id`,`created_at`);