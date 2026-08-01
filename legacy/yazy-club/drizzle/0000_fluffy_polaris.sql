CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`seat` integer NOT NULL,
	`token_hash` text NOT NULL,
	`joined_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_seat_unique` ON `players` (`room_id`,`seat`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`max_players` integer DEFAULT 6 NOT NULL,
	`host_player_id` text NOT NULL,
	`current_seat` integer DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`dice_json` text DEFAULT '[]' NOT NULL,
	`rolls_used` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `scores` (
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`category` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `player_id`, `category`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
