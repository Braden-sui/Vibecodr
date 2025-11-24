CREATE TABLE `runtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_name` text NOT NULL,
	`capsule_id` text,
	`artifact_id` text,
	`runtime_type` text,
	`runtime_version` text,
	`code` text,
	`message` text,
	`properties` text,
	`created_at` integer DEFAULT (strftime('%s','now'))
);
