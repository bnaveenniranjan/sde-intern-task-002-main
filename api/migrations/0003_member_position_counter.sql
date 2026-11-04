-- Allocate member positions from a per-home counter instead of deriving them
-- from MAX(position) at insert time. Reading MAX and then inserting is a
-- check-then-act race: two concurrent requests can see the same maximum and
-- collide on idx_members_home_position. A counter bumped inside the same
-- transaction hands out each position exactly once.
ALTER TABLE homes ADD COLUMN next_member_position INTEGER NOT NULL DEFAULT 0;

-- Backfill: the next free position is one past the highest position in use.
UPDATE homes
SET next_member_position = (
  SELECT COALESCE(MAX(members.position) + 1, 0)
  FROM members
  WHERE members.home_id = homes.id
);
