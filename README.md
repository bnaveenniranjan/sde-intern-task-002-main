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


1. Database Migrations Applied Successfully
2. API Endpoints Implemented
   POST /api/homes

step 3:
Implement the bill-splitting business logic as a standalone, testable TypeScript function.

step 4:
POST /api/homes//bills
POST /api/bills//shares//pay
GET /api/homes//balances
