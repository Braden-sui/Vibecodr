CREATE TABLE `capsule_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`capsule_id` text NOT NULL,
	`author_id` text NOT NULL,
	`name` text NOT NULL,
	`params_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')),
	FOREIGN KEY (`capsule_id`) REFERENCES `capsules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `capsules` ADD `quarantined` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `capsules` ADD `quarantine_reason` text;--> statement-breakpoint
ALTER TABLE `capsules` ADD `quarantined_at` integer;