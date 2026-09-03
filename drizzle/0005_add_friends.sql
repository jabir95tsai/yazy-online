CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_key` text NOT NULL,
	`requester_id` text NOT NULL,
	`addressee_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addressee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_pair_unique` ON `friendships` (`pair_key`);--> statement-breakpoint
CREATE INDEX `friendships_requester_idx` ON `friendships` (`requester_id`);--> statement-breakpoint
CREATE INDEX `friendships_addressee_idx` ON `friendships` (`addressee_id`);--> statement-breakpoint
CREATE TABLE `room_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_invites_room_to_unique` ON `room_invites` (`room_id`,`to_user_id`);--> statement-breakpoint
CREATE INDEX `room_invites_to_idx` ON `room_invites` (`to_user_id`);