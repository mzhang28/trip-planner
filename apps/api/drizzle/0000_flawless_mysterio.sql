CREATE TABLE `event_custom_fields` (
	`event_id` text NOT NULL,
	`field_def_id` text NOT NULL,
	`value_text` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_custom_fields_event` ON `event_custom_fields` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_links_event` ON `event_links` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`trip_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`city` text,
	`location_label` text,
	`location_address` text,
	`lat` real,
	`lng` real,
	`starts_at` integer,
	`timezone` text,
	`duration_minutes` integer,
	`booking_status` text NOT NULL,
	`booking_note` text,
	`confirmation_code` text,
	`description` text,
	`search_text` text NOT NULL,
	`deleted_at` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_trip_start` ON `events` (`trip_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `events_trip_city` ON `events` (`trip_id`,`city`);--> statement-breakpoint
CREATE TABLE `trip_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` text NOT NULL,
	`hash` text NOT NULL,
	`actor_id` text NOT NULL,
	`change` blob NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_changes_trip` ON `trip_changes` (`trip_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_changes_hash` ON `trip_changes` (`trip_id`,`hash`);--> statement-breakpoint
CREATE TABLE `trip_docs` (
	`trip_id` text PRIMARY KEY NOT NULL,
	`snapshot` blob NOT NULL,
	`heads` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`secret_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_credentials_user` ON `auth_credentials` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_credentials_provider_account` ON `auth_credentials` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_trip` ON `share_links` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_members` (
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_via` text,
	`first_opened_at` integer NOT NULL,
	`last_opened_at` integer NOT NULL,
	PRIMARY KEY(`trip_id`, `user_id`),
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_via`) REFERENCES `share_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trip_members_user` ON `trip_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`home_timezone` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`tombstones_swept_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trips_created_by` ON `trips` (`created_by`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_color` text NOT NULL,
	`created_at` integer NOT NULL
);
