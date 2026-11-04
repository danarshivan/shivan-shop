CREATE TABLE IF NOT EXISTS owner_push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  last_success_at INTEGER,
  last_failure_at INTEGER,
  last_failure_status INTEGER
);

CREATE INDEX IF NOT EXISTS owner_push_subscriptions_owner_idx
  ON owner_push_subscriptions(owner_id, created_at DESC);
