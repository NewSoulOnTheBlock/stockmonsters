-- Names: 16 characters, and one change per day.
--
-- The cooldown is enforced HERE rather than in application code because the
-- name is a contended, globally unique value: two sockets for one wallet, or
-- two server processes, would both read "last changed yesterday" and both
-- write. A conditional UPDATE cannot race with itself.
--
-- name_changed_at is NULL for a player who has never had a name, so the first
-- claim is always free.

ALTER TABLE players
    DROP CONSTRAINT IF EXISTS players_name_check;

ALTER TABLE players
    ADD CONSTRAINT players_name_check
    CHECK (name IS NULL OR char_length(name) BETWEEN 3 AND 16);

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS name_changed_at TIMESTAMPTZ;

-- Players who already have a name predate the cooldown; treat them as having
-- claimed it now rather than letting everyone get one free change at deploy.
UPDATE players
   SET name_changed_at = COALESCE(name_changed_at, updated_at, now())
 WHERE name IS NOT NULL;
