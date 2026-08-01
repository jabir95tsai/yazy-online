-- Repairs `turn_deadline` values written by the first revision of migration
-- 0003, which used SQLite's `datetime()` ("YYYY-MM-DD HH:MM:SS"). `Date.parse()`
-- treats that shape as local time, so those deadlines resolve hours away from
-- the intended instant and a live turn reads as already expired.
-- Idempotent: rows already stored as ISO-8601 UTC are left untouched.
UPDATE `rooms`
SET `turn_deadline` = strftime('%Y-%m-%dT%H:%M:%fZ', `turn_deadline`)
WHERE `turn_deadline` IS NOT NULL
  AND `turn_deadline` NOT LIKE '%T%Z';
