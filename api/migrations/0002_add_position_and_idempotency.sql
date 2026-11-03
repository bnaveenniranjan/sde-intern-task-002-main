-- Add position column to members for explicit creation order
ALTER TABLE members ADD COLUMN position INTEGER;

-- Backfill positions based on rowid (insertion order)
UPDATE members SET position = rowid WHERE position IS NULL;

-- Add idempotency_key column to shares for payment idempotency
ALTER TABLE shares ADD COLUMN idempotency_key TEXT;
