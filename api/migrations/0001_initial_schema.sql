-- Homes table
CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Members table (preserves creation order via `created_at`)
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Bills table
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Shares table (with constraints)
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  -- Prevent duplicate shares for the same member and bill
  UNIQUE (bill_id, member_id)
);

-- Indexes for frequently queried columns
CREATE INDEX idx_members_home_id ON members(home_id);
CREATE INDEX idx_shares_bill_id ON shares(bill_id);
CREATE INDEX idx_shares_member_id ON shares(member_id);