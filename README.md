Request Flow & Database Operations
POST /api/homes

Flow:
Validate name (reject empty).
Generate UUID.
Insert into homes table.
SQL:
sql
INSERT INTO homes (id, name) VALUES (?, ?)
POST /api/homes/:homeId/members

Flow:
Validate name and check home exists.
Generate UUID.
Insert into members table (preserves order via created_at).
SQL:
sql
-- Check home
SELECT 1 FROM homes WHERE id = ?
-- Insert member
INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)
