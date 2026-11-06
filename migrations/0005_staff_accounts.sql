CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(identifier) BETWEEN 3 AND 160),
  CHECK (identifier <> '07502342153'),
  CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS staff_account_permissions (
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'orders',
    'products',
    'inventory',
    'prices',
    'reports',
    'customer_information',
    'notifications'
  )),
  granted_by TEXT NOT NULL REFERENCES accounts(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (staff_id, permission)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx ON staff_sessions(expires_at);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_idx ON staff_sessions(staff_id, expires_at);

CREATE TABLE IF NOT EXISTS staff_state (
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (staff_id, key)
);

CREATE TRIGGER IF NOT EXISTS accounts_identifier_not_staff_insert
BEFORE INSERT ON accounts
WHEN EXISTS (SELECT 1 FROM staff_accounts WHERE identifier = NEW.identifier COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'Identifier already exists in staff accounts');
END;

CREATE TRIGGER IF NOT EXISTS accounts_identifier_not_staff_update
BEFORE UPDATE OF identifier ON accounts
WHEN EXISTS (SELECT 1 FROM staff_accounts WHERE identifier = NEW.identifier COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'Identifier already exists in staff accounts');
END;

CREATE TRIGGER IF NOT EXISTS staff_identifier_not_account_insert
BEFORE INSERT ON staff_accounts
WHEN EXISTS (SELECT 1 FROM accounts WHERE identifier = NEW.identifier COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'Identifier already exists in customer or owner accounts');
END;

CREATE TRIGGER IF NOT EXISTS staff_identifier_not_account_update
BEFORE UPDATE OF identifier ON staff_accounts
WHEN EXISTS (SELECT 1 FROM accounts WHERE identifier = NEW.identifier COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'Identifier already exists in customer or owner accounts');
END;
