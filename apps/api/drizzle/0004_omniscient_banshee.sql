CREATE TABLE `instance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`registration_closed_at` integer
);
--> statement-breakpoint
ALTER TABLE `users` ADD `admin_since` integer;