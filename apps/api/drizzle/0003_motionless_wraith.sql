ALTER TABLE `oauth_clients` ADD `owner_user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `oauth_clients_owner` ON `oauth_clients` (`owner_user_id`);