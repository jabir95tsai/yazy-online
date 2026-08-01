ALTER TABLE `rooms` ADD `turn_deadline` text;--> statement-breakpoint
-- `turn_deadline` is read with `Date.parse()`. SQLite's `datetime()` renders
-- "YYYY-MM-DD HH:MM:SS", which JS parses as *local* time, so the deadline
-- would land hours off UTC and read as already expired. Emit real ISO-8601 UTC
-- to match every timestamp the application writes.
UPDATE `rooms`
SET `turn_deadline` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 seconds'),
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `status` = 'playing';
